import { describe, expect, it } from 'vitest';

import { useAppStore } from './app-store';

describe('app store', () => {
  it('starts idle and tracks strip content with the moment it arrived', () => {
    expect(useAppStore.getState().stripContent).toEqual({ kind: 'idle' });
    expect(useAppStore.getState().stripContentAt).toBe(0);
    useAppStore.getState().setStripContent(
      {
        kind: 'notice',
        notice: {
          id: 'n1',
          module: 'test',
          priority: 50,
          leading: { kind: 'icon', glyph: 'bell', tint: null },
          trailing: null,
          wide: { kind: 'text', value: 'Connected' },
          holdMs: 3000,
        },
      },
      12_345,
    );
    expect(useAppStore.getState().stripContent.kind).toBe('notice');
    expect(useAppStore.getState().stripContentAt).toBe(12_345);
    const before = Date.now();
    useAppStore.getState().setStripContent({ kind: 'idle' });
    expect(useAppStore.getState().stripContentAt).toBeGreaterThanOrEqual(before);
  });

  it('has no layout until the shell attaches the window, then mirrors its yield state', () => {
    expect(useAppStore.getState().shellLayout).toBeNull();
    expect(useAppStore.getState().yieldState).toBe('none');
    useAppStore.getState().setShellLayout({
      label: 'notch',
      monitorId: '\\\\.\\DISPLAY1',
      isPrimary: true,
      enabled: true,
      mode: 'reserved',
      shape: 'island',
      stripHeight: 26,
      stripTopOffset: 8,
      panelMaxWidth: 920,
      scalePercent: 125,
      yieldState: 'peek',
    });
    expect(useAppStore.getState().shellLayout?.stripHeight).toBe(26);
    expect(useAppStore.getState().yieldState).toBe('peek');
    useAppStore.getState().setYieldState('parked');
    expect(useAppStore.getState().yieldState).toBe('parked');
    useAppStore.getState().setShellLayout(null);
    expect(useAppStore.getState().shellLayout).toBeNull();
    expect(useAppStore.getState().yieldState).toBe('parked');
  });

  it('tracks one window-drag session at a time and freezes it once the drag has ended', () => {
    const store = useAppStore.getState();
    expect(store.snapSession).toBeNull();
    expect(store.snapPosition).toBeNull();

    // A move with an unknown session starts it; later moves only follow the cursor.
    store.moveSnap(1, { x: 10, y: 20 });
    expect(useAppStore.getState().snapSession).toEqual({
      session: 1,
      ended: false,
      endedOver: null,
    });
    expect(useAppStore.getState().snapPosition).toEqual({ x: 10, y: 20 });
    store.moveSnap(1, { x: 30, y: 40 });
    expect(useAppStore.getState().snapPosition).toEqual({ x: 30, y: 40 });

    // Leaving keeps the session but drops the position; another session's leave is not ours.
    store.leaveSnap(2);
    expect(useAppStore.getState().snapPosition).toEqual({ x: 30, y: 40 });
    store.leaveSnap(1);
    expect(useAppStore.getState().snapSession?.session).toBe(1);
    expect(useAppStore.getState().snapPosition).toBeNull();

    // A new session replaces the current one outright.
    store.moveSnap(2, { x: 5, y: 6 });
    expect(useAppStore.getState().snapSession).toEqual({
      session: 2,
      ended: false,
      endedOver: null,
    });

    // The drag ending records where; a session never seen here is ignored, and once ended the
    // session is frozen: no more moves, leaves or a second end.
    store.markSnapEnded(9, 'notch');
    expect(useAppStore.getState().snapSession?.ended).toBe(false);
    store.markSnapEnded(2, 'notch-2');
    expect(useAppStore.getState().snapSession).toEqual({
      session: 2,
      ended: true,
      endedOver: 'notch-2',
    });
    store.moveSnap(2, { x: 99, y: 99 });
    store.leaveSnap(2);
    store.markSnapEnded(2, null);
    expect(useAppStore.getState().snapPosition).toEqual({ x: 5, y: 6 });
    expect(useAppStore.getState().snapSession?.endedOver).toBe('notch-2');

    // Ending clears the session and position, but only for the session that owns them.
    store.endSnap(1);
    expect(useAppStore.getState().snapSession?.session).toBe(2);
    store.endSnap(2);
    expect(useAppStore.getState().snapSession).toBeNull();
    expect(useAppStore.getState().snapPosition).toBeNull();
  });
});
