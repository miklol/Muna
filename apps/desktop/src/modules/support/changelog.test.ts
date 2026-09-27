import { describe, expect, it } from 'vitest';

import { parseChangelog, plainNote } from './changelog';

const RELEASE_PLEASE = `# Changelog

All notable changes to this project are documented here.

## [0.3.0](https://github.com/miklol/Muna/compare/v0.2.0...v0.3.0) (2026-09-27)

### Features

* **support:** help, diagnostics bundle, repairs and update channel ([cd3fc86](https://github.com/miklol/Muna/commit/cd3fc86))
* **notes:** quick note shortcut ([1234abc](https://github.com/miklol/Muna/commit/1234abc))

### Bug Fixes

* **shell:** re-register app bars after Explorer restarts ([9876fed](https://github.com/miklol/Muna/commit/9876fed))

## [0.2.0](https://github.com/miklol/Muna/compare/v0.1.0...v0.2.0) (2026-08-30)

### Features

* **media:** now playing with \`GlobalSystemMediaTransportControls\` ([abcdef0](https://github.com/miklol/Muna/commit/abcdef0))
`;

describe('parseChangelog', () => {
  it('reads release-please output newest first, grouped, without commit links or markup', () => {
    const releases = parseChangelog(RELEASE_PLEASE);
    expect(releases.map((release) => [release.version, release.date])).toEqual([
      ['0.3.0', '2026-09-27'],
      ['0.2.0', '2026-08-30'],
    ]);
    expect(releases[0]?.groups).toEqual([
      {
        title: 'Features',
        notes: [
          'support: help, diagnostics bundle, repairs and update channel',
          'notes: quick note shortcut',
        ],
      },
      { title: 'Bug Fixes', notes: ['shell: re-register app bars after Explorer restarts'] },
    ]);
    expect(releases[1]?.groups[0]?.notes).toEqual([
      'media: now playing with GlobalSystemMediaTransportControls',
    ]);
  });

  it('accepts plain headings, a leading v, CRLF and bullets outside a group', () => {
    const releases = parseChangelog(
      '## v1.0.0 - 2026-10-01\r\n- First stable release\r\n- Thanks\r\n',
    );
    expect(releases).toEqual([
      {
        version: '1.0.0',
        date: '2026-10-01',
        groups: [{ title: '', notes: ['First stable release', 'Thanks'] }],
      },
    ]);
  });

  it('skips the preamble and yields nothing for a file without releases', () => {
    expect(parseChangelog('# Changelog\n\nNothing yet.\n')).toEqual([]);
    expect(parseChangelog('')).toEqual([]);
  });

  it('keeps link words and drops only the trailing commit reference', () => {
    expect(plainNote('see [the docs](https://example.com) ([abcdef1](https://x/y))')).toBe(
      'see the docs',
    );
    expect(plainNote('**bold** and __also__ and `code` (not a commit)')).toBe(
      'bold and also and code (not a commit)',
    );
  });
});
