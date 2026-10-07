import { type NotchShape, NotchSurface } from '@muna/ui/primitives';
import { Activity, type ReactNode, useEffect, useRef, useState } from 'react';

interface PanelWarmupProps {
  /** The shell's shape: the copy lays out in the surface the panel opens in. */
  readonly shape: NotchShape;
  /** The open panel's width, so the copy's text wraps the way the panel's will. */
  readonly width: number;
  /** The panel's height cap, as on the shell's measurement node. */
  readonly maxHeight: number;
  /**
   * Lay the copy out and measure it. The shell asks only while it knows no panel height, so
   * once a session: the cold cost is paid once, and a forced layout on every hover could land
   * in the expand that follows. Read when the copy mounts: without it the copy is the plain
   * hidden pre-render of #71, with no host, surface or observer.
   */
  readonly layOut: boolean;
  /** Gets the panel's height once the copy has laid out, as the shell would measure it. */
  readonly onMeasure: (height: number) => void;
  /** The panel: laid out and measured. */
  readonly panel: ReactNode;
  /** Laid out with the panel but not measured (the module bar). */
  readonly children?: ReactNode;
}

/**
 * Lifts React's `display: none` off the pre-rendered copy for one forced layout and puts it
 * back before returning, in the same task, so no frame ever sees the copy. Returns the
 * panel's border-box height, or `null` while the copy is not in the document yet.
 */
const layOutOnce = (host: HTMLElement): number | null => {
  const copy = host.firstElementChild;
  if (!(copy instanceof HTMLElement)) {
    return null;
  }
  copy.style.removeProperty('display');
  const height = copy.querySelector('[data-warmup-measure]')?.getBoundingClientRect().height ?? 0;
  copy.style.setProperty('display', 'none', 'important');
  return height;
};

/**
 * The panel, pre-rendered while hover intent runs so the expand after it mounts warm (#71,
 * #81). React renders the copy hidden at idle priority: its effects never run, so no module
 * starts a timer, a frame loop or a capture for it. With `layOut`, once the copy is in the
 * document it is laid out once — in an open, morphing surface of the panel's width, as the
 * panel is when it mounts — then hidden again before the task ends. That loads the panel's
 * fonts and fills the text-shaping caches, which a session's first expand otherwise pays in
 * its first frame (a 34 ms layout against 4 ms warm), and measures the panel, so the first
 * expand opens to its height instead of re-rendering the shell mid-morph to retarget it.
 * Nothing is painted; the observer that waits for the copy goes when the pre-render does.
 */
export function PanelWarmup({
  shape,
  width,
  maxHeight,
  layOut,
  onMeasure,
  panel,
  children,
}: PanelWarmupProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Fixed for this copy's life, so learning the height mid-hover does not remount it.
  const [measured] = useState(layOut);
  useEffect(() => {
    const host = hostRef.current;
    if (!layOut || host === null) {
      return;
    }
    const warm = (): boolean => {
      const height = layOutOnce(host);
      if (height === null) {
        return false;
      }
      if (height > 0) {
        onMeasure(height);
      }
      return true;
    };
    if (warm()) {
      return;
    }
    const observer = new MutationObserver(() => {
      if (warm()) {
        observer.disconnect();
      }
    });
    observer.observe(host, { childList: true });
    return () => {
      observer.disconnect();
    };
  }, [layOut, onMeasure]);
  if (!measured) {
    return (
      <Activity mode="hidden">
        {panel}
        {children}
      </Activity>
    );
  }
  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      inert
      data-testid="panel-warmup"
      className="pointer-events-none invisible fixed inset-s-0 top-0"
    >
      <Activity mode="hidden">
        <div>
          <NotchSurface shape={shape} state="expanded" morphing style={{ width }}>
            {/* The shell's measurement node, class for class (notch-window, key="panel"). */}
            <div data-warmup-measure className="flex w-full flex-col" style={{ maxHeight }}>
              {panel}
            </div>
          </NotchSurface>
          {children}
        </div>
      </Activity>
    </div>
  );
}
