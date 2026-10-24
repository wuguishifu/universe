// Run with `nx test mega-client-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanErrorOutput,
  COLUMN_SEPARATOR,
  isMegaLink,
  parseProgress,
  parseSize,
  parseTransfers,
  parseWhoAmI,
} from './mega-output.ts';

const row = (...cells: string[]) => cells.join(COLUMN_SEPARATOR);

describe('parseSize', () => {
  for (const [text, bytes] of [
    ['4.75 GB', Math.round(4.75 * 1024 ** 3)],
    ['512.00 MB', 512 * 1024 ** 2],
    ['  12.50 KB', 12.5 * 1024],
    ['900 B', 900],
    ['1.20 TB', Math.round(1.2 * 1024 ** 4)],
    ['3.5mb', Math.round(3.5 * 1024 ** 2)],
  ] as const) {
    it(`reads "${text}"`, () => assert.equal(parseSize(text), bytes));
  }

  it("doesn't guess at what it can't read", () => {
    assert.equal(parseSize('a lot'), null);
    assert.equal(parseSize('4.75 GiB'), null);
  });
});

describe('parseProgress', () => {
  it('reads the aligned form', () => {
    assert.deepEqual(parseProgress('  1.17% of    4.75 GB'), {
      percent: 1.17,
      totalBytes: Math.round(4.75 * 1024 ** 3),
    });
  });

  it('keeps the percent when the size is missing or unreadable', () => {
    assert.deepEqual(parseProgress('100.00%'), {
      percent: 100,
      totalBytes: null,
    });
    assert.deepEqual(parseProgress('50.00% of ???'), {
      percent: 50,
      totalBytes: null,
    });
  });

  it('is null without a percent', () => {
    assert.equal(parseProgress('of 4.75 GB'), null);
  });
});

describe('parseTransfers', () => {
  it('reads every size unit, not only GB', () => {
    const transfers = parseTransfers(
      [
        row('TYPE', 'TAG', 'SOURCEPATH', 'DESTINYPATH', 'PROGRESS', 'STATE'),
        row(
          '⇓',
          '23',
          'Some Show S01E01.mkv',
          '/downloads/Some Show S01E01.mkv',
          '  1.17% of    4.75 GB',
          'ACTIVE',
        ),
        row(
          '⇓',
          '24',
          'notes.txt',
          '/downloads/notes.txt',
          ' 0.00% of  12.00 KB',
          'QUEUED',
        ),
        row(
          '⇑',
          '25',
          '/local/clip.mp4',
          '/Cloud/clip.mp4',
          '100.00% of 300.00 MB',
          'COMPLETED',
        ),
      ].join('\n'),
    );

    assert.deepEqual(
      transfers.map(({ tag, type, totalBytes, state }) => ({
        tag,
        type,
        totalBytes,
        state,
      })),
      [
        {
          tag: '23',
          type: 'download',
          totalBytes: Math.round(4.75 * 1024 ** 3),
          state: 'ACTIVE',
        },
        { tag: '24', type: 'download', totalBytes: 12 * 1024, state: 'QUEUED' },
        {
          tag: '25',
          type: 'upload',
          totalBytes: 300 * 1024 ** 2,
          state: 'COMPLETED',
        },
      ],
    );
  });

  it('keeps spaces in paths', () => {
    const [transfer] = parseTransfers(
      row(
        '⇓',
        '7',
        'a  b   c.zip',
        '/downloads/a  b   c.zip',
        '5.00% of 1.00 GB',
        'PAUSED',
      ),
    );
    assert.equal(transfer.sourcePath, 'a  b   c.zip');
    assert.equal(transfer.destinationPath, '/downloads/a  b   c.zip');
  });

  it("skips the header, MEGAcmd's notices and blank lines", () => {
    assert.deepEqual(
      parseTransfers(
        [
          '[Initiating MEGAcmd server in background. Log: /config/.megaCmd/megacmdserver.log]',
          row('TYPE', 'TAG', 'SOURCEPATH', 'DESTINYPATH', 'PROGRESS', 'STATE'),
          '',
          '  ...  and 3 more',
        ].join('\n'),
      ),
      [],
    );
  });

  it('marks unknown type symbols', () => {
    const [transfer] = parseTransfers(
      row('?', '1', 'x', 'y', '1.00% of 1.00 MB', 'active'),
    );
    assert.equal(transfer.type, 'unknown');
    assert.equal(transfer.state, 'ACTIVE');
  });
});

describe('parseWhoAmI', () => {
  it('reads the email', () => {
    assert.equal(
      parseWhoAmI('Account e-mail: someone@example.com\n'),
      'someone@example.com',
    );
  });

  it('is null for anything else', () => {
    assert.equal(parseWhoAmI(''), null);
  });
});

describe('cleanErrorOutput', () => {
  it('unwraps log lines and drops server notices', () => {
    assert.equal(
      cleanErrorOutput(
        '[Initiating MEGAcmd server in background. Log: /x/megacmdserver.log]\n[2026-10-24_02-20-23.862516 cmd ERR  Not logged in.]\n',
      ),
      'Not logged in.',
    );
  });

  it('leaves plain messages alone', () => {
    assert.equal(cleanErrorOutput('Invalid link\n'), 'Invalid link');
  });
});

describe('isMegaLink', () => {
  for (const link of [
    'https://mega.nz/file/abc#key',
    'https://mega.nz/folder/abc#key',
    'https://www.mega.nz/#!abc!key',
    'https://mega.co.nz/#!abc!key',
  ]) {
    it(`accepts ${link}`, () => assert.equal(isMegaLink(link), true));
  }

  for (const link of [
    'http://mega.nz/file/abc#key',
    'https://mega.nz.evil.example/file/abc',
    'https://example.com/file/abc',
    '-a',
    'not a url',
  ]) {
    it(`rejects ${link}`, () => assert.equal(isMegaLink(link), false));
  }
});
