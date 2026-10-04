/**
 * The module catalog the site shows, derived from docs/02-feature-catalog.md. `id`, `name` and
 * `tier` mirror the document row for row (`catalog.test.ts` fails when they drift); `summary`
 * is the site's own one-line paraphrase of the Windows behaviour, never the reference text.
 */

export type CatalogTier = 'P0' | 'P1' | 'P2' | 'P3';

export type CatalogArea = 'shell' | 'productivity' | 'code' | 'system' | 'support';

export interface CatalogEntry {
  /** Row id in the document (`A1`, `B2`, …). */
  readonly id: string;
  /** The bold feature name in the document, verbatim. */
  readonly name: string;
  /** Shorter display name when the document's is a mouthful. */
  readonly title?: string;
  readonly tier: CatalogTier;
  readonly area: CatalogArea;
  readonly summary: string;
}

export const catalogAreas: readonly { readonly id: CatalogArea; readonly label: string }[] = [
  { id: 'shell', label: 'The notch' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'code', label: 'Code and AI' },
  { id: 'system', label: 'Workflow and system' },
  { id: 'support', label: 'Support' },
];

/** What a tier means for someone reading the site. */
export const tierLabels: Readonly<Record<CatalogTier, string>> = {
  P0: 'In 1.0',
  P1: 'In 1.0',
  P2: 'After 1.0',
  P3: 'Not planned',
};

export const catalog: readonly CatalogEntry[] = [
  {
    id: 'A1',
    name: 'Collapsed strip',
    tier: 'P0',
    area: 'shell',
    summary:
      'A black pill flush with the top edge that rotates live activities: media, timers, events, Bluetooth and unread notifications. 32 px tall, or 24 px in compact.',
  },
  {
    id: 'A2',
    name: 'Hover-reveal strip',
    tier: 'P0',
    area: 'shell',
    summary:
      'Rest the cursor on the strip and it widens to show the track and its transport, or the timer and its controls.',
  },
  {
    id: 'A3',
    name: 'Expanded panel',
    tier: 'P0',
    area: 'shell',
    summary:
      'Rest longer or click, and the strip springs into a black-glass panel sized to the active module.',
  },
  {
    id: 'A4',
    name: 'Module bar',
    tier: 'P0',
    area: 'shell',
    summary: 'A floating pill under the panel with one icon per enabled module. Drag to reorder.',
  },
  {
    id: 'A5',
    name: 'Works without a physical notch / on external displays',
    title: 'Every monitor',
    tier: 'P0',
    area: 'shell',
    summary:
      'Muna always draws its own notch, on the monitors you choose, aware of each one\u2019s scaling. Pick the flush Notch or a floating Island.',
  },
  {
    id: 'A6',
    name: 'Notch positioning',
    tier: 'P0',
    area: 'shell',
    summary:
      'Overlay mode floats over windows and yields to title bars, tabs and drags. Reserved-strip mode makes maximised windows start below it.',
  },
  {
    id: 'A7',
    name: 'Hide from screenshots & recordings',
    tier: 'P0',
    area: 'shell',
    summary: 'One toggle keeps the notch out of screenshots, recordings and screen sharing.',
  },
  {
    id: 'A8',
    name: 'Keyboard shortcuts',
    tier: 'P1',
    area: 'shell',
    summary:
      'Global hotkeys to open, snooze and switch modules, with a shortcut recorder in Settings.',
  },
  {
    id: 'A9',
    name: 'Settings window',
    tier: 'P0',
    area: 'shell',
    summary:
      'A searchable settings window with one pane per module, following the Windows light or dark theme.',
  },
  {
    id: 'A10',
    name: 'App language',
    tier: 'P2',
    area: 'shell',
    summary:
      'English, German, French, Spanish and Brazilian Portuguese, following Windows or set by hand.',
  },
  {
    id: 'A11',
    name: 'Menu bar icon / right-click menu',
    title: 'Tray icon and context menu',
    tier: 'P0',
    area: 'shell',
    summary:
      'A tray icon and a right-click menu on the notch for settings, module shortcuts and quit.',
  },
  {
    id: 'A12',
    name: 'Trial & licensing',
    tier: 'P3',
    area: 'shell',
    summary: 'Muna is free and open source. There is no trial and nothing to unlock.',
  },
  {
    id: 'B1',
    name: 'Dashboard',
    tier: 'P1',
    area: 'productivity',
    summary:
      'Four widget slots with profiles, plus quick toggles for Focus assist, Night light, Bluetooth, Wi-Fi and keep-awake.',
  },
  {
    id: 'B2',
    name: 'Media',
    tier: 'P0',
    area: 'productivity',
    summary:
      'Album art with colours that bleed into the notch, full transport for Spotify, browsers, VLC and anything Windows reports, and a visualiser in the strip.',
  },
  {
    id: 'B3',
    name: 'Calendar',
    tier: 'P1',
    area: 'productivity',
    summary:
      'Month grid and day agenda from Outlook, Google Calendar or any ICS feed, with the next meeting and its join link in the strip.',
  },
  {
    id: 'B4',
    name: 'Todo',
    tier: 'P1',
    area: 'productivity',
    summary:
      'A local-first task list with a trash and optional sync to Microsoft To Do or Google Tasks.',
  },
  {
    id: 'B5',
    name: 'Notes',
    tier: 'P2',
    area: 'productivity',
    summary: 'Local markdown notes with quick capture from the strip.',
  },
  {
    id: 'B6',
    name: 'Pomodoro',
    tier: 'P1',
    area: 'productivity',
    summary:
      'Work and break cycles with presets, a ring in the strip and optional Focus assist while a session runs.',
  },
  {
    id: 'B7',
    name: 'Day Progress',
    tier: 'P2',
    area: 'productivity',
    summary: 'One timeline for today from your events and tasks, with gaps you can fill.',
  },
  {
    id: 'B8',
    name: 'Screen Time',
    tier: 'P2',
    area: 'productivity',
    summary: 'Which apps had your attention today, by category. Tracked on your PC and kept there.',
  },
  {
    id: 'B9',
    name: 'Health',
    tier: 'P2',
    area: 'productivity',
    summary: 'Rings for breaks, water and mindful minutes, a sitting timer and eye-rest prompts.',
  },
  {
    id: 'B10',
    name: 'Weather',
    tier: 'P1',
    area: 'productivity',
    summary:
      'Hourly and seven-day forecasts from Open-Meteo, for your location or a city you pick. No account.',
  },
  {
    id: 'B11',
    name: 'Notifications',
    tier: 'P1',
    area: 'productivity',
    summary:
      'Your Windows notifications in one list with actions, an unread glance in the strip and a Focus assist toggle.',
  },
  {
    id: 'C1',
    name: 'AI Coding (Beta)',
    tier: 'P2',
    area: 'code',
    summary:
      'Coding-agent sessions in one list with live status, and Allow or Deny for permission prompts right from the strip.',
  },
  {
    id: 'C2',
    name: 'Code hosting',
    tier: 'P1',
    area: 'code',
    summary:
      'Pull requests waiting for you on GitHub, GitLab and Bitbucket, pipeline status and Jira issues.',
  },
  {
    id: 'C3',
    name: 'Translation',
    tier: 'P2',
    area: 'code',
    summary:
      'Translate with OpenAI, Ollama or any compatible endpoint you configure, with dictation.',
  },
  {
    id: 'D1',
    name: 'Live Activities',
    tier: 'P0',
    area: 'system',
    summary:
      'Media, timers, events and Bluetooth take turns in the strip, and a redesigned volume and brightness HUD replaces the Windows flyout.',
  },
  {
    id: 'D2',
    name: 'Drop Actions',
    tier: 'P1',
    area: 'system',
    summary:
      'Drag files to the notch for action tiles: shelf, Nearby Share, cloud folders, zip, convert, move, copy, open with and Recycle Bin.',
  },
  {
    id: 'D3',
    name: 'Shelf',
    tier: 'P1',
    area: 'system',
    summary: 'Stash files in the notch and drag them out later into any app.',
  },
  {
    id: 'D4',
    name: 'Window snap',
    tier: 'P1',
    area: 'system',
    summary:
      'Drag a window toward the top and the notch shows layout zones: halves, thirds, quarters and your own.',
  },
  {
    id: 'D5',
    name: 'Bluetooth',
    tier: 'P1',
    area: 'system',
    summary: 'Connected gear with battery levels, connect and disconnect, and low-battery notices.',
  },
  {
    id: 'D6',
    name: 'System Monitor ("System Analytics")',
    title: 'System Monitor',
    tier: 'P1',
    area: 'system',
    summary: 'Live CPU, memory, storage, network and battery as ring gauges.',
  },
  {
    id: 'D7',
    name: 'Session lock',
    tier: 'P2',
    area: 'system',
    summary: 'A notice in the strip when the session locks and unlocks.',
  },
  {
    id: 'D8',
    name: 'Mirror',
    tier: 'P2',
    area: 'system',
    summary: 'A tiny camera mirror as a dashboard widget, with a clear privacy indicator.',
  },
  {
    id: 'D9',
    name: 'Battery live activity',
    tier: 'P0',
    area: 'system',
    summary: 'Charging and low-battery pills in the strip.',
  },
  {
    id: 'E1',
    name: 'Support',
    tier: 'P2',
    area: 'support',
    summary:
      'Help, feedback and a diagnostics bundle you can attach to an issue, all from inside the panel.',
  },
];

/** Entries the site lists, grouped by area and in document order. P3 rows are out of scope. */
export const catalogByArea = (area: CatalogArea): readonly CatalogEntry[] =>
  catalog.filter((entry) => entry.area === area && entry.tier !== 'P3');

export const displayName = (entry: CatalogEntry): string => entry.title ?? entry.name;
