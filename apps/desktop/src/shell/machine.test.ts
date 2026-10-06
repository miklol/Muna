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

  it('a leave reported twice (webview, then the shell) arms the grace once', () => {
    const left = run([{ type: 'pointerLeave' }], opened());
    expect(left.effects).toEqual([
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceExpandedMs },
    ]);
    const again = run([{ type: 'pointerLeave' }], left.snapshot);
    expect(again.effects).toEqual([]);
    expect(again.snapshot).toEqual(left.snapshot);
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

  it('open (an action that needs the panel) expands like the hotkey and leaves an open panel alone', () => {
    const { snapshot, effects } = run([{ type: 'open' }]);
    expect(snapshot.state).toBe('expanded');
    expect(effects).toEqual([]);
    const pinned = run([{ type: 'pin', pinned: true }], opened()).snapshot;
    expect(run([{ type: 'open' }], pinned).snapshot).toBe(pinned);
    expect(run([{ type: 'open' }], opened()).snapshot.state).toBe('expanded');
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

  it('a module hold pins the panel without the pin button and releases to auto-collapse', () => {
    const { snapshot, effects } = run([{ type: 'hold', held: true }], opened());
    expect(snapshot.state).toBe('pinned');
    expect(snapshot.held).toBe(true);
    expect(snapshot.pinnedByUser).toBe(false);
    expect(snapshot.focusable).toBe(false);
    expect(effects).toEqual([]);

    // Neither the pointer leaving nor a click outside closes a held panel.
    const left = run([away, { type: 'pressOutside' }], snapshot);
    expect(left.snapshot.state).toBe('pinned');
    expect(left.snapshot.timers).toEqual([]);

    const released = run([{ type: 'hold', held: false }], left.snapshot);
    expect(released.snapshot.state).toBe('expanded');
    expect(released.snapshot.held).toBe(false);
    // The pointer is away: the grace timer arms at once.
    expect(released.effects).toEqual([
      { type: 'startTimer', id: 'hoverOut', ms: timings.hoverOutGraceExpandedMs },
    ]);
  });

  it('Esc, the ⤡ button and the hotkey still close a held panel', () => {
    const held = run([{ type: 'hold', held: true }], opened()).snapshot;
    expect(run([{ type: 'escape' }], held).snapshot.state).toBe('collapsed');
    expect(run([{ type: 'collapse' }], held).snapshot.state).toBe('collapsed');
    expect(run([{ type: 'toggle' }], held).snapshot.state).toBe('collapsed');
  });

  it('a hold outlives a close and pins again on reopening', () => {
    const closed = run([{ type: 'hold', held: true }, { type: 'escape' }], opened()).snapshot;
    expect(closed.state).toBe('collapsed');
    expect(closed.held).toBe(true);
    const reopened = run([hover(), { type: 'press' }], closed).snapshot;
    expect(reopened.state).toBe('pinned');
    expect(run([{ type: 'hold', held: false }], reopened).snapshot.state).toBe('expanded');
  });

  it('a hold taken on the strip is remembered and pins the next open', () => {
    const { snapshot } = run([{ type: 'hold', held: true }]);
    expect(snapshot.state).toBe('collapsed');
    expect(snapshot.held).toBe(true);
    expect(run([{ type: 'open' }], snapshot).snapshot.state).toBe('pinned');
    expect(run([{ type: 'hold', held: false }]).snapshot).toBe(initialSnapshot);
  });

  it('a hold keeps the panel pinned when the pin or a field lets go, and vice versa', () => {
    const base = opened();
    const pinAndHold = run(
      [
        { type: 'pin', pinned: true },
        { type: 'hold', held: true },
      ],
      base,
    );
    expect(run([{ type: 'pin', pinned: false }], pinAndHold.snapshot).snapshot.state).toBe(
      'pinned',
    );
    expect(run([{ type: 'hold', held: false }], pinAndHold.snapshot).snapshot.state).toBe('pinned');
    const fieldAndHold = run(
      [
        { type: 'fieldFocus', focused: true },
        { type: 'hold', held: true },
      ],
      base,
    );
    const blurred = run([{ type: 'fieldFocus', focused: false }], fieldAndHold.snapshot);
    expect(blurred.snapshot.state).toBe('pinned');
    expect(blurred.snapshot.focusable).toBe(false);
    const both = run(
      [
        { type: 'fieldFocus', focused: false },
        { type: 'hold', held: false },
      ],
      fieldAndHold.snapshot,
    );
    expect(both.snapshot.state).toBe('expanded');
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

  describe('drop actions (docs/modules/drop-actions.md)', () => {
    it('a drag entering the strip shows the row; leaving or handling the drop returns to the strip', () => {
      const entered = run([{ type: 'dropEnter' }]);
      expect(entered.snapshot.state).toBe('drop');
      expect(entered.snapshot.previous).toBe('collapsed');
      expect(entered.effects).toEqual([]);
      expect(run([{ type: 'dropLeave' }], entered.snapshot).snapshot.state).toBe('collapsed');

      // A drag arriving during a reveal drops its pending timers with it.
      const revealed = run([hover(), timer('hoverIntent')]).snapshot;
      const fromReveal = run([{ type: 'dropEnter' }], revealed);
      expect(fromReveal.snapshot.state).toBe('drop');
      expect(fromReveal.snapshot.timers).toEqual([]);
      expect(fromReveal.effects).toEqual([{ type: 'cancelTimer', id: 'revealToExpand' }]);

      // Under a yield rule asking for peek the row gives way to the sliver, not the strip.
      const peeked = run([{ type: 'yield', state: 'peek' }, { type: 'dropEnter' }]).snapshot;
      expect(peeked.state).toBe('drop');
      expect(run([{ type: 'dropLeave' }], peeked).snapshot.state).toBe('peek');
    });

    it('replaces an open panel, releasing its pin and focus, and never returns to it', () => {
      const pinnedWithField = run(
        [
          { type: 'pin', pinned: true },
          { type: 'fieldFocus', focused: true },
        ],
        opened(),
      ).snapshot;
      expect(pinnedWithField.focusable).toBe(true);
      const { snapshot, effects } = run([{ type: 'dropEnter' }], pinnedWithField);
      expect(snapshot.state).toBe('drop');
      expect(snapshot.previous).toBe('pinned');
      expect(snapshot.pinnedByUser).toBe(false);
      expect(snapshot.fieldFocused).toBe(false);
      expect(snapshot.focusable).toBe(false);
      expect(effects).toEqual([{ type: 'setFocusable', focusable: false }, { type: 'blurField' }]);
      expect(run([{ type: 'dropLeave' }], snapshot).snapshot.state).toBe('collapsed');
    });

    it('ignores the panel controls while the row shows, but Esc and parking still close it', () => {
      const dropping = run([{ type: 'dropEnter' }]).snapshot;
      for (const event of [
        { type: 'press' },
        { type: 'pressOutside' },
        { type: 'scrollDown' },
        { type: 'toggle' },
        { type: 'open' },
        { type: 'collapse' },
        { type: 'pin', pinned: true },
        { type: 'fieldFocus', focused: true },
        { type: 'dropEnter' },
      ] as const satisfies readonly ShellEvent[]) {
        expect(run([event], dropping).snapshot).toBe(dropping);
      }
      // Pointer samples keep the flags truthful without arming any hover timer.
      const sampled = run([hover()], dropping);
      expect(sampled.snapshot.state).toBe('drop');
      expect(sampled.snapshot.pointerInside).toBe(true);
      expect(sampled.effects).toEqual([]);

      expect(run([{ type: 'escape' }], dropping).snapshot.state).toBe('collapsed');
      const parked = run([{ type: 'yield', state: 'parked' }], dropping).snapshot;
      expect(parked.state).toBe('parked');
      expect(run([{ type: 'yield', state: 'none' }], parked).snapshot.state).toBe('collapsed');
      // A stray leave with no drag in progress changes nothing.
      expect(run([{ type: 'dropLeave' }]).snapshot).toBe(initialSnapshot);
      expect(run([{ type: 'dropLeave' }], opened()).snapshot.state).toBe('expanded');
    });
  });

  describe('window snap (docs/modules/window-snap.md)', () => {
    const snapTimer: ShellEvent = { type: 'timer', id: 'snapIntent' };

    it('a drag resting in the hot zone shows the zones after the intent delay', () => {
      expect(timerDurations.snapIntent).toBe(timings.snapZonesDelayMs);
      const near = run([{ type: 'snapNear' }]);
      expect(near.snapshot.state).toBe('collapsed');
      expect(near.effects).toEqual([
        { type: 'startTimer', id: 'snapIntent', ms: timings.snapZonesDelayMs },
      ]);
      // Repeated "near" samples do not restart the clock.
      expect(run([{ type: 'snapNear' }], near.snapshot).snapshot).toBe(near.snapshot);

      const shown = run([snapTimer], near.snapshot);
      expect(shown.snapshot.state).toBe('snap');
      expect(shown.snapshot.previous).toBe('collapsed');
      expect(shown.snapshot.timers).toEqual([]);
      // Near again while showing changes nothing; far or the drag ending closes the zones.
      expect(run([{ type: 'snapNear' }], shown.snapshot).snapshot).toBe(shown.snapshot);
      expect(run([{ type: 'snapFar' }], shown.snapshot).snapshot.state).toBe('collapsed');
      expect(run([{ type: 'snapEnd' }], shown.snapshot).snapshot.state).toBe('collapsed');

      // Under a yield rule asking for peek the zones give way to the sliver.
      const peeked = run([{ type: 'yield', state: 'peek' }, { type: 'snapNear' }, snapTimer]);
      expect(peeked.snapshot.state).toBe('snap');
      expect(run([{ type: 'snapEnd' }], peeked.snapshot).snapshot.state).toBe('peek');
    });

    it('leaving the hot zone before the delay cancels the zones', () => {
      const near = run([{ type: 'snapNear' }]).snapshot;
      const left = run([{ type: 'snapFar' }], near);
      expect(left.snapshot.state).toBe('collapsed');
      expect(left.snapshot.timers).toEqual([]);
      expect(left.effects).toEqual([{ type: 'cancelTimer', id: 'snapIntent' }]);
      // A late tick from a cancelled timer is ignored.
      expect(run([snapTimer], left.snapshot).snapshot).toBe(left.snapshot);
      // The drag ending does the same; far or end with nothing pending changes nothing.
      expect(run([{ type: 'snapEnd' }], near).snapshot.timers).toEqual([]);
      expect(run([{ type: 'snapFar' }]).snapshot).toBe(initialSnapshot);
      expect(run([{ type: 'snapEnd' }]).snapshot).toBe(initialSnapshot);
    });

    it('never interrupts an open panel or the drop row, but takes over a reveal', () => {
      for (const from of [
        opened(),
        run([{ type: 'pin', pinned: true }], opened()).snapshot,
        run([{ type: 'dropEnter' }]).snapshot,
      ]) {
        const near = run([{ type: 'snapNear' }], from);
        expect(near.snapshot).toBe(from);
        expect(near.effects).toEqual([]);
      }
      // A reveal is a strip form: the zones replace it and drop its pending timer.
      const revealed = run([hover(), timer('hoverIntent')]).snapshot;
      const fromReveal = run([{ type: 'snapNear' }, snapTimer], revealed);
      expect(fromReveal.snapshot.state).toBe('snap');
      expect(fromReveal.snapshot.previous).toBe('hoverReveal');
      expect(fromReveal.snapshot.timers).toEqual([]);
      expect(fromReveal.effects).toContainEqual({ type: 'cancelTimer', id: 'revealToExpand' });
    });

    it('ignores the pointer and panel controls while the zones show, but Esc and parking close them', () => {
      const snapping = run([{ type: 'snapNear' }, snapTimer]).snapshot;
      for (const event of [
        { type: 'press' },
        { type: 'pressOutside' },
        { type: 'scrollDown' },
        { type: 'toggle' },
        { type: 'open' },
        { type: 'collapse' },
        { type: 'pin', pinned: true },
        { type: 'fieldFocus', focused: true },
        { type: 'dropEnter' },
        { type: 'dropLeave' },
      ] as const satisfies readonly ShellEvent[]) {
        expect(run([event], snapping).snapshot).toBe(snapping);
      }
      const sampled = run([hover()], snapping);
      expect(sampled.snapshot.state).toBe('snap');
      expect(sampled.effects).toEqual([]);

      expect(run([{ type: 'escape' }], snapping).snapshot.state).toBe('collapsed');
      const parked = run([{ type: 'yield', state: 'parked' }], snapping).snapshot;
      expect(parked.state).toBe('parked');
      expect(run([{ type: 'yield', state: 'none' }], parked).snapshot.state).toBe('collapsed');
    });
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
