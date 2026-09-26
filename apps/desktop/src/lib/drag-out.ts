/**
 * Drag-out from the notch (docs/modules/shelf.md "Drag out", docs/spikes/m4-drag.md).
 *
 * The webview only detects the gesture: a primary-button press that travels past
 * `DRAG_OUT_THRESHOLD_PX` while the button is still down. Rust then runs the OLE drag on the
 * window's thread (`commands.dragOut`) and the promise settles when the user drops or cancels.
 * WebView2's own HTML5 drag is suppressed on the armed element so the two never race.
 */
import type { DragOutRequest, DragOutcome } from '@muna/contracts';
import { commands } from '@muna/contracts';
import { type RefObject, useEffect, useState } from 'react';

/** How far a press travels before it is a drag, in CSS px (Windows' default drag rectangle). */
export const DRAG_OUT_THRESHOLD_PX = 6;

const PRIMARY_BUTTON = 0;
const PRIMARY_BUTTON_MASK = 1;

export interface Point {
  x: number;
  y: number;
}

/**
 * Turns pointer events into one "start the drag now" decision per press; pure so it is
 * testable without a DOM. After `move` reports the start, the tracker waits for the next
 * `down`.
 */
export class DragGesture {
  private origin: Point | null = null;

  /** A press; only the primary button arms the gesture. */
  down(point: Point, button: number): void {
    this.origin = button === PRIMARY_BUTTON ? point : null;
  }

  /**
   * `true` exactly once per press, when the pointer has travelled past the threshold with the
   * button still down. A move without the button (the release never reached us) disarms.
   */
  move(point: Point, buttons: number): boolean {
    if (this.origin === null) {
      return false;
    }
    if ((buttons & PRIMARY_BUTTON_MASK) === 0) {
      this.origin = null;
      return false;
    }
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    if (dx * dx + dy * dy < DRAG_OUT_THRESHOLD_PX * DRAG_OUT_THRESHOLD_PX) {
      return false;
    }
    this.origin = null;
    return true;
  }

  /** The button came up (or the pointer was cancelled) before the threshold. */
  up(): void {
    this.origin = null;
  }

  get armed(): boolean {
    return this.origin !== null;
  }
}

export interface DragOutHandlers {
  /** The drag ended: dropped with the effect the target applied, or cancelled. */
  onOutcome?: ((outcome: DragOutcome) => void) | undefined;
  /** The webview tried to start its own HTML5 drag of the element (suppressed). */
  onNativeDragStart?: (() => void) | undefined;
}

const ignoreIpcFailure = () => {
  // Not running inside Tauri (tests, Storybook), or the platform refused: nothing to drag.
};

/**
 * Arms `ref`'s element: a primary press that travels past the threshold starts an OLE drag of
 * `request`; `null` disarms. `request` is compared by identity, so callers memoise it. Returns
 * whether a drag is in flight.
 */
export function useDragOut(
  ref: RefObject<HTMLElement | null>,
  request: DragOutRequest | null,
  handlers: DragOutHandlers = {},
): boolean {
  const [dragging, setDragging] = useState(false);
  const { onOutcome, onNativeDragStart } = handlers;

  useEffect(() => {
    const element = ref.current;
    if (element === null || request === null) {
      return;
    }
    const gesture = new DragGesture();
    let inFlight = false;

    const onPointerDown = (event: PointerEvent) => {
      gesture.down({ x: event.clientX, y: event.clientY }, event.button);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (inFlight || !gesture.move({ x: event.clientX, y: event.clientY }, event.buttons)) {
        return;
      }
      inFlight = true;
      setDragging(true);
      commands
        .dragOut(request)
        .then((result) => {
          if (result.status === 'ok') {
            onOutcome?.(result.data);
          }
        }, ignoreIpcFailure)
        .finally(() => {
          inFlight = false;
          setDragging(false);
        });
    };
    const onPointerUp = () => {
      gesture.up();
    };
    const onDragStart = (event: DragEvent) => {
      event.preventDefault();
      onNativeDragStart?.();
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('dragstart', onDragStart);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('dragstart', onDragStart);
    };
  }, [onNativeDragStart, onOutcome, ref, request]);

  return dragging;
}

/**
 * S2 spike only (docs/spikes/m4-drag.md): the files `MUNA_SPIKE=drag` asks the notch to drag
 * out, or `null` in the product. Queried once when the window comes up.
 */
export function useDragSpike(): DragOutRequest | null {
  const [request, setRequest] = useState<DragOutRequest | null>(null);
  useEffect(() => {
    let cancelled = false;
    commands
      .getDragSpike()
      .then((spike) => {
        if (!cancelled && spike !== null && spike.paths.length > 0) {
          setRequest({ kind: 'files', paths: spike.paths });
        }
      })
      .catch(ignoreIpcFailure);
    return () => {
      cancelled = true;
    };
  }, []);
  return request;
}
