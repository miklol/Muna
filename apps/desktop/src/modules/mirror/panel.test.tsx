import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  type IpcError,
  readMirrorSettings,
  type Settings,
  writeMirrorSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import {
  fakeDevice,
  type FakeMediaDevices,
  fakeStream,
  installFakeMediaDevices,
  namedError,
  setDocumentVisibility,
} from './fake-media-devices';
import { formatZoom, MirrorPanel, nextCamera, nextZoom } from './panel';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  mirrorWatch: vi.fn<(watching: boolean) => Promise<void>>(),
  openSettings: vi.fn<() => Promise<void>>(),
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    mirrorWatch: ipc.mirrorWatch,
    openSettings: ipc.openSettings,
    updateSettings: ipc.updateSettings,
  },
}));

const queryClient = createQueryClient();
queryClient.setQueryDefaults(settingsQueryKey, { gcTime: Number.POSITIVE_INFINITY });

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

const enabled = (overrides: Partial<Contracts.MirrorSettings> = {}): Settings =>
  writeMirrorSettings(defaultSettings(), {
    enabled: true,
    flip: true,
    deviceId: null,
    deviceLabel: null,
    ...overrides,
  });

const renderPanel = (settings: Settings = enabled()) => {
  cacheSettings(queryClient, settings);
  return render(
    <Providers>
      <MirrorPanel />
    </Providers>,
  );
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

const saved = () => readMirrorSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

const video = () => screen.getByLabelText('Camera preview');

describe('nextZoom', () => {
  it('cycles 1, 1.5, 2 and back', () => {
    expect(nextZoom(1)).toBe(1.5);
    expect(nextZoom(1.5)).toBe(2);
    expect(nextZoom(2)).toBe(1);
    expect(nextZoom(3)).toBe(1);
  });
});

describe('nextCamera', () => {
  const devices = [
    { deviceId: 'a', label: 'A' },
    { deviceId: 'b', label: 'B' },
    { deviceId: 'c', label: 'C' },
  ];
  it('walks the list from the current camera and wraps', () => {
    expect(nextCamera(devices, 'a')?.deviceId).toBe('b');
    expect(nextCamera(devices, 'c')?.deviceId).toBe('a');
    expect(nextCamera(devices, null)?.deviceId).toBe('a');
    expect(nextCamera(devices, 'unknown')?.deviceId).toBe('a');
  });
  it('offers nothing with fewer than two cameras', () => {
    expect(nextCamera([], null)).toBeNull();
    expect(nextCamera(devices.slice(0, 1), 'a')).toBeNull();
  });
});

describe('formatZoom', () => {
  it('prints the factor in the locale with one decimal at most', () => {
    expect(formatZoom(1, 'en')).toBe('1');
    expect(formatZoom(1.5, 'en')).toBe('1.5');
    expect(formatZoom(1.5, 'de')).toBe('1,5');
  });
});

describe('MirrorPanel', () => {
  let media: FakeMediaDevices & { restore: () => void };

  beforeEach(() => {
    vi.useFakeTimers();
    media = installFakeMediaDevices();
    setDocumentVisibility('visible');
    ipc.mirrorWatch.mockReset().mockResolvedValue(undefined);
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
  });

  afterEach(() => {
    cleanup();
    media.restore();
    vi.useRealTimers();
  });

  it('says the module is off, points at Settings and asks nothing of the camera', async () => {
    renderPanel(defaultSettings());
    await flush();
    expect(screen.getByRole('heading', { name: 'Mirror is off' })).toBeInTheDocument();
    expect(screen.getByText(/Turn it on in Settings to check your camera/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument();
  });

  it('shows the camera starting, then the mirrored picture with the camera named in the head', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream('cam-1', 'Front camera'));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Starting the camera' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Starting the camera');
    await flush();
    expect(screen.getByRole('heading', { name: 'Front camera' })).toBeInTheDocument();
    expect(video()).toHaveStyle({ transform: 'scaleX(-1) scale(1)' });
    expect(video()).toHaveAttribute('autoplay');
    expect(video()).toHaveAttribute('playsinline');
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(true);
  });

  it('turns the mirror off from the chip and remembers it', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream());
    renderPanel();
    await flush();
    const chip = screen.getByRole('button', { name: 'Mirror the image' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    await flush();
    expect(saved().flip).toBe(false);
    expect(video()).toHaveStyle({ transform: 'scale(1)' });
  });

  it('cycles the zoom 1×, 1.5×, 2× and back without touching the settings', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream());
    renderPanel();
    await flush();
    const zoom = screen.getByRole('button', { name: 'Zoom 1' });
    expect(zoom).toHaveTextContent('1×');
    fireEvent.click(zoom);
    expect(screen.getByRole('button', { name: 'Zoom 1.5' })).toHaveTextContent('1.5×');
    expect(video()).toHaveStyle({ transform: 'scaleX(-1) scale(1.5)' });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 1.5' }));
    expect(video()).toHaveStyle({ transform: 'scaleX(-1) scale(2)' });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 2' }));
    expect(video()).toHaveStyle({ transform: 'scaleX(-1) scale(1)' });
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('offers the next camera only with two or more and persists the choice with its label', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream('cam-1', 'Front camera'));
    media.enumerateDevices.mockResolvedValue([fakeDevice('cam-1', 'Front camera')]);
    const view = renderPanel();
    await flush();
    expect(screen.queryByRole('button', { name: 'Next camera' })).not.toBeInTheDocument();
    view.unmount();
    await flush();

    media.enumerateDevices.mockResolvedValue([
      fakeDevice('cam-1', 'Front camera'),
      fakeDevice('cam-2', 'Desk camera'),
    ]);
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Next camera' }));
    await flush();
    expect(saved()).toMatchObject({ deviceId: 'cam-2', deviceLabel: 'Desk camera' });
  });

  it('names a refusal, a missing camera and a busy one, and tries again on request', async () => {
    media.getUserMedia.mockRejectedValueOnce(namedError('NotAllowedError'));
    const view = renderPanel();
    await flush();
    expect(screen.getByRole('heading', { name: 'Camera access was refused' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Windows or another setting blocked/);
    expect(screen.queryByRole('button', { name: 'Mirror the image' })).not.toBeInTheDocument();

    media.getUserMedia.mockResolvedValueOnce(fakeStream('cam-1', 'Front camera'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Front camera' })).toBeInTheDocument();
    view.unmount();
    await flush();

    media.getUserMedia.mockRejectedValueOnce(namedError('NotFoundError'));
    renderPanel();
    await flush();
    expect(screen.getByRole('heading', { name: 'No camera found' })).toBeInTheDocument();
    cleanup();

    media.getUserMedia.mockRejectedValueOnce(namedError('NotReadableError'));
    renderPanel();
    await flush();
    expect(screen.getByRole('heading', { name: 'The camera is in use' })).toBeInTheDocument();
  });

  it('opens Settings from the head', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream());
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
  });

  it('stops the camera when the panel goes away and tells Rust', async () => {
    const stream = fakeStream();
    media.getUserMedia.mockResolvedValue(stream);
    const view = renderPanel();
    await flush();
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(true);
    view.unmount();
    await flush();
    expect(stream.tracks[0]?.stops).toBe(1);
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
