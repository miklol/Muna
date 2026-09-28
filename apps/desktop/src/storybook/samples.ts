import type {
  Artwork,
  BluetoothSnapshot,
  CalendarEvent,
  CalendarSnapshot,
  Forecast,
  HudState,
  MediaSession,
  MediaSnapshot,
  MediaState,
  MonitorInfo,
  NotificationGroup,
  NotificationsSnapshot,
  NotificationView,
  Place,
  PomodoroState,
  SourceView,
  SystemMonitorSnapshot,
  Task,
  TodoSnapshot,
  WeatherSnapshot,
} from '@muna/contracts';

/**
 * Sample documents the module stories feed their fake services. They live here, not in the
 * modules, so the Dashboard story can compose every widget without one module importing from
 * another (ADR-0004). Times are relative to the story's clock so "today" is always today.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** Midnight today, local time. */
export const startOfToday = (): number => {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** A local time today, in Unix milliseconds. */
export const todayAt = (hours: number, minutes = 0): number =>
  startOfToday() + hours * HOUR_MS + minutes * MINUTE_MS;

// —— Bluetooth ————————————————————————————————————————————————————————————————

export const bluetoothDevices = {
  buds: {
    id: 'buds',
    name: 'Buds Pro',
    connected: true,
    batteryPercent: 80,
    kind: 'headphones',
    hidden: false,
  },
  mouse: {
    id: 'mouse',
    name: 'MX Master 3S',
    connected: true,
    batteryPercent: 45,
    kind: 'mouse',
    hidden: false,
  },
  keyboard: {
    id: 'keyboard',
    name: 'Keychron K3',
    connected: false,
    batteryPercent: null,
    kind: 'keyboard',
    hidden: false,
  },
  phone: {
    id: 'phone',
    name: 'Pixel 9',
    connected: false,
    batteryPercent: null,
    kind: 'phone',
    hidden: true,
  },
} as const satisfies Record<string, BluetoothSnapshot['devices'][number]>;

export const bluetoothSnapshot = (
  overrides: Partial<BluetoothSnapshot> = {},
): BluetoothSnapshot => ({
  radio: 'on',
  available: true,
  devices: Object.values(bluetoothDevices),
  ...overrides,
});

// —— Calendar —————————————————————————————————————————————————————————————————

export const calendarSources = {
  work: {
    id: 'work',
    name: 'Work',
    color: 'purple',
    enabled: true,
    host: 'calendar.example.com',
    status: { kind: 'ok' },
    fetchedAtMs: Date.now() - 5 * MINUTE_MS,
    eventCount: 3,
  },
  home: {
    id: 'home',
    name: 'Home',
    color: 'green',
    enabled: true,
    host: 'calendar.google.com',
    status: { kind: 'ok' },
    fetchedAtMs: Date.now() - 12 * MINUTE_MS,
    eventCount: 1,
  },
} as const satisfies Record<string, SourceView>;

const event = (overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'id'>): CalendarEvent => ({
  sourceId: 'work',
  title: 'Untitled',
  location: null,
  startMs: todayAt(9),
  endMs: todayAt(10),
  allDay: false,
  link: null,
  isMeeting: false,
  ...overrides,
});

/** Today's agenda around the current hour: one meeting under way, two later, a trip tomorrow. */
export const calendarEvents = (): CalendarEvent[] => {
  const now = new Date();
  const hour = now.getHours();
  return [
    event({
      id: 'work:standup',
      title: 'Stand-up',
      startMs: todayAt(hour, 0) - 10 * MINUTE_MS,
      endMs: todayAt(hour, 0) + 20 * MINUTE_MS,
      link: 'https://meet.example.com/standup',
      isMeeting: true,
    }),
    event({
      id: 'work:review',
      title: 'Design review',
      location: 'Room 4',
      startMs: todayAt(hour + 2),
      endMs: todayAt(hour + 3),
      link: 'https://calendar.example.com/review',
    }),
    event({
      id: 'home:dentist',
      sourceId: 'home',
      title: 'Dentist',
      location: 'Rue de Rivoli 12',
      startMs: todayAt(hour + 5),
      endMs: todayAt(hour + 5, 45),
    }),
    event({
      id: 'work:offsite',
      title: 'Team offsite',
      startMs: startOfToday() + 24 * HOUR_MS,
      endMs: startOfToday() + 48 * HOUR_MS,
      allDay: true,
    }),
  ];
};

export const calendarSnapshot = (overrides: Partial<CalendarSnapshot> = {}): CalendarSnapshot => ({
  sources: Object.values(calendarSources),
  events: calendarEvents(),
  windowStartMs: startOfToday() - 60 * 24 * HOUR_MS,
  windowEndMs: startOfToday() + 60 * 24 * HOUR_MS,
  offline: false,
  ...overrides,
});

// —— HUD ——————————————————————————————————————————————————————————————————————

export const hudState = (overrides: Partial<HudState> = {}): HudState => ({
  volume: { percent: 40, muted: false },
  micMuted: false,
  monitors: [
    { id: '\\\\.\\DISPLAY1#0', name: 'DELL U2723QE', percent: 55, kind: 'external' },
    { id: 'panel', name: 'Built-in display', percent: 80, kind: 'internal' },
  ],
  osd: 'native',
  ...overrides,
});

// —— Media ————————————————————————————————————————————————————————————————————

export const mediaSession = (overrides: Partial<MediaSession> = {}): MediaSession => ({
  sourceAppId: 'Spotify.exe',
  title: 'Weird Fishes / Arpeggi',
  artist: 'Radiohead',
  album: 'In Rainbows',
  status: 'playing',
  positionMs: 42_000,
  durationMs: 318_000,
  shuffle: false,
  repeat: 'none',
  controls: {
    play: true,
    pause: true,
    next: true,
    previous: true,
    seek: true,
    shuffle: true,
    repeat: true,
  },
  isCurrent: true,
  artVersion: 1,
  ...overrides,
});

/** A 1×1 teal PNG standing in for album art; the palette is what Rust would extract. */
export const mediaArtwork: Artwork = {
  key: 'art-1',
  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgH/8ZJXmwAAAABJRU5ErkJggg==',
  palette: ['#1f6f78', '#bf5af2', '#1c1c1e'],
  width: 300,
  height: 300,
};

export const mediaState = (
  active: MediaSession | null,
  extra: readonly MediaSession[] = [],
): MediaState => ({
  active,
  sessions: active === null ? [...extra] : [active, ...extra],
  pinned: null,
  artKey: active === null ? null : mediaArtwork.key,
});

export const mediaSnapshot = (
  active: MediaSession | null = mediaSession(),
  extra: readonly MediaSession[] = [],
): MediaSnapshot => ({
  state: mediaState(active, extra),
  art: active === null ? null : mediaArtwork,
});

// —— Notifications ————————————————————————————————————————————————————————————

const notification = (
  id: number,
  appId: string,
  overrides: Partial<Omit<NotificationView, 'id' | 'appId'>> = {},
): NotificationView => ({
  id,
  appId,
  title: `Title ${String(id)}`,
  body: `Body ${String(id)}`,
  createdAtMs: Date.now() - 5 * MINUTE_MS,
  unread: false,
  ...overrides,
});

export const notificationGroups = (): NotificationGroup[] => [
  {
    appId: 'chat',
    appName: 'Chat',
    logo: null,
    muted: false,
    notifications: [
      notification(4, 'chat', {
        title: 'Sam',
        body: 'Are you free at noon for a quick sync on the release notes?',
        createdAtMs: Date.now() - 2 * MINUTE_MS,
        unread: true,
      }),
      notification(3, 'chat', {
        title: 'Release channel',
        body: 'Build 1.4.0-rc.2 is on the staging ring',
        createdAtMs: Date.now() - 40 * MINUTE_MS,
        unread: true,
      }),
    ],
  },
  {
    appId: 'mail',
    appName: 'Mail',
    logo: null,
    muted: false,
    notifications: [
      notification(2, 'mail', {
        title: 'Invoice 2026-09',
        body: '',
        createdAtMs: Date.now() - 3 * HOUR_MS,
      }),
    ],
  },
  {
    appId: 'calendar',
    appName: 'Calendar',
    logo: null,
    muted: true,
    notifications: [
      notification(1, 'calendar', {
        title: 'Design review in 15 minutes',
        body: 'Room 4',
        createdAtMs: Date.now() - 26 * HOUR_MS,
      }),
    ],
  },
];

export const notificationsSnapshot = (
  overrides: Partial<NotificationsSnapshot> = {},
): NotificationsSnapshot => ({
  access: 'allowed',
  delivery: 'push',
  focusActive: false,
  unread: 2,
  groups: notificationGroups(),
  ...overrides,
});

// —— Pomodoro —————————————————————————————————————————————————————————————————

export const pomodoroIdle = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  phase: 'work',
  status: 'idle',
  remainingMs: 25 * MINUTE_MS,
  totalMs: 25 * MINUTE_MS,
  completedInCycle: 0,
  cycleLength: 4,
  sessionsToday: 0,
  lastFinished: null,
  ...overrides,
});

export const pomodoroRunning = (overrides: Partial<PomodoroState> = {}): PomodoroState =>
  pomodoroIdle({
    status: 'running',
    remainingMs: 17 * MINUTE_MS + 42_000,
    completedInCycle: 2,
    sessionsToday: 3,
    ...overrides,
  });

// —— System monitor ———————————————————————————————————————————————————————————

export const systemMonitorSnapshot = (
  overrides: Partial<SystemMonitorSnapshot> = {},
): SystemMonitorSnapshot => ({
  cpuPercent: 37,
  logicalCpus: 8,
  memoryUsedBytes: 15.9 * GIB,
  memoryTotalBytes: 32 * GIB,
  storageUsedBytes: 700 * GIB,
  storageTotalBytes: 1000 * GIB,
  freeDiskBytes: 120 * GIB,
  systemDiskTotalBytes: 500 * GIB,
  networkDownBytesPerS: 300 * KIB,
  networkUpBytesPerS: 12 * KIB,
  battery: { percent: 64, charging: true },
  processes: [
    { name: 'chrome', cpuTenths: 123, memoryBytes: 2.5 * GIB, count: 14 },
    { name: 'Code', cpuTenths: 61, memoryBytes: 1.2 * GIB, count: 9 },
    { name: 'muna', cpuTenths: 4, memoryBytes: 90 * MIB, count: 1 },
  ],
  sampledAtMs: Date.now(),
  ...overrides,
});

// —— Tasks ————————————————————————————————————————————————————————————————————

export const task = (overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  listId: 'inbox',
  notes: '',
  dueMs: null,
  allDay: false,
  completedAtMs: null,
  deletedAtMs: null,
  sortOrder: 0,
  createdAtMs: todayAt(8),
  updatedAtMs: todayAt(8),
  ...overrides,
});

/** An inbox with a done standup, two open tasks (one due today) and a trashed draft. */
export const todoTasks = (): Task[] => [
  task({ id: 'standup', title: 'Standup', dueMs: todayAt(10), completedAtMs: todayAt(10, 5) }),
  task({ id: 'review', title: 'Review the release notes', dueMs: todayAt(16), sortOrder: 1 }),
  task({
    id: 'expenses',
    title: 'File expenses',
    notes: 'Receipts are in the Downloads folder',
    dueMs: startOfToday() + 3 * 24 * HOUR_MS,
    allDay: true,
    sortOrder: 2,
  }),
  task({ id: 'draft', title: 'Old draft', deletedAtMs: todayAt(7), sortOrder: 3 }),
];

export const todoSnapshot = (overrides: Partial<TodoSnapshot> = {}): TodoSnapshot => ({
  lists: [
    { id: 'inbox', name: null, sortOrder: 0 },
    { id: 'work', name: 'Work', sortOrder: 1 },
  ],
  tasks: todoTasks(),
  retentionDays: 30,
  ...overrides,
});

// —— Weather ——————————————————————————————————————————————————————————————————

export const paris: Place = {
  name: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  latitude: 48.85,
  longitude: 2.35,
};

/** `YYYY-MM-DDTHH:MM` in local time, the shape the provider uses. */
const isoLocal = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const weatherForecast = (): Forecast => {
  const now = Date.now();
  const thisHour = now - (now % HOUR_MS);
  const dayMs = 24 * HOUR_MS;
  return {
    timezone: 'Europe/Paris',
    current: {
      time: isoLocal(now),
      condition: 'partlyCloudy',
      isDay: true,
      temperatureC: 17.6,
      apparentTemperatureC: 16.2,
      humidityPercent: 55,
      windKmh: 12.4,
      pressureHpa: 1013.2,
      uvIndex: 3.4,
    },
    hourly: Array.from({ length: 12 }, (_, index) => {
      const hour = new Date(thisHour + index * HOUR_MS).getHours();
      return {
        time: isoLocal(thisHour + index * HOUR_MS),
        condition: index % 3 === 1 ? 'showers' : 'partlyCloudy',
        isDay: hour >= 7 && hour < 20,
        temperatureC: 18 - index * 0.6,
        precipitationPercent: index % 3 === 1 ? 60 : index % 3 === 2 ? 5 : null,
      };
    }),
    daily: Array.from({ length: 5 }, (_, index) => {
      const day = startOfToday() + index * dayMs;
      return {
        date: isoLocal(day).slice(0, 10),
        condition: index === 1 ? 'rain' : index === 3 ? 'clear' : 'partlyCloudy',
        highC: 21.4 - index,
        lowC: 11.6 - index / 2,
        sunrise: isoLocal(day + 7 * HOUR_MS + 38 * MINUTE_MS),
        sunset: isoLocal(day + 19 * HOUR_MS + 42 * MINUTE_MS),
        precipitationPercent: index === 1 ? 80 : 20,
      };
    }),
  };
};

export const weatherSnapshot = (overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  enabled: true,
  units: 'metric',
  location: { kind: 'manual', place: paris },
  forecast: weatherForecast(),
  fetchedAtMs: Date.now() - 20 * MINUTE_MS,
  fetching: false,
  error: null,
  ...overrides,
});

// —— Monitors —————————————————————————————————————————————————————————————————

/** A 4K primary at 150 % beside a 1080p secondary, the way `list_monitors` reports them. */
export const monitors: MonitorInfo[] = [
  {
    id: '\\\\.\\DISPLAY1',
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    workArea: { x: 0, y: 0, width: 2560, height: 1392 },
    dpi: 144,
    isPrimary: true,
  },
  {
    id: '\\\\.\\DISPLAY2',
    bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
    workArea: { x: 2560, y: 0, width: 1920, height: 1032 },
    dpi: 96,
    isPrimary: false,
  },
];
