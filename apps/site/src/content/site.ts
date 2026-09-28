/** Where the site points. One place to change when the project moves. */
export const links = {
  repo: 'https://github.com/miklol/Muna',
  releases: 'https://github.com/miklol/Muna/releases',
  latestRelease: 'https://github.com/miklol/Muna/releases/latest',
  issues: 'https://github.com/miklol/Muna/issues',
  discussions: 'https://github.com/miklol/Muna/discussions',
  docs: 'https://github.com/miklol/Muna/tree/main/docs',
  privacyDoc: 'https://github.com/miklol/Muna/blob/main/docs/01-product-vision.md',
  releaseDoc: 'https://github.com/miklol/Muna/blob/main/docs/10-release-distribution.md',
} as const;

export interface DownloadOption {
  readonly id: 'msix' | 'nsis';
  readonly title: string;
  readonly recommended: boolean;
  /** Artefact name pattern from docs/10-release-distribution.md. */
  readonly artefact: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly action: string;
}

/** The two installers from docs/10-release-distribution.md, in the order the page shows them. */
export const downloads: readonly DownloadOption[] = [
  {
    id: 'msix',
    title: 'Installer package',
    recommended: true,
    artefact: 'Muna_<version>_x64.msix',
    summary: 'The default. Installs per user, without administrator rights.',
    details: [
      'Comes with package identity, so the Notifications module can read your notifications.',
      'Updates through App Installer.',
    ],
    action: 'Download the installer package',
  },
  {
    id: 'nsis',
    title: 'Setup program',
    recommended: false,
    artefact: 'Muna_<version>_x64-setup.exe',
    summary: 'For PCs where packaged apps are blocked, such as some managed devices.',
    details: [
      'Installs per user and adds the WebView2 runtime when it is missing.',
      'Updates itself from inside Muna. Notifications fall back to polling where identity is unavailable.',
    ],
    action: 'Download the setup program',
  },
];

export const requirements: readonly string[] = [
  'Windows 10 22H2 or Windows 11, 64-bit',
  'The WebView2 runtime, included with Windows 11 and installed by the setup program when missing',
  'About 25 MB of disk space, not counting WebView2',
];

export interface FaqEntry {
  readonly id: string;
  readonly question: string;
  readonly answer: readonly string[];
}

/** Answers paraphrase the product decisions in docs/01-product-vision.md. */
export const faq: readonly FaqEntry[] = [
  {
    id: 'title-bars',
    question: 'Does the notch cover my browser tabs and title bars?',
    answer: [
      'In Overlay mode, the default, the strip floats over your windows and is click-through everywhere except on its own pixels. When a window\u2019s title bar or tab strip sits under it, or while you drag a window across it, the strip yields to a thin line at the top edge and comes back when the way is clear.',
      'If you would rather never share the space, Reserved strip mode registers the top 32 px with Windows so maximised windows start below it. You choose per monitor.',
    ],
  },
  {
    id: 'games',
    question: 'What happens in full-screen games?',
    answer: [
      'Exclusive full-screen apps cannot be drawn over. Muna notices when one is in front, pauses its own rendering to save CPU and GPU time, and returns when you leave the game.',
    ],
  },
  {
    id: 'identity',
    question: 'Why are there two installers?',
    answer: [
      'Windows only lets apps with package identity read your notifications. The installer package (.msix) has identity built in, so the Notifications module works fully. The setup program (.exe) registers an identity where Windows allows it and otherwise keeps every other module working.',
    ],
  },
  {
    id: 'no-notch',
    question: 'My monitor has no notch. Does that matter?',
    answer: [
      'No. Muna draws its own notch on every monitor you enable it on, sized for that monitor\u2019s scaling. Choose the flush Notch shape or a floating Island with rounded corners, and nudge its position if it sits over something you need.',
    ],
  },
  {
    id: 'hud',
    question: 'Does Muna replace the Windows volume and brightness pop-up?',
    answer: [
      'Yes. While Muna runs, volume and brightness keys show a level in the strip instead of the Windows pop-up. The pop-up is restored when Muna exits, and a watchdog restores it even after a crash.',
    ],
  },
  {
    id: 'cost',
    question: 'What does Muna cost?',
    answer: [
      'Nothing. Muna is free and open source, with no trial, licence key or subscription. Integrations with other services use your own accounts.',
    ],
  },
  {
    id: 'monitors',
    question: 'Does it work with several monitors and display scaling?',
    answer: [
      'Yes. Each monitor has its own switch, shape, placement and size, and Muna follows each one\u2019s scaling when windows move between them.',
    ],
  },
  {
    id: 'languages',
    question: 'Which languages does Muna speak?',
    answer: [
      'The app is available in English, German, French, Spanish and Brazilian Portuguese, following your Windows display language or a language you pick. This site is in English.',
    ],
  },
];

export interface PrivacyPoint {
  readonly title: string;
  readonly body: string;
}

export const privacy: readonly PrivacyPoint[] = [
  {
    title: 'No telemetry',
    body: 'Muna sends no usage data, analytics or crash reports. There is nothing to opt out of, because nothing is collected.',
  },
  {
    title: 'Local first',
    body: 'Screen time, notes, tasks, notifications and health rings are stored on your PC in a local database and never leave it.',
  },
  {
    title: 'Integrations are opt in',
    body: 'Calendar, tasks, code hosting, weather and translation providers connect only when you sign in or add an endpoint, and each one can be disconnected in Settings.',
  },
  {
    title: 'Secrets stay in Windows',
    body: 'Access tokens live in Windows Credential Manager, not in files, and are never written to logs. Logs never contain notification text either.',
  },
  {
    title: 'One network call of its own',
    body: 'Left alone, Muna only checks the GitHub release feed for updates, on launch and every six hours. Weather, calendars and other providers connect only once you enable them.',
  },
  {
    title: 'The camera is yours',
    body: 'The mirror widget shows a preview only while it is on screen, stops the camera the moment it is hidden, and never records.',
  },
];
