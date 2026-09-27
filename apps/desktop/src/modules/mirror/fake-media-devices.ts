import { vi } from 'vitest';

/**
 * A stand-in for `navigator.mediaDevices` (jsdom has none): scripted `getUserMedia` answers,
 * a device list, and streams whose tracks can be stopped and ended. Nothing here ever touches
 * a real camera.
 */

export interface FakeTrack extends MediaStreamTrack {
  /** How many times `stop()` was called. */
  readonly stops: number;
  /** Fires the track's `ended` listeners, as an unplugged camera would. */
  end: () => void;
}

export interface FakeStream extends MediaStream {
  readonly tracks: readonly FakeTrack[];
}

export const fakeTrack = (deviceId: string, label: string): FakeTrack => {
  const listeners = new Set<() => void>();
  const track = {
    kind: 'video',
    label,
    readyState: 'live',
    stops: 0,
    stop: () => {
      track.stops += 1;
      track.readyState = 'ended';
    },
    getSettings: () => ({ deviceId }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'ended') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'ended') listeners.delete(listener);
    },
    end: () => {
      track.readyState = 'ended';
      for (const listener of [...listeners]) listener();
    },
  };
  return track as unknown as FakeTrack;
};

export const fakeStream = (deviceId = 'cam-1', label = 'Front camera'): FakeStream => {
  const tracks = [fakeTrack(deviceId, label)];
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as FakeStream;
};

export const fakeDevice = (
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = 'videoinput',
): MediaDeviceInfo => ({ deviceId, label, kind, groupId: '', toJSON: () => ({}) });

export const namedError = (name: string): Error => {
  const error = new Error(name);
  error.name = name;
  return error;
};

export interface FakeMediaDevices {
  readonly getUserMedia: ReturnType<
    typeof vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>
  >;
  readonly enumerateDevices: ReturnType<typeof vi.fn<() => Promise<MediaDeviceInfo[]>>>;
  /** Fires `devicechange`. */
  readonly changeDevices: () => void;
}

/** Installs the fake on `navigator`; the returned `restore` puts the original back. */
export const installFakeMediaDevices = (): FakeMediaDevices & { restore: () => void } => {
  const listeners = new Set<() => void>();
  const media = {
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    enumerateDevices: vi.fn<() => Promise<MediaDeviceInfo[]>>().mockResolvedValue([]),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'devicechange') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'devicechange') listeners.delete(listener);
    },
  };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
  return {
    getUserMedia: media.getUserMedia,
    enumerateDevices: media.enumerateDevices,
    changeDevices: () => {
      for (const listener of [...listeners]) listener();
    },
    restore: () => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(navigator, 'mediaDevices');
      } else {
        Object.defineProperty(navigator, 'mediaDevices', descriptor);
      }
    },
  };
};

/** Sets `document.visibilityState` and fires `visibilitychange`. */
export const setDocumentVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
