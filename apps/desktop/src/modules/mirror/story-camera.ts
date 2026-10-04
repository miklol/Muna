/**
 * A camera for Storybook (never a real one): `navigator.mediaDevices` is replaced for the
 * story's lifetime with an object whose `getUserMedia` answers the scenario — a painted canvas
 * stream, a refusal, a missing or busy camera, or a request that never comes back. Runs only in
 * the browser Storybook renders in; tests use `fake-media-devices.ts` instead.
 */

export type CameraScenario = 'live' | 'twoCameras' | 'denied' | 'notFound' | 'busy' | 'pending';

interface StoryCamera {
  readonly deviceId: string;
  readonly label: string;
  /** The painted picture's tint, so switching cameras visibly changes something. */
  readonly hue: number;
}

const FRONT: StoryCamera = { deviceId: 'story-front', label: 'Front camera', hue: 215 };
const DESK: StoryCamera = { deviceId: 'story-desk', label: 'Desk camera', hue: 25 };

const namedError = (name: string): Error => {
  const error = new Error(name);
  error.name = name;
  return error;
};

const exactDeviceId = (constraints: MediaStreamConstraints): string | null => {
  const video = constraints.video;
  if (typeof video !== 'object' || video.deviceId === undefined) return null;
  const { deviceId } = video;
  if (typeof deviceId === 'string') return deviceId;
  if (typeof deviceId === 'object' && !Array.isArray(deviceId) && 'exact' in deviceId) {
    return typeof deviceId.exact === 'string' ? deviceId.exact : null;
  }
  return null;
};

/** 640 × 360: a soft gradient with a silhouette where a face would be, slowly lit. */
const paint = (context: CanvasRenderingContext2D, hue: number, phase: number): void => {
  const { width, height } = context.canvas;
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${String(hue)} 30% 22%)`);
  sky.addColorStop(1, `hsl(${String(hue)} 25% 12%)`);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const light = context.createRadialGradient(
    width * (0.35 + 0.1 * Math.sin(phase)),
    height * 0.3,
    0,
    width * 0.5,
    height * 0.5,
    width * 0.7,
  );
  light.addColorStop(0, 'rgb(255 255 255 / 0.18)');
  light.addColorStop(1, 'rgb(255 255 255 / 0)');
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);

  context.fillStyle = `hsl(${String(hue)} 20% 40%)`;
  context.beginPath();
  context.ellipse(width / 2, height * 1.05, width * 0.3, height * 0.45, 0, Math.PI, 2 * Math.PI);
  context.fill();
  context.beginPath();
  context.arc(width / 2, height * 0.42, height * 0.2, 0, 2 * Math.PI);
  context.fill();
};

const paintedStream = (camera: StoryCamera): { stream: MediaStream; stop: () => void } => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  let phase = 0;
  if (context !== null) paint(context, camera.hue, phase);
  const stream = canvas.captureStream(15);
  const interval = window.setInterval(() => {
    phase += 0.05;
    if (context !== null) paint(context, camera.hue, phase);
  }, 1000 / 15);
  for (const track of stream.getVideoTracks()) {
    // Own properties shadow the prototype's, so the panel names the camera like a real one.
    Object.defineProperty(track, 'label', { value: camera.label, configurable: true });
    Object.defineProperty(track, 'getSettings', {
      value: () => ({ deviceId: camera.deviceId, width: 640, height: 360, frameRate: 15 }),
      configurable: true,
    });
  }
  return {
    stream,
    stop: () => {
      window.clearInterval(interval);
      for (const track of stream.getTracks()) track.stop();
    },
  };
};

/** Replaces `navigator.mediaDevices` for the scenario; the returned function puts it back. */
export const installStoryCamera = (scenario: CameraScenario): (() => void) => {
  const cameras = scenario === 'twoCameras' ? [FRONT, DESK] : [FRONT];
  const stops: (() => void)[] = [];
  const media = {
    getUserMedia: (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      switch (scenario) {
        case 'denied':
          return Promise.reject(namedError('NotAllowedError'));
        case 'notFound':
          return Promise.reject(namedError('NotFoundError'));
        case 'busy':
          return Promise.reject(namedError('NotReadableError'));
        case 'pending':
          return new Promise(() => {
            // Never answers: the panel stays on its starting state.
          });
        case 'live':
        case 'twoCameras': {
          const wanted = exactDeviceId(constraints);
          const camera = cameras.find((entry) => entry.deviceId === wanted);
          if (wanted !== null && camera === undefined) {
            return Promise.reject(namedError('OverconstrainedError'));
          }
          const painted = paintedStream(camera ?? FRONT);
          stops.push(painted.stop);
          return Promise.resolve(painted.stream);
        }
      }
    },
    enumerateDevices: (): Promise<MediaDeviceInfo[]> =>
      Promise.resolve(
        cameras.map(
          ({ deviceId, label }) =>
            ({ deviceId, label, kind: 'videoinput', groupId: '', toJSON: () => ({}) }) as const,
        ),
      ),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
  return () => {
    for (const stop of stops) stop();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  };
};
