// Turns Traefik routers into external-dns endpoints. Pure, with no relative imports, so
// `node --test` can load it directly (see records.spec.ts).
import { isIPv4, isIPv6 } from 'node:net';

export type TraefikRouter = {
  name: string;
  rule?: string;
  status?: string;
};

/** One entry of a DNSEndpoint's spec.endpoints (externaldns.k8s.io/v1alpha1). */
export type DnsEndpoint = {
  dnsName: string;
  recordType: string;
  targets: string[];
  providerSpecific?: { name: string; value: string }[];
};

export type RecordOptions = {
  /** Only hosts under this domain get records, e.g. "wuguishifu.dev". */
  domain: string;
  /** Where tailnet hosts point: an IP (A/AAAA) or a hostname (CNAME). */
  tailnetTarget: string;
  /** A host whose first label ends with this is public, through the tunnel, e.g. "-gw". */
  gatewaySuffix: string;
  /** The tunnel's hostname, <tunnel-id>.cfargotunnel.com. Unset skips gateway hosts. */
  gatewayTarget?: string;
};

export type SkippedHost = { host: string; reason: string };

const CLOUDFLARE_PROXIED =
  'external-dns.alpha.kubernetes.io/cloudflare-proxied';

// Host(`a`), Host(`a`, `b`) (v2) and HostHeader(...). Not HostRegexp or HostSNI. The optional
// leading "!" is captured so negated matchers can be dropped.
const HOST_MATCHER = /(!?)\bHost(?:Header)?\(([^)]*)\)/g;
const QUOTED = /[`"]([^`"]*)[`"]/g;
const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * The hosts a router rule matches. Negations inside a group, like `!(Host(a) || Host(b))`, aren't
 * understood and their hosts are returned as if they matched.
 */
export function hostsFromRule(rule: string): string[] {
  const hosts: string[] = [];
  for (const [, negated, args] of rule.matchAll(HOST_MATCHER)) {
    if (negated || args === undefined) {
      continue;
    }
    for (const [, host] of args.matchAll(QUOTED)) {
      if (host) {
        hosts.push(normalizeHost(host));
      }
    }
  }
  return hosts;
}

/** Every host an enabled router serves, deduplicated and sorted. */
export function hostsFromRouters(routers: TraefikRouter[]): string[] {
  const hosts = new Set<string>();
  for (const router of routers) {
    if (router.status !== undefined && router.status !== 'enabled') {
      continue;
    }
    for (const host of hostsFromRule(router.rule ?? '')) {
      hosts.add(host);
    }
  }
  return [...hosts].sort();
}

export function buildEndpoints(
  hosts: string[],
  options: RecordOptions,
): { endpoints: DnsEndpoint[]; skipped: SkippedHost[] } {
  const domain = normalizeHost(options.domain);
  const endpoints: DnsEndpoint[] = [];
  const skipped: SkippedHost[] = [];

  for (const host of hosts) {
    if (!HOSTNAME.test(host)) {
      skipped.push({ host, reason: 'not a plain hostname' });
      continue;
    }
    if (!host.endsWith(`.${domain}`)) {
      skipped.push({ host, reason: `not under ${domain}` });
      continue;
    }

    const labels = host.slice(0, -(domain.length + 1)).split('.');
    const isGateway = labels[0]?.endsWith(options.gatewaySuffix) ?? false;

    if (!isGateway) {
      endpoints.push(endpointFor(host, options.tailnetTarget, false));
      continue;
    }
    // Cloudflare's Universal SSL covers *.domain only, so a deeper proxied name gets no edge cert.
    if (labels.length > 1) {
      skipped.push({
        host,
        reason: `gateway hosts must be directly under ${domain}`,
      });
      continue;
    }
    if (!options.gatewayTarget) {
      skipped.push({ host, reason: 'GATEWAY_TARGET is not set' });
      continue;
    }
    endpoints.push(endpointFor(host, options.gatewayTarget, true));
  }

  return { endpoints: sortEndpoints(endpoints), skipped };
}

/**
 * Keeps endpoints that are in `current` but no longer `desired` until they've been missing for
 * `graceMs`, so a container restarting on the NAS doesn't drop its record. `missingSince` is
 * carried between syncs; the returned map replaces it.
 */
export function applyRemovalGrace({
  current,
  desired,
  missingSince,
  now,
  graceMs,
}: {
  current: DnsEndpoint[];
  desired: DnsEndpoint[];
  missingSince: ReadonlyMap<string, number>;
  now: number;
  graceMs: number;
}): {
  endpoints: DnsEndpoint[];
  missingSince: Map<string, number>;
  pendingRemoval: string[];
} {
  const desiredNames = new Set(desired.map((endpoint) => endpoint.dnsName));
  const nextMissingSince = new Map<string, number>();
  const kept: DnsEndpoint[] = [];

  for (const endpoint of current) {
    if (desiredNames.has(endpoint.dnsName)) {
      continue;
    }
    const since = missingSince.get(endpoint.dnsName) ?? now;
    if (now - since < graceMs) {
      nextMissingSince.set(endpoint.dnsName, since);
      kept.push(endpoint);
    }
  }

  return {
    endpoints: sortEndpoints([...desired, ...kept]),
    missingSince: nextMissingSince,
    pendingRemoval: kept.map((endpoint) => endpoint.dnsName).sort(),
  };
}

export function diffEndpoints(
  before: DnsEndpoint[],
  after: DnsEndpoint[],
): { added: string[]; removed: string[]; changed: string[] } {
  const beforeByName = new Map(before.map((e) => [e.dnsName, endpointKey(e)]));
  const afterByName = new Map(after.map((e) => [e.dnsName, endpointKey(e)]));

  return {
    added: [...afterByName.keys()]
      .filter((name) => !beforeByName.has(name))
      .sort(),
    removed: [...beforeByName.keys()]
      .filter((name) => !afterByName.has(name))
      .sort(),
    changed: [...afterByName]
      .filter(
        ([name, key]) =>
          beforeByName.has(name) && beforeByName.get(name) !== key,
      )
      .map(([name]) => name)
      .sort(),
  };
}

function endpointFor(
  host: string,
  target: string,
  proxied: boolean,
): DnsEndpoint {
  const endpoint: DnsEndpoint = {
    dnsName: host,
    recordType: recordTypeFor(target),
    targets: [target],
  };
  if (proxied) {
    endpoint.providerSpecific = [{ name: CLOUDFLARE_PROXIED, value: 'true' }];
  }
  return endpoint;
}

function recordTypeFor(target: string): string {
  if (isIPv4(target)) {
    return 'A';
  }
  if (isIPv6(target)) {
    return 'AAAA';
  }
  return 'CNAME';
}

function endpointKey(endpoint: DnsEndpoint): string {
  const providerSpecific = [...(endpoint.providerSpecific ?? [])]
    .map(({ name, value }) => `${name}=${value}`)
    .sort();
  return JSON.stringify([
    endpoint.recordType,
    [...endpoint.targets].sort(),
    providerSpecific,
  ]);
}

function sortEndpoints(endpoints: DnsEndpoint[]): DnsEndpoint[] {
  return [...endpoints].sort((a, b) => a.dnsName.localeCompare(b.dnsName));
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}
