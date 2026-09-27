import { commands } from '@muna/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Why the camera could not start, as the panel names it. */
export type CameraFailure = 'denied' | 'notFound' | 'busy' | 'unsupported' | 'failed';

export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

export type CameraStatus =
  /** The module is off: nothing is asked of the browser. */
  | { readonly kind: 'off' }
  /** `getUserMedia` is pending (or the window is hidden and the stream was stopped). */
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'live';
      readonly stream: MediaStream;
      /** The camera behind the stream, when the browser names it. */
      readonly device: CameraDevice | null;
    }
  | { readonly kind: 'error'; readonly failure: CameraFailure };

export interface CameraStreamOptions {
  /** `settings.modules.mirror.enabled`: off means no attempt at all. */
  readonly enabled: boolean;
  /** The chosen camera; `null` is the system default. A camera that is gone falls back. */
  readonly deviceId: string | null;
}

export interface CameraStream {
  readonly status: CameraStatus;
  /** Every video input the browser lists; labels arrive once a stream has been granted. */
  readonly devices: readonly CameraDevice[];
  /** Asks again after an error. */
  readonly retry: () => void;
}

/** The ideal capture size: enough for a panel preview, cheap to decode. */
const CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;

const quietly = () => {
  // Outside Tauri (tests, Storybook) there is no shell to tell.
};

/** Reports a running preview to Rust so the renderer keeps its normal memory target. */
const watch = (on: boolean): void => {
  Promise.resolve()
    .then(() => commands.mirrorWatch(on))
    .catch(quietly);
};

export const stopStream = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) track.stop();
};

/** Maps a `getUserMedia` rejection onto the copy the panel has for it. */
export const classifyFailure = (error: unknown): CameraFailure => {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notFound';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
};

/** `navigator.mediaDevices`, or `null` where the browser has none (jsdom, an old runtime). */
const mediaDevices = (): MediaDevices | null => {
  if (typeof navigator === 'undefined') return null;
  const media = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  return media ?? null;
};

const listCameras = async (media: MediaDevices): Promise<CameraDevice[]> => {
  try {
    const all = await media.enumerateDevices();
    return all
      .filter((device) => device.kind === 'videoinput' && device.deviceId !== '')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return [];
  }
};

/**
 * Opens `deviceId` exactly when asked for one; a camera that is no longer there (or whose id
 * changed) falls back to the system default rather than failing the preview.
 */
const openCamera = async (media: MediaDevices, deviceId: string | null): Promise<MediaStream> => {
  if (deviceId !== null) {
    try {
      return await media.getUserMedia({
        video: { ...CONSTRAINTS, deviceId: { exact: deviceId } },
        audio: false,
      });
    } catch (error) {
      if (classifyFailure(error) !== 'notFound') throw error;
    }
  }
  return media.getUserMedia({ video: CONSTRAINTS, audio: false });
};

/** The device behind `stream`'s video track, when the browser names it. */
export const deviceOf = (stream: MediaStream): CameraDevice | null => {
  const [track] = stream.getVideoTracks();
  if (track === undefined) return null;
  const { deviceId } = track.getSettings();
  return deviceId === undefined ? null : { deviceId, label: track.label };
};

/** What one attempt at the camera came to, kept with the attempt it answers. */
interface Outcome {
  readonly key: string;
  readonly status:
    | { readonly kind: 'live'; readonly stream: MediaStream; readonly device: CameraDevice | null }
    | { readonly kind: 'error'; readonly failure: CameraFailure };
}

/**
 * A camera preview that lives exactly as long as the caller shows it (docs/modules/mirror.md):
 * the stream opens on mount while the module is enabled and the document is visible, stops on
 * unmount, when the module is turned off, when the window is hidden, and when the chosen
 * camera changes (then reopens). Rust never sees a frame; it only learns that a preview runs
 * so the shell keeps the renderer at its normal memory target.
 *
 * The status is derived: the settings and the document's visibility say `off` or `starting`
 * outright, and an outcome counts only while it answers the current attempt — a new camera,
 * a retry or the window coming back each start a new one, so a stopped stream is never shown.
 */
export function useCameraStream({ enabled, deviceId }: CameraStreamOptions): CameraStream {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const streamRef = useRef<MediaStream | null>(null);
  const key = `${deviceId ?? ''}\u0000${String(attempt)}`;
  const supported = mediaDevices() !== null;

  useEffect(() => {
    const onChange = () => {
      const shown = document.visibilityState !== 'hidden';
      setVisible(shown);
      // Coming back is a fresh attempt: the stream was stopped when the window hid.
      if (shown) setAttempt((count) => count + 1);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);

  useEffect(() => {
    const media = mediaDevices();
    if (!enabled || !visible || media === null) return undefined;
    let disposed = false;
    openCamera(media, deviceId)
      .then((stream) => {
        if (disposed) {
          stopStream(stream);
          return undefined;
        }
        streamRef.current = stream;
        watch(true);
        setOutcome({ key, status: { kind: 'live', stream, device: deviceOf(stream) } });
        // A camera that goes away ends its track; say so instead of freezing the last frame.
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            if (!disposed) setOutcome({ key, status: { kind: 'error', failure: 'notFound' } });
          });
        }
        return listCameras(media);
      })
      .then((cameras) => {
        if (cameras !== undefined && !disposed) setDevices(cameras);
      })
      .catch((error: unknown) => {
        if (!disposed)
          setOutcome({ key, status: { kind: 'error', failure: classifyFailure(error) } });
      });
    return () => {
      disposed = true;
      const stream = streamRef.current;
      if (stream !== null) {
        streamRef.current = null;
        stopStream(stream);
        watch(false);
      }
    };
  }, [enabled, deviceId, visible, key]);

  useEffect(() => {
    const media = mediaDevices();
    if (media === null || !enabled) return undefined;
    const refresh = () => {
      void listCameras(media).then(setDevices);
    };
    media.addEventListener('devicechange', refresh);
    return () => {
      media.removeEventListener('devicechange', refresh);
    };
  }, [enabled]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  let status: CameraStatus;
  if (!enabled) status = { kind: 'off' };
  else if (!visible) status = { kind: 'starting' };
  else if (!supported) status = { kind: 'error', failure: 'unsupported' };
  else if (outcome !== null && outcome.key === key) status = outcome.status;
  else status = { kind: 'starting' };

  return { status, devices, retry };
}
