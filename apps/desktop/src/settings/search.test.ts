import { describe, expect, it } from 'vitest';

import {
  paneIds,
  paneTitleKey,
  type SearchablePane,
  searchSettings,
  settingsIndex,
} from './search';

const panes: readonly SearchablePane[] = [
  ...paneIds.map((id) => ({ id, title: paneTitleKey[id].split('.').at(-1) ?? id })),
  { id: 'module:media', title: 'Now playing' },
];
const label = (entry: { id: string }) => entry.id.split('.').at(-1) ?? '';

describe('searchSettings', () => {
  it('returns null for a blank query, meaning show everything', () => {
    expect(searchSettings('', panes, label)).toBeNull();
    expect(searchSettings('   ', panes, label)).toBeNull();
  });

  it('matches synonyms and keeps panes in sidebar order', () => {
    const matches = searchSettings('startup', panes, label);
    expect(matches?.panes).toEqual(['general']);
    expect([...(matches?.rows ?? [])]).toEqual(['general.launchAtLogin']);
  });

  it('requires every word to match somewhere on the same row', () => {
    const matches = searchSettings('screen share', panes, label);
    expect([...(matches?.rows ?? [])]).toEqual(['general.hideFromCaptures']);
    expect(searchSettings('screen elephant', panes, label)?.panes).toEqual([]);
  });

  it('a pane title lists the whole pane', () => {
    const matches = searchSettings('about', panes, label);
    expect(matches?.panes).toEqual(['about']);
    const aboutRows = settingsIndex
      .filter((entry) => entry.pane === 'about')
      .map((entry) => entry.id);
    expect([...(matches?.rows ?? [])]).toEqual(aboutRows);
  });

  it('ignores case and accents', () => {
    expect(searchSettings('COLOUR', panes, label)?.rows.has('appearance.accent')).toBe(true);
    expect(searchSettings('centré', panes, label)?.rows.has('position.offsetX')).toBe(true);
  });

  it('finds module panes by title', () => {
    const matches = searchSettings('playing', panes, label);
    expect(matches?.panes).toEqual(['module:media']);
    expect(matches?.rows.size).toBe(0);
  });

  it('every index entry points at a built-in pane and has a unique id', () => {
    const ids = settingsIndex.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of settingsIndex) {
      expect(paneIds).toContain(entry.pane);
      expect(entry.id.startsWith(`${entry.pane}.`)).toBe(true);
    }
  });
});
