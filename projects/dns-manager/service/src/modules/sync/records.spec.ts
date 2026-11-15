// Run with `nx test dns-manager-service` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyRemovalGrace,
  buildEndpoints,
  diffEndpoints,
  type DnsEndpoint,
  hostsFromRouters,
  hostsFromRule,
} from './records.ts';

const options = {
  domain: 'wuguishifu.dev',
  tailnetTarget: '100.64.0.10',
  gatewaySuffix: '-gw',
  gatewayTarget: 'abc123.cfargotunnel.com',
};

const tailnet = (dnsName: string): DnsEndpoint => ({
  dnsName,
  recordType: 'A',
  targets: ['100.64.0.10'],
});

describe('hostsFromRule', () => {
  it('reads a single Host matcher', () => {
    assert.deepEqual(hostsFromRule('Host(`jellyfin.wuguishifu.dev`)'), [
      'jellyfin.wuguishifu.dev',
    ]);
  });

  it('reads every host from combined and multi-argument matchers', () => {
    assert.deepEqual(
      hostsFromRule(
        'Host(`a.wuguishifu.dev`, `b.wuguishifu.dev`) || (Host(`C.wuguishifu.dev`) && PathPrefix(`/api`))',
      ),
      ['a.wuguishifu.dev', 'b.wuguishifu.dev', 'c.wuguishifu.dev'],
    );
  });

  it('reads HostHeader and double-quoted hosts', () => {
    assert.deepEqual(hostsFromRule('HostHeader("a.wuguishifu.dev")'), [
      'a.wuguishifu.dev',
    ]);
  });

  it('ignores HostRegexp, HostSNI and negated hosts', () => {
    assert.deepEqual(
      hostsFromRule(
        'HostRegexp(`^.+\\.wuguishifu\\.dev$`) && !Host(`x.wuguishifu.dev`) || HostSNI(`y.wuguishifu.dev`)',
      ),
      [],
    );
  });
});

describe('hostsFromRouters', () => {
  it('dedupes, sorts and skips routers that are not enabled', () => {
    assert.deepEqual(
      hostsFromRouters([
        {
          name: 'b@docker',
          rule: 'Host(`b.wuguishifu.dev`)',
          status: 'enabled',
        },
        {
          name: 'a@docker',
          rule: 'Host(`a.wuguishifu.dev`)',
          status: 'enabled',
        },
        { name: 'a2@file', rule: 'Host(`a.wuguishifu.dev`)' },
        {
          name: 'broken@docker',
          rule: 'Host(`c.wuguishifu.dev`)',
          status: 'disabled',
        },
        { name: 'api@internal', rule: 'PathPrefix(`/api`)', status: 'enabled' },
      ]),
      ['a.wuguishifu.dev', 'b.wuguishifu.dev'],
    );
  });
});

describe('buildEndpoints', () => {
  it('points tailnet hosts at the tailnet target', () => {
    assert.deepEqual(buildEndpoints(['jellyfin.wuguishifu.dev'], options), {
      endpoints: [tailnet('jellyfin.wuguishifu.dev')],
      skipped: [],
    });
  });

  it('points gateway hosts at the tunnel, proxied', () => {
    assert.deepEqual(
      buildEndpoints(['jellyfin-gw.wuguishifu.dev'], options).endpoints,
      [
        {
          dnsName: 'jellyfin-gw.wuguishifu.dev',
          recordType: 'CNAME',
          targets: ['abc123.cfargotunnel.com'],
          providerSpecific: [
            {
              name: 'external-dns.alpha.kubernetes.io/cloudflare-proxied',
              value: 'true',
            },
          ],
        },
      ],
    );
  });

  it('uses a CNAME when the tailnet target is a hostname', () => {
    const { endpoints } = buildEndpoints(['a.wuguishifu.dev'], {
      ...options,
      tailnetTarget: 'nas.wuguishifu.dev',
    });
    assert.equal(endpoints[0]?.recordType, 'CNAME');
  });

  it('skips hosts it should not or cannot manage', () => {
    const { endpoints, skipped } = buildEndpoints(
      [
        'example.com',
        'wuguishifu.dev',
        'notwuguishifu.dev',
        'a.b-gw.wuguishifu.dev',
        'a-gw.b.wuguishifu.dev',
        'under_score.wuguishifu.dev',
      ],
      options,
    );
    // a.b-gw is a tailnet host: only the first label decides
    assert.deepEqual(endpoints, [tailnet('a.b-gw.wuguishifu.dev')]);
    assert.deepEqual(
      skipped.map((s) => s.host),
      [
        'example.com',
        'wuguishifu.dev',
        'notwuguishifu.dev',
        'a-gw.b.wuguishifu.dev',
        'under_score.wuguishifu.dev',
      ],
    );
  });

  it('skips gateway hosts when there is no tunnel to point them at', () => {
    const { endpoints, skipped } = buildEndpoints(['a-gw.wuguishifu.dev'], {
      ...options,
      gatewayTarget: undefined,
    });
    assert.deepEqual(endpoints, []);
    assert.equal(skipped[0]?.reason, 'GATEWAY_TARGET is not set');
  });
});

describe('applyRemovalGrace', () => {
  const graceMs = 5 * 60_000;

  it('keeps a missing endpoint until the grace period is up', () => {
    const current = [tailnet('a.wuguishifu.dev'), tailnet('b.wuguishifu.dev')];
    const desired = [tailnet('a.wuguishifu.dev')];

    const first = applyRemovalGrace({
      current,
      desired,
      missingSince: new Map(),
      now: 0,
      graceMs,
    });
    assert.deepEqual(first.endpoints, current);
    assert.deepEqual(first.pendingRemoval, ['b.wuguishifu.dev']);

    const later = applyRemovalGrace({
      current: first.endpoints,
      desired,
      missingSince: first.missingSince,
      now: graceMs,
      graceMs,
    });
    assert.deepEqual(later.endpoints, desired);
    assert.deepEqual(later.pendingRemoval, []);
    assert.equal(later.missingSince.size, 0);
  });

  it('forgets the timer when the endpoint comes back', () => {
    const result = applyRemovalGrace({
      current: [tailnet('a.wuguishifu.dev')],
      desired: [tailnet('a.wuguishifu.dev')],
      missingSince: new Map([['a.wuguishifu.dev', 0]]),
      now: 1,
      graceMs,
    });
    assert.equal(result.missingSince.size, 0);
  });

  it('removes immediately with no grace', () => {
    const result = applyRemovalGrace({
      current: [tailnet('a.wuguishifu.dev')],
      desired: [],
      missingSince: new Map(),
      now: 0,
      graceMs: 0,
    });
    assert.deepEqual(result.endpoints, []);
  });
});

describe('diffEndpoints', () => {
  it('reports added, removed and changed names', () => {
    const before = [tailnet('a.wuguishifu.dev'), tailnet('b.wuguishifu.dev')];
    const after = [
      { ...tailnet('b.wuguishifu.dev'), targets: ['100.64.0.11'] },
      tailnet('c.wuguishifu.dev'),
    ];
    assert.deepEqual(diffEndpoints(before, after), {
      added: ['c.wuguishifu.dev'],
      removed: ['a.wuguishifu.dev'],
      changed: ['b.wuguishifu.dev'],
    });
  });

  it('ignores target order', () => {
    const a = {
      ...tailnet('a.wuguishifu.dev'),
      targets: ['1.1.1.1', '2.2.2.2'],
    };
    const b = {
      ...tailnet('a.wuguishifu.dev'),
      targets: ['2.2.2.2', '1.1.1.1'],
    };
    assert.deepEqual(diffEndpoints([a], [b]), {
      added: [],
      removed: [],
      changed: [],
    });
  });
});
