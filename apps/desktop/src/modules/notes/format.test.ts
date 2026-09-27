import { describe, expect, it } from 'vitest';

import { folderDisplayName, formatModified } from './format';

const NOW = new Date(2026, 8, 27, 10, 6).getTime();

describe('formatModified', () => {
  it('says the time for today, the date this year, and the year before that', () => {
    expect(formatModified(new Date(2026, 8, 27, 9, 30).getTime(), NOW, 'en-US')).toMatch(
      /^9:30\sAM$/,
    );
    expect(formatModified(new Date(2026, 8, 20, 18, 0).getTime(), NOW, 'en-US')).toBe('Sep 20');
    expect(formatModified(new Date(2025, 11, 31, 8, 0).getTime(), NOW, 'en-US')).toBe(
      'Dec 31, 2025',
    );
  });

  it('keeps the time for something written late last night', () => {
    expect(formatModified(new Date(2026, 8, 26, 23, 50).getTime(), NOW, 'en-US')).toMatch(
      /^11:50\sPM$/,
    );
  });
});

describe('folderDisplayName', () => {
  it('takes the last segment of a Windows or POSIX path', () => {
    expect(folderDisplayName('C:\\Users\\sam\\Documents\\Vault')).toBe('Vault');
    expect(folderDisplayName('C:\\Users\\sam\\Documents\\Vault\\')).toBe('Vault');
    expect(folderDisplayName('/home/sam/notes')).toBe('notes');
    expect(folderDisplayName('E:')).toBe('E:');
  });
});
