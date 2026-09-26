import type { MediaCommand, MediaSession, MediaState } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useMediaStore } from './media-store';
import { MediaWidget, WIDGET_ART } from './widget';

const ipc = vi.hoisted(() => ({
  getMediaSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  mediaCommand: vi.fn<(sourceAppId: string | null, command: MediaCommand) => Promise<unknown>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getMediaSnapshot: ipc.getMediaSnapshot, mediaCommand: ipc.mediaCommand },
  events: {
    mediaStateChanged: { listen: ipc.listen },
    mediaArtChanged: { listen: ipc.listen },
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
    previous: false,
    seek: true,
    shuffle: true,
    repeat: true,
  },
  isCurrent: true,
  artVersion: 1,
  ...overrides,
});

const state = (active: MediaSession | null): MediaState => ({
  active,
  sessions: active === null ? [] : [active],
  pinned: null,
  artKey: active === null ? null : 'art-1',
});

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MediaWidget span={span} />
    </I18nextProvider>,
  );

describe('MediaWidget', () => {
  beforeEach(() => {
    useMediaStore.setState({ state: null, art: null, receivedAt: 0 });
    ipc.mediaCommand.mockReset().mockResolvedValue({ status: 'ok', data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('says nothing is playing without a session', () => {
    useMediaStore.getState().setState(state(null));
    renderWidget(1);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('shows the track with small art on a narrow card and no transport', () => {
    useMediaStore.getState().setState(state(session()));
    const { container } = renderWidget(1);
    expect(screen.getByText('Weird Fishes')).toBeInTheDocument();
    expect(screen.getByText('Radiohead · In Rainbows')).toBeInTheDocument();
    expect(container.querySelector('.muna-album-art')).toHaveStyle({
      inlineSize: `${WIDGET_ART[1]}px`,
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('adds previous, play/pause and next on a wide card, disabled per the app\u2019s controls', () => {
    useMediaStore.getState().setState(state(session()));
    renderWidget(2);
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(ipc.mediaCommand).toHaveBeenCalledWith('Spotify.exe', { kind: 'pause' });

    act(() => {
      useMediaStore.getState().setState(state(session({ status: 'paused' })));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(ipc.mediaCommand).toHaveBeenLastCalledWith('Spotify.exe', { kind: 'play' });
  });

  it('falls back to the app name when the track has no artist', () => {
    useMediaStore.getState().setState(state(session({ artist: '', album: null })));
    renderWidget(2);
    expect(screen.getByText('Spotify')).toBeInTheDocument();
  });
});
