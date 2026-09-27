import type * as Contracts from '@muna/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fakeDevice,
  type FakeMediaDevices,
  fakeStream,
  installFakeMediaDevices,
  namedError,
  setDocumentVisibility,
} from './fake-media-devices';
import { classifyFailure, deviceOf, useCameraStream } from './use-camera-stream';

const ipc = vi.hoisted(() => ({
  mirrorWatch: vi.fn<(watching: boolean) => Promise<void>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { mirrorWatch: ipc.mirrorWatch },
}));

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

describe('classifyFailure', () => {
  it('maps the getUserMedia errors onto the panel states', () => {
    expect(classifyFailure(namedError('NotAllowedError'))).toBe('denied');
    expect(classifyFailure(namedError('SecurityError'))).toBe('denied');
    expect(classifyFailure(namedError('NotFoundError'))).toBe('notFound');
    expect(classifyFailure(namedError('OverconstrainedError'))).toBe('notFound');
    expect(classifyFailure(namedError('NotReadableError'))).toBe('busy');
    expect(classifyFailure(namedError('AbortError'))).toBe('busy');
    expect(classifyFailure(namedError('TypeError'))).toBe('failed');
    expect(classifyFailure('nope')).toBe('failed');
  });
});

describe('deviceOf', () => {
  it('names the device behind the video track, or nothing without a track', () => {
    expect(deviceOf(fakeStream('cam-2', 'Desk camera'))).toEqual({
      deviceId: 'cam-2',
      label: 'Desk camera',
    });
    const empty = { getVideoTracks: () => [], getTracks: () => [] } as unknown as MediaStream;
    expect(deviceOf(empty)).toBeNull();
  });
});

describe('useCameraStream', () => {
  let media: FakeMediaDevices & { restore: () => void };

  beforeEach(() => {
    media = installFakeMediaDevices();
    setDocumentVisibility('visible');
    ipc.mirrorWatch.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    media.restore();
  });

  it('asks nothing of the browser while the module is off', async () => {
    const { result } = renderHook(() => useCameraStream({ enabled: false, deviceId: null }));
    await flush();
    expect(result.current.status).toEqual({ kind: 'off' });
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(ipc.mirrorWatch).not.toHaveBeenCalled();
  });

  it('opens the default camera, reports the preview to Rust, lists the cameras and stops on unmount', async () => {
    const stream = fakeStream('cam-1', 'Front camera');
    media.getUserMedia.mockResolvedValue(stream);
    media.enumerateDevices.mockResolvedValue([
      fakeDevice('cam-1', 'Front camera'),
      fakeDevice('mic-1', 'Microphone', 'audioinput'),
      fakeDevice('', 'Hidden before permission'),
      fakeDevice('cam-2', 'Desk camera'),
    ]);
    const { result, unmount } = renderHook(() =>
      useCameraStream({ enabled: true, deviceId: null }),
    );
    expect(result.current.status).toEqual({ kind: 'starting' });
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.getUserMedia.mock.calls[0]?.[0]).toEqual({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    expect(result.current.status).toEqual({
      kind: 'live',
      stream,
      device: { deviceId: 'cam-1', label: 'Front camera' },
    });
    expect(result.current.devices).toEqual([
      { deviceId: 'cam-1', label: 'Front camera' },
      { deviceId: 'cam-2', label: 'Desk camera' },
    ]);
    expect(ipc.mirrorWatch).toHaveBeenCalledTimes(1);
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(true);

    unmount();
    await flush();
    expect(stream.tracks[0]?.stops).toBe(1);
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(false);
  });

  it('asks for the chosen camera exactly and falls back to the default when it is gone', async () => {
    const stream = fakeStream('cam-1', 'Front camera');
    media.getUserMedia
      .mockRejectedValueOnce(namedError('OverconstrainedError'))
      .mockResolvedValueOnce(stream);
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: 'gone' }));
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(media.getUserMedia.mock.calls[0]?.[0]).toEqual({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: { exact: 'gone' } },
      audio: false,
    });
    expect(media.getUserMedia.mock.calls[1]?.[0]).toEqual({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    expect(result.current.status.kind).toBe('live');
  });

  it('does not fall back past a refusal or a busy camera', async () => {
    media.getUserMedia.mockRejectedValue(namedError('NotAllowedError'));
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: 'cam-1' }));
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual({ kind: 'error', failure: 'denied' });
    expect(ipc.mirrorWatch).not.toHaveBeenCalled();
  });

  it('tries again on retry', async () => {
    media.getUserMedia
      .mockRejectedValueOnce(namedError('NotReadableError'))
      .mockResolvedValueOnce(fakeStream());
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: null }));
    await flush();
    expect(result.current.status).toEqual({ kind: 'error', failure: 'busy' });
    act(() => {
      result.current.retry();
    });
    expect(result.current.status).toEqual({ kind: 'starting' });
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.status.kind).toBe('live');
  });

  it('reopens on the new camera when the chosen device changes, stopping the old stream', async () => {
    const first = fakeStream('cam-1', 'Front camera');
    const second = fakeStream('cam-2', 'Desk camera');
    media.getUserMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string | null }) => useCameraStream({ enabled: true, deviceId }),
      { initialProps: { deviceId: null as string | null } },
    );
    await flush();
    expect(result.current.status.kind).toBe('live');

    rerender({ deviceId: 'cam-2' });
    expect(result.current.status).toEqual({ kind: 'starting' });
    expect(first.tracks[0]?.stops).toBe(1);
    await flush();
    expect(result.current.status).toEqual({
      kind: 'live',
      stream: second,
      device: { deviceId: 'cam-2', label: 'Desk camera' },
    });
    expect(ipc.mirrorWatch.mock.calls.map(([on]) => on)).toEqual([true, false, true]);
  });

  it('stops the camera when the module is turned off', async () => {
    const stream = fakeStream();
    media.getUserMedia.mockResolvedValue(stream);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCameraStream({ enabled, deviceId: null }),
      { initialProps: { enabled: true } },
    );
    await flush();
    expect(result.current.status.kind).toBe('live');
    rerender({ enabled: false });
    expect(result.current.status).toEqual({ kind: 'off' });
    expect(stream.tracks[0]?.stops).toBe(1);
    await flush();
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(false);
  });

  it('stops while the window is hidden and opens again when it shows', async () => {
    const first = fakeStream();
    const second = fakeStream();
    media.getUserMedia.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: null }));
    await flush();
    expect(result.current.status.kind).toBe('live');

    act(() => {
      setDocumentVisibility('hidden');
    });
    expect(result.current.status).toEqual({ kind: 'starting' });
    expect(first.tracks[0]?.stops).toBe(1);
    await flush();
    expect(ipc.mirrorWatch).toHaveBeenLastCalledWith(false);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    act(() => {
      setDocumentVisibility('visible');
    });
    expect(result.current.status).toEqual({ kind: 'starting' });
    await flush();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.status).toMatchObject({ kind: 'live', stream: second });
  });

  it('says the camera is gone when its track ends', async () => {
    const stream = fakeStream();
    media.getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: null }));
    await flush();
    act(() => {
      stream.tracks[0]?.end();
    });
    expect(result.current.status).toEqual({ kind: 'error', failure: 'notFound' });
  });

  it('refreshes the camera list when devices change', async () => {
    media.getUserMedia.mockResolvedValue(fakeStream());
    media.enumerateDevices.mockResolvedValue([fakeDevice('cam-1', 'Front camera')]);
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: null }));
    await flush();
    expect(result.current.devices).toHaveLength(1);
    media.enumerateDevices.mockResolvedValue([
      fakeDevice('cam-1', 'Front camera'),
      fakeDevice('cam-2', 'Desk camera'),
    ]);
    act(() => {
      media.changeDevices();
    });
    await flush();
    expect(result.current.devices).toHaveLength(2);
  });

  it('reports an unsupported browser without a mediaDevices object', async () => {
    media.restore();
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useCameraStream({ enabled: true, deviceId: null }));
    await flush();
    expect(result.current.status).toEqual({ kind: 'error', failure: 'unsupported' });
    media = installFakeMediaDevices();
  });
});
