import { timings } from '@muna/ui/motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ShellEffect,
  type ShellEvent,
  ShellMachine,
  type ShellSnapshot,
  initialSnapshot,
  timerDurations,
  transition,
} from './machine';

/** Runs a sequence of events through the pure reducer, collecting every effect. */
const run = (
  events: readonly ShellEvent[],
  from: ShellSnapshot = initialSnapshot,
): { snapshot: ShellSnapshot; effects: ShellEffect[] } => {
  let snapshot = from;
  const effects: ShellEffect[] = [];
  for (const event of events) {
    const step = transition(snapshot, event);
    snapshot = step.snapshot;
    effects.push(...step.effects);
  }
  return { snapshot, effects };
};

const hover = (speedPxPerS = 0): ShellEvent => ({
  type: 'pointer',
  inside: true,
  near: true,
  speedPxPerS,
});
const nearOnly: ShellEvent = { type: 'pointer', inside: false, near: true, speedPxPerS: 0 };
const away: ShellEvent = { type: 'pointer', inside: false, near: false, speedPxPerS: 0 };
const timer = (id: 'hoverIntent' | 'revealToExpand' | 'hoverOut'): ShellEvent => ({
  type: 'timer',
  id,
});

/** Opened by a press with the pointer resting on the strip, so no grace timer is armed. */
const opened = (): ShellSnapshot => run([hover(), { type: 'press' }]).snapshot;

describe('transition (pure)', () => {
  it('has the timer durations of the motion spec', () => {
    expect(timerDurations.hoverIntent).toBe(250);
    // 600 ms counted from the pointer's arrival, so 350 ms after the reveal.
    expect(timerDurations.revealToExpand).toBe(350);
    expect(timerDurations.hoverOut).toBe(150);
  });

  it('S1: a still pointer over the strip reveals after the intent delay', () => {
    const { snapshot, effects } = run([hover()]);
    expect(snapshot.state).toBe('collapsed');
    expect(effects).toEqual([{ type: 'startTimer', id: 'hoverIntent', ms: 250 }]);

    const revealed = run([timer('hoverIntent')], snapshot);
    expect(revealed.snapshot.state).toBe('hoverReveal');
    expect(revealed.snapshot.previous).toBe('collapsed');
    expect(revealed.effects).toEqual([{ type: 'startTimer', id: 'revealToExpand', ms: 350 }]);
  });

  it('S2: a fast crossing restarts the intent clock and leaving cancels it', () => {
    const fast = run([hover(timings.hoverIntentMaxVelocityPxPerS + 1)]);
    const again = run([hover(timings.hoverIntentMaxVelocityPxPerS + 1)], fast.snapshot);
    expect(again.effects).toEqual([
      { type: 'cancelTimer', id: 'hoverIntent' },
      { type: 'startTimer', id: 'hoverIntent', ms: 250 },
    ]);
    const left = run([away], again.snapshot);
    expect(left.snapshot.state).toBe('collapsed');
    expect(left.effects).toEqual([{ type: 'cancelTimer', id: 'hoverIntent' }]);
    expect(left.snapshot.timers).toEqual([]);
  });

  it('S3: resting through the reveal opens the panel and takes no focus', () => {
    const { snapshot, effects } = run([
      hover(),
      timer('hoverIntent'),
      hover(),
      timer('revealToExpand'),
    ]);
    expect(snapshot.state).toBe('expanded');
    expect(snapshot.focusable).toBe(false);
    expect(effects.some((effect) => effect.type === 'setFocusable')).toBe(false);
    expect(snapshot.timers).toEqual([]);
  });

  it('S3: leaving during the reveal collapses after the short grace', () => {
    const revealed = run([hover(), timer('hoverIntent')]);
    const left = run([away], revealed.snapshot);
    expect(left.effects).toEqual([
      { type: 'cancelTimer', id: 'revealToExpand' },
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceRevealMs },
    ]);
    expect(run([timer('hoverOut')], left.snapshot).snapshot.state).toBe('collapsed');
  });

  it('S4: leaving the open panel arms the grace timer; coming back disarms it', () => {
    const left = run([away], opened());
    expect(left.snapshot.state).toBe('expanded');
    expect(left.effects).toEqual([
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceExpandedMs },
    ]);
    const back = run([nearOnly], left.snapshot);
    expect(back.effects).toEqual([{ type: 'cancelTimer', id: 'hoverOut' }]);
    expect(run([timer('hoverOut')], left.snapshot).snapshot.state).toBe('collapsed');
  });

  it('S4: a press outside collapses the open panel and the reveal, not a pinned panel', () => {
    expect(run([{ type: 'pressOutside' }], opened()).snapshot.state).toBe('collapsed');
    const revealed = run([hover(), timer('hoverIntent')]).snapshot;
    expect(run([{ type: 'pressOutside' }], revealed).snapshot.state).toBe('collapsed');
    const pinned = run([{ type: 'pin', pinned: true }], opened()).snapshot;
    expect(run([{ type: 'pressOutside' }], pinned).snapshot.state).toBe('pinned');
  });

  it('opens from the strip on press, scroll-down and the hotkey, and toggles closed', () => {
    expect(run([{ type: 'press' }]).snapshot.state).toBe('expanded');
    expect(run([{ type: 'scrollDown' }]).snapshot.state).toBe('expanded');
    expect(run([{ type: 'toggle' }]).snapshot.state).toBe('expanded');
    expect(run([{ type: 'toggle' }], opened()).snapshot.state).toBe('collapsed');
    expect(run([{ type: 'press' }], opened()).snapshot.state).toBe('expanded');
  });

  it('the hotkey opens without arming auto-collapse; the pointer leaving arms it', () => {
    const { snapshot, effects } = run([{ type: 'toggle' }]);
    expect(snapshot.state).toBe('expanded');
    expect(effects).toEqual([]);
    const visited = run([nearOnly, away], snapshot);
    expect(visited.effects).toEqual([
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceExpandedMs },
    ]);
    expect(run([timer('hoverOut')], visited.snapshot).snapshot.state).toBe('collapsed');
  });

  it('pin keeps the panel open; unpin resumes auto-collapse', () => {
    const pinned = run([{ type: 'pin', pinned: true }, away, timer('hoverOut')], opened());
    expect(pinned.snapshot.state).toBe('pinned');
    expect(pinned.snapshot.pinnedByUser).toBe(true);
    const unpinned = run([{ type: 'pin', pinned: false }], pinned.snapshot);
    expect(unpinned.snapshot.state).toBe('expanded');
    expect(unpinned.effects).toEqual([
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceExpandedMs },
    ]);
    expect(run([{ type: 'pin', pinned: true }]).snapshot.state).toBe('collapsed');
  });

  it('the collapse button and Esc close from any open state and release the pin', () => {
    const pinned = run([{ type: 'pin', pinned: true }], opened()).snapshot;
    const collapsed = run([{ type: 'collapse' }], pinned).snapshot;
    expect(collapsed.state).toBe('collapsed');
    expect(collapsed.pinnedByUser).toBe(false);
    expect(run([{ type: 'escape' }], opened()).snapshot.state).toBe('collapsed');
    expect(run([{ type: 'escape' }], pinned).snapshot.state).toBe('collapsed');
    expect(run([{ type: 'escape' }]).snapshot).toBe(initialSnapshot);
  });

  it('S11: a focused text field pins the panel and asks for focus once', () => {
    const { snapshot, effects } = run([{ type: 'fieldFocus', focused: true }], opened());
    expect(snapshot.state).toBe('pinned');
    expect(snapshot.fieldFocused).toBe(true);
    expect(snapshot.focusable).toBe(true);
    expect(effects).toEqual([{ type: 'setFocusable', focusable: true }]);

    const first = run([{ type: 'escape' }], snapshot);
    expect(first.snapshot.state).toBe('pinned');
    expect(first.effects).toEqual([{ type: 'blurField' }]);

    const blurred = run([{ type: 'fieldFocus', focused: false }], first.snapshot);
    expect(blurred.snapshot.state).toBe('expanded');
    expect(blurred.snapshot.focusable).toBe(false);
    // The pointer is still on the panel, so auto-collapse is not armed yet.
    expect(blurred.effects).toEqual([{ type: 'setFocusable', focusable: false }]);
    expect(run([{ type: 'escape' }], blurred.snapshot).snapshot.state).toBe('collapsed');
  });

  it('S11: closing while a field has focus blurs it and hands focus back', () => {
    const focused = run([{ type: 'fieldFocus', focused: true }], opened()).snapshot;
    const { snapshot, effects } = run([{ type: 'collapse' }], focused);
    expect(snapshot.state).toBe('collapsed');
    expect(snapshot.fieldFocused).toBe(false);
    expect(effects).toEqual([{ type: 'setFocusable', focusable: false }, { type: 'blurField' }]);
  });

  it('a user pin survives the field losing focus', () => {
    const both = run(
      [
        { type: 'pin', pinned: true },
        { type: 'fieldFocus', focused: true },
      ],
      opened(),
    ).snapshot;
    const blurred = run([{ type: 'fieldFocus', focused: false }], both);
    expect(blurred.snapshot.state).toBe('pinned');
    expect(blurred.snapshot.focusable).toBe(false);
  });

  it('field focus on the strip is ignored', () => {
    expect(run([{ type: 'fieldFocus', focused: true }]).snapshot).toBe(initialSnapshot);
  });

  it('S5–S7: yield peek and park are rendered as the shell asks', () => {
    const peeked = run([{ type: 'yield', state: 'peek' }]).snapshot;
    expect(peeked.state).toBe('peek');
    expect(run([{ type: 'yield', state: 'none' }], peeked).snapshot.state).toBe('collapsed');

    // Peek closes an open panel and returns to peek, not collapsed.
    const closedToPeek = run([{ type: 'yield', state: 'peek' }, { type: 'collapse' }], opened());
    expect(closedToPeek.snapshot.state).toBe('peek');

    const parked = run([{ type: 'yield', state: 'parked' }], opened());
    expect(parked.snapshot.state).toBe('parked');
    expect(parked.snapshot.timers).toEqual([]);
    expect(run([hover(), { type: 'press' }, { type: 'toggle' }], parked.snapshot).snapshot).toBe(
      parked.snapshot,
    );
    expect(run([{ type: 'yield', state: 'none' }], parked.snapshot).snapshot.state).toBe(
      'collapsed',
    );
    expect(run([{ type: 'yield', state: 'peek' }], parked.snapshot).snapshot.state).toBe('peek');
  });

  it('a peeked strip still reveals and opens on hover', () => {
    const peeked = run([{ type: 'yield', state: 'peek' }]).snapshot;
    const { snapshot } = run([hover(), timer('hoverIntent'), timer('revealToExpand')], peeked);
    expect(snapshot.state).toBe('expanded');
    expect(snapshot.yieldState).toBe('peek');
  });

  it('returns the same snapshot object when nothing changes', () => {
    expect(run([away]).snapshot).toBe(initialSnapshot);
    expect(run([{ type: 'pressOutside' }]).snapshot).toBe(initialSnapshot);
    expect(run([timer('hoverOut')]).snapshot).toBe(initialSnapshot);
  });
});

describe('ShellMachine (timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('S1 → S3: reveals at 250 ms and opens at 600 ms from the pointer arriving', () => {
    const machine = new ShellMachine();
    const seen: string[] = [];
    machine.subscribe((snapshot) => {
      seen.push(snapshot.state);
    });
    machine.send(hover());
    vi.advanceTimersByTime(249);
    expect(machine.snapshot.state).toBe('collapsed');
    vi.advanceTimersByTime(1);
    expect(machine.snapshot.state).toBe('hoverReveal');
    machine.send(hover());
    vi.advanceTimersByTime(349);
    expect(machine.snapshot.state).toBe('hoverReveal');
    vi.advanceTimersByTime(1);
    expect(machine.snapshot.state).toBe('expanded');
    expect(seen).toEqual(['collapsed', 'hoverReveal', 'expanded']);
    machine.dispose();
  });

  it('S2: a pointer that crosses in under 250 ms never reveals', () => {
    const machine = new ShellMachine();
    machine.send(hover(1200));
    vi.advanceTimersByTime(100);
    machine.send(hover(1200));
    vi.advanceTimersByTime(100);
    machine.send(away);
    vi.advanceTimersByTime(1000);
    expect(machine.snapshot.state).toBe('collapsed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('notifies external effects only and stops timers on dispose', () => {
    const machine = new ShellMachine();
    const effects: ShellEffect[][] = [];
    machine.subscribe((_snapshot, external) => {
      effects.push([...external]);
    });
    machine.send({ type: 'press' });
    machine.send({ type: 'fieldFocus', focused: true });
    expect(effects).toEqual([[], [{ type: 'setFocusable', focusable: true }]]);
    machine.send({ type: 'fieldFocus', focused: false });
    expect(vi.getTimerCount()).toBe(1);
    machine.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
