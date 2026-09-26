import { describe, expect, it } from 'vitest';

import { keyToken, recordChord } from './chord';

const keys = (
  code: string,
  modifiers: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', true>> = {},
) => ({
  code,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
  metaKey: modifiers.meta ?? false,
});

describe('keyToken', () => {
  it('maps codes to the plugin names, layout-independent', () => {
    expect(keyToken('KeyZ')).toBe('z');
    expect(keyToken('Digit1')).toBe('1');
    expect(keyToken('Numpad7')).toBe('num7');
    expect(keyToken('F12')).toBe('f12');
    expect(keyToken('F24')).toBe('f24');
    expect(keyToken('Space')).toBe('space');
    expect(keyToken('ArrowLeft')).toBe('left');
    expect(keyToken('Comma')).toBe(',');
    expect(keyToken('NumpadAdd')).toBe('numadd');
  });

  it('refuses keys the plugin cannot register', () => {
    expect(keyToken('MediaPlayPause')).toBeNull();
    expect(keyToken('CapsLock')).toBeNull();
    expect(keyToken('F25')).toBeNull();
    expect(keyToken('Lang1')).toBeNull();
  });
});

describe('recordChord', () => {
  it('orders modifiers ctrl, alt, shift, super and lower-cases the key', () => {
    expect(recordChord(keys('KeyN', { meta: true, shift: true, alt: true, ctrl: true }))).toEqual({
      kind: 'chord',
      chord: 'ctrl+alt+shift+super+n',
    });
    expect(recordChord(keys('Space', { ctrl: true, alt: true }))).toEqual({
      kind: 'chord',
      chord: 'ctrl+alt+space',
    });
  });

  it('keeps waiting while only modifiers are down', () => {
    expect(recordChord(keys('ControlLeft', { ctrl: true }))).toEqual({ kind: 'modifiersOnly' });
    expect(recordChord(keys('MetaRight', { meta: true }))).toEqual({ kind: 'modifiersOnly' });
  });

  it('needs a modifier other than shift, except for function keys', () => {
    expect(recordChord(keys('KeyA'))).toEqual({ kind: 'needsModifier' });
    expect(recordChord(keys('KeyA', { shift: true }))).toEqual({ kind: 'needsModifier' });
    expect(recordChord(keys('F9'))).toEqual({ kind: 'chord', chord: 'f9' });
    expect(recordChord(keys('F9', { shift: true }))).toEqual({ kind: 'chord', chord: 'shift+f9' });
  });

  it('reports keys it cannot bind', () => {
    expect(recordChord(keys('MediaPlayPause', { ctrl: true }))).toEqual({ kind: 'unsupported' });
  });
});
