import type { YieldState } from '@muna/contracts';
import { timings } from '@muna/ui/motion';

/**
 * The notch state machine (docs/modules/notch-shell.md, "States"): a pure reducer whose only
 * side effects are timers and the focus toggle, so every rule is unit-tested with fake
 * timers and the component merely forwards DOM events. The Notice state arrives with the
 * module that owns it.
 */
export type ShellState =
  /** The strip, idle. */
  | 'collapsed'
  /** A yield rule asks for the 6 px sliver (Rust decides, the UI renders). */
  | 'peek'
  /** Pointer intent confirmed: the strip grows by the reveal amount. */
  | 'hoverReveal'
  /** The panel is open and auto-collapses when the pointer leaves. */
  | 'expanded'
  /** The panel is open and stays: the user pinned it or a text field has focus. */
  | 'pinned'
  /**
   * Files are being dragged over the window: the drop tiles show in place of whatever was
   * there (docs/modules/drop-actions.md). Pointer rules are off — the pointer is the drag —
   * and the row leaves when the drag does or once the drop has been handled.
   */
  | 'drop'
  /**
   * A window is being dragged near the notch: the snap zones show in place of the strip
   * (docs/modules/window-snap.md). Pointer rules are off — the pointer holds the dragged
   * window — and the zones leave when the drag moves away or ends.
   */
  | 'snap'
  /** The window is off-screen; nothing animates or ticks. */
  | 'parked';

export type TimerId = 'hoverIntent' | 'revealToExpand' | 'hoverOut' | 'snapIntent';

export interface ShellSnapshot {
  readonly state: ShellState;
  /** The state before the last change of `state`; drives the choice of spring. */
  readonly previous: ShellState;
  readonly yieldState: YieldState;
  /** Pointer inside the painted shape. */
  readonly pointerInside: boolean;
  /** Pointer inside the shape plus the hover padding. */
  readonly pointerNear: boolean;
  readonly pinnedByUser: boolean;
  readonly fieldFocused: boolean;
  /**
   * A module holds the panel open (a guided flow is running, docs/modules/health.md): like a
   * focused field it pins without the pin button lighting up, and releases when the module
   * says so. Esc, the ⤡ button and the hotkey still close.
   */
  readonly held: boolean;
  /** `true` while the window may take keyboard focus (`set_notch_focusable`). */
  readonly focusable: boolean;
  readonly timers: readonly TimerId[];
}

export type ShellEvent =
  /** A pointer sample over the window; `speedPxPerS` is the instantaneous velocity. */
  | { type: 'pointer'; inside: boolean; near: boolean; speedPxPerS: number }
  /** The pointer left the window entirely. */
  | { type: 'pointerLeave' }
  /** `pointerdown` inside the shape. */
  | { type: 'press' }
  /** `pointerdown` anywhere else (padding, or reported by the shell for click-through areas). */
  | { type: 'pressOutside' }
  /** Scroll-down gesture on the strip. */
  | { type: 'scrollDown' }
  /** The global toggle hotkey. */
  | { type: 'toggle' }
  /**
   * Open without the pointer (a hotkey or palette action that needs the panel): like `toggle`
   * it does not arm auto-collapse; a panel already open stays as it is.
   */
  | { type: 'open' }
  /** The ⤡ button. */
  | { type: 'collapse' }
  | { type: 'escape' }
  | { type: 'pin'; pinned: boolean }
  /** A text field inside the panel gained or lost focus. */
  | { type: 'fieldFocus'; focused: boolean }
  /** A module took or released its hold on the panel (`usePanelHold`). */
  | { type: 'hold'; held: boolean }
  | { type: 'yield'; state: YieldState }
  | { type: 'timer'; id: TimerId }
  /** A drag carrying files entered the window (`DropEntered`). */
  | { type: 'dropEnter' }
  /**
   * The drag left without dropping, or the drop has been handled (run or cancelled): the row
   * gives way to the strip.
   */
  | { type: 'dropLeave' }
  /**
   * A tracked window drag is in the hot zone — the strip, or the zones while they show, plus
   * `timings.snapHotZonePx` (docs/modules/window-snap.md). The zones appear once it has stayed
   * `timings.snapZonesDelayMs`.
   */
  | { type: 'snapNear' }
  /** The tracked drag left the hot zone: the zones (or the pending intent) go. */
  | { type: 'snapFar' }
  /** The tracked drag ended, wherever it was: the zones have applied or cancelled by now. */
  | { type: 'snapEnd' };

export type ShellEffect =
  | { type: 'startTimer'; id: TimerId; ms: number }
  | { type: 'cancelTimer'; id: TimerId }
  | { type: 'setFocusable'; focusable: boolean }
  /** Blur the focused text field (Esc while a field has focus). */
  | { type: 'blurField' };

export interface Transition {
  readonly snapshot: ShellSnapshot;
  readonly effects: readonly ShellEffect[];
}

export const initialSnapshot: ShellSnapshot = {
  state: 'collapsed',
  previous: 'collapsed',
  yieldState: 'none',
  pointerInside: false,
  pointerNear: false,
  pinnedByUser: false,
  fieldFocused: false,
  held: false,
  focusable: false,
  timers: [],
};

/** Timer durations, all from the motion spec table. */
export const timerDurations: Readonly<Record<TimerId, number>> = {
  hoverIntent: timings.hoverIntentMs,
  // The spec counts the 600 ms from the moment the pointer arrived, reveal included.
  revealToExpand: timings.revealToExpandMs - timings.hoverIntentMs,
  hoverOut: timings.hoverOutGraceRevealMs,
  snapIntent: timings.snapZonesDelayMs,
};

const OPEN_STATES: readonly ShellState[] = ['expanded', 'pinned'];
const STRIP_STATES: readonly ShellState[] = ['collapsed', 'peek', 'hoverReveal'];
/**
 * What the row still listens to while files are dragged over it: the pointer samples keep the
 * flags truthful, yield and Esc close it, and the drag's own events end it. Everything else —
 * presses, the wheel, the hotkeys, pins — belongs to a panel that is not showing.
 */
const DROP_EVENTS: readonly ShellEvent['type'][] = [
  'dropEnter',
  'dropLeave',
  'escape',
  'yield',
  'timer',
  'pointer',
  'pointerLeave',
];
/**
 * Likewise while the snap zones show: the drag's own events, yield and Esc. The pointer holds
 * another window, so presses and the wheel cannot arrive; the hotkeys and pins wait.
 */
const SNAP_EVENTS: readonly ShellEvent['type'][] = [
  'snapNear',
  'snapFar',
  'snapEnd',
  'escape',
  'yield',
  'timer',
  'pointer',
  'pointerLeave',
];

export const isOpen = (state: ShellState): boolean => OPEN_STATES.includes(state);

class Builder {
  snapshot: ShellSnapshot;
  readonly effects: ShellEffect[] = [];

  constructor(snapshot: ShellSnapshot) {
    this.snapshot = snapshot;
  }

  /**
   * Applies a patch, keeping the same object when nothing changes (no spurious renders). A
   * change of `state` records where it came from in `previous`.
   */
  set(patch: Partial<Omit<ShellSnapshot, 'previous'>>): this {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.some((key) => patch[key] !== this.snapshot[key])) {
      const previous =
        patch.state !== undefined && patch.state !== this.snapshot.state
          ? this.snapshot.state
          : this.snapshot.previous;
      this.snapshot = { ...this.snapshot, ...patch, previous };
    }
    return this;
  }

  startTimer(id: TimerId, ms = timerDurations[id]): this {
    this.cancelTimer(id);
    this.snapshot = { ...this.snapshot, timers: [...this.snapshot.timers, id] };
    this.effects.push({ type: 'startTimer', id, ms });
    return this;
  }

  cancelTimer(id: TimerId): this {
    if (this.snapshot.timers.includes(id)) {
      this.snapshot = {
        ...this.snapshot,
        timers: this.snapshot.timers.filter((timer) => timer !== id),
      };
      this.effects.push({ type: 'cancelTimer', id });
    }
    return this;
  }

  cancelAllTimers(): this {
    for (const id of [...this.snapshot.timers]) {
      this.cancelTimer(id);
    }
    return this;
  }

  setFocusable(focusable: boolean): this {
    if (this.snapshot.focusable !== focusable) {
      this.snapshot = { ...this.snapshot, focusable };
      this.effects.push({ type: 'setFocusable', focusable });
    }
    return this;
  }

  /** Closes the panel: timers off, pins released, focus handed back. */
  close(): this {
    return this.leave(this.snapshot.yieldState === 'peek' ? 'peek' : 'collapsed');
  }

  /**
   * Leaves whatever is showing for `state` — the strip, or the drop row when a drag arrives
   * over an open panel — with timers off, pins released and focus handed back.
   */
  leave(state: ShellState): this {
    this.cancelAllTimers().setFocusable(false);
    if (this.snapshot.fieldFocused) {
      this.effects.push({ type: 'blurField' });
    }
    return this.set({ state, pinnedByUser: false, fieldFocused: false });
  }

  /**
   * Opens the panel. Auto-collapse arms itself if the pointer is already away, except when
   * opened without the pointer (the hotkey): the panel then waits for the pointer to visit
   * and leave, Esc, a click outside or the hotkey again. A module's hold survives a close, so
   * reopening onto a running flow pins again.
   */
  open(armGrace = true): this {
    this.cancelAllTimers();
    const pinned = this.snapshot.pinnedByUser || this.snapshot.fieldFocused || this.snapshot.held;
    this.set({ state: pinned ? 'pinned' : 'expanded' });
    return armGrace ? this.armHoverOut() : this;
  }

  /** From `pinned`, once one reason to pin went: stay if another remains, else relax. */
  relaxPin(): this {
    const { state, pinnedByUser, fieldFocused, held } = this.snapshot;
    if (state === 'pinned' && !pinnedByUser && !fieldFocused && !held) {
      return this.set({ state: 'expanded' }).armHoverOut();
    }
    return this;
  }

  /** From an open or revealed state: start the grace timer when the pointer is away. */
  armHoverOut(): this {
    const { state, pointerNear } = this.snapshot;
    if (state === 'expanded' && !pointerNear) {
      return this.startTimer('hoverOut', timings.hoverOutGraceExpandedMs);
    }
    if (state === 'hoverReveal' && !pointerNear) {
      return this.startTimer('hoverOut', timings.hoverOutGraceRevealMs);
    }
    return this;
  }

  build(): Transition {
    return { snapshot: this.snapshot, effects: this.effects };
  }
}

const onPointer = (b: Builder, inside: boolean, near: boolean, speed: number): Transition => {
  b.set({ pointerInside: inside, pointerNear: near });
  const { state, timers } = b.snapshot;
  switch (state) {
    case 'collapsed':
    case 'peek': {
      if (!inside) {
        return b.cancelTimer('hoverIntent').build();
      }
      // Fast pass-throughs never reveal: a fast sample restarts the intent clock so intent is
      // counted from the moment the pointer slowed down.
      if (speed > timings.hoverIntentMaxVelocityPxPerS || !timers.includes('hoverIntent')) {
        return b.startTimer('hoverIntent').build();
      }
      return b.build();
    }
    case 'hoverReveal': {
      if (near) {
        b.cancelTimer('hoverOut');
        if (!timers.includes('revealToExpand')) {
          b.startTimer('revealToExpand');
        }
        return b.build();
      }
      return b.cancelTimer('revealToExpand').armHoverOut().build();
    }
    case 'expanded': {
      return near ? b.cancelTimer('hoverOut').build() : b.armHoverOut().build();
    }
    default:
      return b.build();
  }
};

const onTimer = (b: Builder, id: TimerId): Transition => {
  if (!b.snapshot.timers.includes(id)) {
    return b.build();
  }
  b.set({ timers: b.snapshot.timers.filter((timer) => timer !== id) });
  const { state } = b.snapshot;
  switch (id) {
    case 'hoverIntent':
      if (state === 'collapsed' || state === 'peek') {
        return b.set({ state: 'hoverReveal' }).startTimer('revealToExpand').build();
      }
      return b.build();
    case 'revealToExpand':
      return state === 'hoverReveal' ? b.open().build() : b.build();
    case 'hoverOut':
      return state === 'hoverReveal' || state === 'expanded' ? b.close().build() : b.build();
    case 'snapIntent':
      // The drag stayed near the strip: the zones take its place. `previous` keeps where from,
      // so the morph springs with `expand` out of any strip form.
      return STRIP_STATES.includes(state) ? b.leave('snap').build() : b.build();
  }
};

const onYield = (b: Builder, yieldState: YieldState): Transition => {
  b.set({ yieldState });
  const { state } = b.snapshot;
  if (yieldState === 'parked') {
    return b.close().set({ state: 'parked' }).build();
  }
  if (state === 'parked') {
    return b.set({ state: yieldState === 'peek' ? 'peek' : 'collapsed' }).build();
  }
  if (yieldState === 'peek' && state === 'collapsed') {
    return b.set({ state: 'peek' }).build();
  }
  if (yieldState === 'none' && state === 'peek') {
    return b.set({ state: 'collapsed' }).build();
  }
  return b.build();
};

const onEscape = (b: Builder): Transition => {
  const { state, fieldFocused } = b.snapshot;
  if (state === 'pinned' && fieldFocused) {
    // First Esc hands keyboard focus back; the field's blur then reaches `fieldFocus`.
    b.effects.push({ type: 'blurField' });
    return b.build();
  }
  if (isOpen(state) || state === 'hoverReveal' || state === 'drop' || state === 'snap') {
    return b.close().build();
  }
  return b.build();
};

const onFieldFocus = (b: Builder, focused: boolean): Transition => {
  const { state } = b.snapshot;
  if (focused) {
    if (!isOpen(state)) {
      return b.build();
    }
    return b
      .set({ fieldFocused: true, state: 'pinned' })
      .cancelAllTimers()
      .setFocusable(true)
      .build();
  }
  b.set({ fieldFocused: false }).setFocusable(false);
  return b.relaxPin().build();
};

/**
 * A module's hold is state, not a gesture: it is recorded whatever the panel is doing, pins an
 * open panel at once and lets `open` pin again later.
 */
const onHold = (b: Builder, held: boolean): Transition => {
  b.set({ held });
  if (held) {
    return isOpen(b.snapshot.state)
      ? b.set({ state: 'pinned' }).cancelAllTimers().build()
      : b.build();
  }
  return b.relaxPin().build();
};

const onPin = (b: Builder, pinned: boolean): Transition => {
  const { state } = b.snapshot;
  if (!isOpen(state)) {
    return b.build();
  }
  b.set({ pinnedByUser: pinned });
  if (pinned) {
    return b.set({ state: 'pinned' }).cancelAllTimers().build();
  }
  return b.relaxPin().build();
};

/** One step of the machine. Pure: same snapshot + event → same transition. */
export function transition(snapshot: ShellSnapshot, event: ShellEvent): Transition {
  const b = new Builder(snapshot);
  if (snapshot.state === 'parked' && event.type !== 'yield') {
    return b.build();
  }
  if (snapshot.state === 'drop' && !DROP_EVENTS.includes(event.type)) {
    return b.build();
  }
  if (snapshot.state === 'snap' && !SNAP_EVENTS.includes(event.type)) {
    return b.build();
  }
  switch (event.type) {
    case 'pointer':
      return onPointer(b, event.inside, event.near, event.speedPxPerS);
    case 'pointerLeave':
      // The webview and the shell's cursor poll (`ShellPointerLeft`, #75) can both report the
      // same leave; the second must not restart the grace timer.
      return snapshot.pointerInside || snapshot.pointerNear
        ? onPointer(b, false, false, 0)
        : b.build();
    case 'press':
    case 'scrollDown':
      return STRIP_STATES.includes(snapshot.state) ? b.open().build() : b.build();
    case 'pressOutside':
      return snapshot.state === 'expanded' || snapshot.state === 'hoverReveal'
        ? b.close().build()
        : b.build();
    case 'toggle':
      return isOpen(snapshot.state) ? b.close().build() : b.open(false).build();
    case 'open':
      return isOpen(snapshot.state) ? b.build() : b.open(false).build();
    case 'collapse':
      return b.close().build();
    case 'escape':
      return onEscape(b);
    case 'pin':
      return onPin(b, event.pinned);
    case 'fieldFocus':
      return onFieldFocus(b, event.focused);
    case 'hold':
      return onHold(b, event.held);
    case 'yield':
      return onYield(b, event.state);
    case 'timer':
      return onTimer(b, event.id);
    case 'dropEnter':
      // Whatever was showing gives way; `previous` keeps where from, so a drag arriving over
      // an open panel morphs with `switch` rather than re-expanding.
      return snapshot.state === 'drop' ? b.build() : b.leave('drop').build();
    case 'dropLeave':
      return snapshot.state === 'drop' ? b.close().build() : b.build();
    case 'snapNear':
      // Only a strip form gives way to the zones: an open panel stays, since the user is busy
      // with another window and would lose it otherwise. The intent clock runs once.
      if (snapshot.state === 'snap' || !STRIP_STATES.includes(snapshot.state)) {
        return b.build();
      }
      return snapshot.timers.includes('snapIntent')
        ? b.build()
        : b.startTimer('snapIntent').build();
    case 'snapFar':
    case 'snapEnd':
      b.cancelTimer('snapIntent');
      return snapshot.state === 'snap' ? b.close().build() : b.build();
  }
}

export interface TimerHost {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** Real timers, resolved at call time so `vi.useFakeTimers()` takes over in tests. */
const defaultHost: TimerHost = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

type Listener = (snapshot: ShellSnapshot, effects: readonly ShellEffect[]) => void;

/**
 * Runs the reducer against real (or fake) timers and notifies subscribers with the effects
 * that are not timers, so the component applies `setFocusable` / `blurField`.
 */
export class ShellMachine {
  #snapshot = initialSnapshot;
  readonly #handles = new Map<TimerId, unknown>();
  readonly #listeners = new Set<Listener>();
  readonly #host: TimerHost;

  constructor(host: TimerHost = defaultHost) {
    this.#host = host;
  }

  get snapshot(): ShellSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  send(event: ShellEvent): ShellSnapshot {
    const { snapshot, effects } = transition(this.#snapshot, event);
    const changed = snapshot !== this.#snapshot;
    this.#snapshot = snapshot;
    const external: ShellEffect[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case 'startTimer': {
          this.#clear(effect.id);
          const handle = this.#host.setTimeout(() => {
            this.#handles.delete(effect.id);
            this.send({ type: 'timer', id: effect.id });
          }, effect.ms);
          this.#handles.set(effect.id, handle);
          break;
        }
        case 'cancelTimer':
          this.#clear(effect.id);
          break;
        default:
          external.push(effect);
      }
    }
    if (changed || external.length > 0) {
      for (const listener of this.#listeners) {
        listener(snapshot, external);
      }
    }
    return snapshot;
  }

  /** Stops every timer; used on unmount and when the window is parked. */
  dispose(): void {
    for (const id of [...this.#handles.keys()]) {
      this.#clear(id);
    }
  }

  #clear(id: TimerId): void {
    const handle = this.#handles.get(id);
    if (handle !== undefined) {
      this.#host.clearTimeout(handle);
      this.#handles.delete(id);
    }
  }
}
