import type {
  Artwork,
  MediaCommand,
  MediaSession,
  MediaSnapshot,
  MediaState,
  Settings,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, writeMediaSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings } from '../../lib/settings';
import { useMediaStore } from './media-store';
import { MediaPanel, nextRepeat, usePlaybackPosition } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => {
  const channel = <T,>() => {
    const listeners: Listener<T>[] = [];
    return {
      listen: vi.fn((callback: Listener<T>) => {
        listeners.push(callback);
        return Promise.resolve(() => {
          listeners.splice(listeners.indexOf(callback), 1);
        });
      }),
      emit: (payload: T) => {
        for (const listener of [...listeners]) listener({ payload });
      },
      count: () => listeners.length,
    };
  };
  return {
    getMediaSnapshot: vi.fn<() => Promise<MediaSnapshot>>(),
    mediaCommand:
      vi.fn<(sourceAppId: string | null, command: MediaCommand) => Promise<IpcResult<null>>>(),
    mediaPin: vi.fn<(sourceAppId: string | null) => Promise<IpcResult<MediaState>>>(),
    state: channel<{ state: MediaState }>(),
    art: channel<{ art: Artwork | null }>(),
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getMediaSnapshot: ipc.getMediaSnapshot,
    mediaCommand: ipc.mediaCommand,
    mediaPin: ipc.mediaPin,
  },
  events: {
    mediaStateChanged: { listen: ipc.state.listen },
    mediaArtChanged: { listen: ipc.art.listen },
  },
}));

const session = (overrides: Partial<MediaSession> = {}): MediaSession => ({
  sourceAppId: 'Spotify.exe',
  title: 'Weird Fishes',
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

const state = (active: MediaSession | null, extra: MediaSession[] = []): MediaState => ({
  active,
  sessions: active === null ? extra : [active, ...extra],
  pinned: null,
  artKey: active === null ? null : 'art-1',
});

const artwork: Artwork = {
  key: 'art-1',
  src: 'data:image/png;base64,AA==',
  palette: ['#5ac8fa', '#bf5af2', '#1c1c1e'],
  width: 300,
  height: 300,
};

const ok = <T,>(data: T): Promise<IpcResult<T>> => Promise.resolve({ status: 'ok', data });

const queryClient = createQueryClient();

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

const renderPanel = (settings: Settings = defaultSettings()) => {
  cacheSettings(queryClient, settings);
  return render(
    <Providers>
      <MediaPanel />
    </Providers>,
  );
};

/** Lets the snapshot promise and the query cache's batched notifications run. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('MediaPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    useMediaStore.setState({ state: null, art: null, receivedAt: 0 });
    ipc.getMediaSnapshot.mockReset().mockResolvedValue({ state: state(session()), art: artwork });
    ipc.mediaCommand.mockReset().mockImplementation(() => ok(null));
    ipc.mediaPin.mockReset().mockImplementation((id) => ok({ ...state(session()), pinned: id }));
    ipc.state.listen.mockClear();
    ipc.art.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('cycles repeat off → list → track → off', () => {
    expect(nextRepeat(null)).toBe('list');
    expect(nextRepeat('none')).toBe('list');
    expect(nextRepeat('list')).toBe('track');
    expect(nextRepeat('track')).toBe('none');
  });

  it('says what to do while nothing plays', async () => {
    ipc.getMediaSnapshot.mockResolvedValue({ state: state(null), art: null });
    renderPanel();
    await flush();
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Playback controls' })).toBeNull();
  });

  it('shows the snapshot: art, title, artist · album, times and transport', async () => {
    renderPanel();
    await flush();
    expect(screen.getByRole('heading', { name: 'Weird Fishes' })).toBeInTheDocument();
    expect(screen.getByText('Radiohead · In Rainbows')).toBeInTheDocument();
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(screen.getByText('5:18')).toBeInTheDocument();
    expect(document.querySelector('.muna-album-art img')).toHaveAttribute('src', artwork.src);
    expect(document.querySelector('.muna-album-art')).toHaveAttribute('data-tinted', 'true');
    // A seekable session gets a slider the keyboard can drive.
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
    const transport = screen.getByRole('group', { name: 'Playback controls' });
    expect(within(transport).getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(within(transport).getByRole('button', { name: 'Next track' })).toBeEnabled();
  });

  it('sends transport commands for the active session and never fakes a seek', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));
    expect(ipc.mediaCommand.mock.calls.map(([id, command]) => [id, command])).toEqual([
      ['Spotify.exe', { kind: 'pause' }],
      ['Spotify.exe', { kind: 'next' }],
      ['Spotify.exe', { kind: 'setShuffle', enabled: true }],
      ['Spotify.exe', { kind: 'setRepeat', mode: 'list' }],
    ]);

    // The app stops accepting seeks and skips: the slider becomes a plain track, next disables.
    act(() => {
      ipc.state.emit({
        state: state(
          session({
            status: 'paused',
            controls: {
              play: true,
              pause: false,
              next: false,
              previous: true,
              seek: false,
              shuffle: false,
              repeat: false,
            },
          }),
        ),
      });
    });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Playback position' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeDisabled();
    expect(document.querySelector('.muna-album-art')).toHaveAttribute('data-dimmed', 'true');
  });

  it('offers the other apps as chips and pins through media_pin', async () => {
    const edge = session({ sourceAppId: 'MSEdge', title: 'Podcast', isCurrent: false });
    ipc.getMediaSnapshot.mockResolvedValue({
      state: state(session(), [edge]),
      art: artwork,
    });
    renderPanel();
    await flush();
    const apps = screen.getByRole('group', { name: 'Apps with media' });
    expect(within(apps).getByRole('button', { name: 'Show Spotify' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(apps).getByRole('button', { name: 'Show Microsoft Edge' }));
    expect(ipc.mediaPin).toHaveBeenCalledWith('MSEdge');
  });

  it('drops the palette bleed when adaptive colours are off', async () => {
    renderPanel(
      writeMediaSettings(defaultSettings(), {
        preferredApp: null,
        adaptiveColours: false,
        visualiser: 'bars',
      }),
    );
    await flush();
    expect(document.querySelector('.muna-album-art')).not.toHaveAttribute('data-tinted');
  });

  it('subscribes while mounted and unlistens on unmount', async () => {
    const { unmount } = renderPanel();
    await flush();
    expect(ipc.state.count()).toBe(1);
    expect(ipc.art.count()).toBe(1);
    unmount();
    expect(ipc.state.count()).toBe(0);
    expect(ipc.art.count()).toBe(0);
  });
});

describe('usePlaybackPosition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function Probe({
    session: current,
    at,
    now,
  }: {
    session: MediaSession;
    at: number;
    now: () => number;
  }) {
    const position = usePlaybackPosition(current, at, now);
    return <output>{position ?? 'none'}</output>;
  }

  it('steps once a second while playing and holds while paused', () => {
    let clock = 100_000;
    const now = () => clock;
    const { rerender } = render(<Probe session={session()} at={100_000} now={now} />);
    expect(screen.getByRole('status')).toHaveTextContent('42000');
    expect(vi.getTimerCount()).toBe(1);

    clock += 1_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('43000');

    rerender(
      <Probe session={session({ status: 'paused', positionMs: 50_000 })} at={clock} now={now} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('50000');
    expect(vi.getTimerCount()).toBe(0);
  });
});
