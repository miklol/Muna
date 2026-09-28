import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { catalog, catalogByArea, catalogAreas, displayName } from './catalog';

interface DocRow {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
}

const docPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/02-feature-catalog.md',
);

/** The `| A1 | **Name** … | Tier |` rows of docs/02-feature-catalog.md. */
const docRows = (): readonly DocRow[] => {
  const doc = readFileSync(docPath, 'utf8');
  const rows: DocRow[] = [];
  for (const line of doc.split(/\r?\n/)) {
    const match = /^\| ([A-E]\d+) \| \*\*(.+?)\*\*.*\| \*{0,2}(P\d)\*{0,2} \|\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      rows.push({ id: match[1], name: match[2], tier: match[3] });
    }
  }
  return rows;
};

describe('catalog', () => {
  const rows = docRows();

  it('reads every feature row of the document', () => {
    expect(rows.length).toBeGreaterThanOrEqual(36);
  });

  it('mirrors the document row for row: ids, names and tiers', () => {
    const site = catalog.map(({ id, name, tier }) => ({ id, name, tier }));
    expect(site).toEqual(rows);
  });

  it('paraphrases: no summary repeats the document verbatim', () => {
    const doc = readFileSync(docPath, 'utf8');
    for (const entry of catalog) {
      expect(doc, entry.id).not.toContain(entry.summary);
    }
  });

  it('keeps the UX copy rules: sentence case, no exclamation marks', () => {
    for (const entry of catalog) {
      expect(entry.summary, entry.id).not.toMatch(/!/);
      expect(entry.summary, entry.id).toMatch(/^[A-Z]/);
      expect(entry.summary, entry.id).toMatch(/\.$/);
    }
  });

  it('lists every area with at least one shipped entry and hides P3 rows', () => {
    for (const area of catalogAreas) {
      const entries = catalogByArea(area.id);
      expect(entries.length, area.id).toBeGreaterThan(0);
      expect(
        entries.every((entry) => entry.tier !== 'P3'),
        area.id,
      ).toBe(true);
    }
    expect(catalog.find((entry) => entry.id === 'A12')?.tier).toBe('P3');
  });

  it('prefers the short title for display', () => {
    const monitor = catalog.find((entry) => entry.id === 'D6');
    expect(monitor).toBeDefined();
    if (monitor !== undefined) {
      expect(displayName(monitor)).toBe('System Monitor');
    }
    const media = catalog.find((entry) => entry.id === 'B2');
    expect(media).toBeDefined();
    if (media !== undefined) {
      expect(displayName(media)).toBe('Media');
    }
  });
});
