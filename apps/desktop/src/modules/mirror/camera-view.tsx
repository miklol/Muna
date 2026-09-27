import { useEffect, useRef } from 'react';

import './mirror.css';

export interface CameraViewProps {
  readonly stream: MediaStream;
  /** Draw as a mirror (`scaleX(-1)`). */
  readonly flip: boolean;
  /** 1, 1.5 or 2: a centre crop the panel's chip cycles through. */
  readonly zoom?: number;
  /** The accessible name of the preview. */
  readonly label: string;
  readonly className?: string;
}

/**
 * The live picture: a muted, inline `<video>` fed the stream through `srcObject`, covering its
 * box and flipped or zoomed with a transform — the browser decodes, nothing is drawn by hand.
 * The element is presentational to assistive tech beyond its name: there is no caption track
 * to read, and the surrounding panel says what the state is.
 */
export function CameraView({ stream, flip, zoom = 1, label, className }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return undefined;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  const transform = `${flip ? 'scaleX(-1) ' : ''}scale(${zoom})`;
  return (
    <video
      ref={videoRef}
      className={className === undefined ? 'mirror-video' : `mirror-video ${className}`}
      style={{ transform }}
      autoPlay
      muted
      playsInline
      disablePictureInPicture
      aria-label={label}
    />
  );
}
