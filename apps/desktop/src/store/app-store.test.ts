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
});
