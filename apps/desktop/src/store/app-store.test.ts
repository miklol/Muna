import { describe, expect, it } from 'vitest';

import { useAppStore } from './app-store';

describe('app store', () => {
  it('starts idle and tracks strip content', () => {
    expect(useAppStore.getState().stripContent).toEqual({ kind: 'idle' });
    useAppStore.getState().setStripContent({
      kind: 'notice',
      notice: { id: 'n1', module: 'test', priority: 50, text: 'Connected', holdMs: 3000 },
    });
    expect(useAppStore.getState().stripContent.kind).toBe('notice');
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
});
