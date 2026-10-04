/**
 * A `CHANGELOG.md` release as *What's new* shows it (docs/modules/support.md "Changelog viewer").
 * The file is the one release-please writes, which follows Keep a Changelog: a `## version`
 * heading with an optional link and date, `### Features` / `### Bug Fixes` groups, and one
 * `* **scope:** text ([abc123](url))` bullet per change.
 */
export interface ChangelogRelease {
  readonly version: string;
  /** `YYYY-MM-DD` when the heading carries one. */
  readonly date: string | null;
  readonly groups: readonly ChangelogGroup[];
}

export interface ChangelogGroup {
  /** The `###` heading as written (`Features`, `Bug Fixes`, `Performance Improvements`). */
  readonly title: string;
  readonly notes: readonly string[];
}

const RELEASE_HEADING = /^##\s+(?:\[(?<linked>[^\]]+)\]\([^)]*\)|(?<plain>\S+))(?<rest>.*)$/u;
const GROUP_HEADING = /^###\s+(?<title>.+?)\s*$/u;
const BULLET = /^\s*[-*+]\s+(?<text>.+)$/u;
const DATE = /(?<date>\d{4}-\d{2}-\d{2})/u;
const TRAILING_COMMIT = /\s*\(\[[0-9a-f]{6,40}\]\([^)]*\)\)\s*$/u;
const INLINE_LINK = /\[(?<text>[^\]]*)\]\([^)]*\)/gu;
const EMPHASIS = /(\*\*|__|`)(?<text>[^*_`]+)\1/gu;

/** One bullet's text: the trailing commit link gone, links reduced to their words, no markup. */
export const plainNote = (text: string): string =>
  text
    .replace(TRAILING_COMMIT, '')
    .replace(INLINE_LINK, '$<text>')
    .replace(EMPHASIS, '$<text>')
    .trim();

/**
 * Parses the releases in document order (newest first, as release-please writes them). Lines
 * before the first release heading — the file's title and preamble — are skipped, as are notes
 * outside any `###` group in a release without groups (they land in an untitled group instead).
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: { version: string; date: string | null; groups: ChangelogGroup[] } | null = null;
  let group: { title: string; notes: string[] } | null = null;

  const finish = () => {
    if (release !== null && group !== null) release.groups.push(group);
    if (release !== null) releases.push(release);
    release = null;
    group = null;
  };

  for (const raw of markdown.split(/\r?\n/u)) {
    const heading = RELEASE_HEADING.exec(raw);
    if (heading?.groups !== undefined) {
      finish();
      const version = heading.groups.linked ?? heading.groups.plain ?? '';
      const date = DATE.exec(heading.groups.rest ?? '')?.groups?.date ?? null;
      release = { version: version.replace(/^v/u, ''), date, groups: [] };
      continue;
    }
    if (release === null) continue;

    const groupHeading = GROUP_HEADING.exec(raw);
    if (groupHeading?.groups !== undefined) {
      if (group !== null) release.groups.push(group);
      group = { title: groupHeading.groups.title ?? '', notes: [] };
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet?.groups !== undefined) {
      const note = plainNote(bullet.groups.text ?? '');
      if (note === '') continue;
      group ??= { title: '', notes: [] };
      group.notes.push(note);
    }
  }
  finish();
  return releases;
}
