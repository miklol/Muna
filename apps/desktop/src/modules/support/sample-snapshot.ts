import type { SupportSnapshot } from '@muna/contracts';

/** A snapshot for stories and tests: a Windows 11 machine running a debug build with a changelog. */
export const sampleSnapshot = (overrides: Partial<SupportSnapshot> = {}): SupportSnapshot => ({
  version: '0.3.0',
  channel: 'stable',
  system: { os: 'Windows 11 Pro (build 26200)', webview2: '140.0.3485.54' },
  profileDir: 'C:\\Users\\sam\\AppData\\Roaming\\Muna',
  logsBytes: 1_258_291,
  lastBundle: null,
  changelog: true,
  ...overrides,
});
