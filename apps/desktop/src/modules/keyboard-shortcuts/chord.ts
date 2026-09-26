/**
 * The chord recorder's key mapping (docs/modules/keyboard-shortcuts.md "recorder UI captures
 * chords via `keydown`"): a DOM `KeyboardEvent` becomes a chord in `tauri-plugin-global-shortcut`
 * syntax — modifiers first, the key last, lower-case, joined by `+` — using the names the
 * plugin parses (`ctrl+alt+space`, `ctrl+shift+f5`, `super+,`). Layout-independent: the key
 * comes from `event.code`, so `Ctrl+Z` stays `Ctrl+Z` on a QWERTZ keyboard.
 */

export type RecordedChord =
  /** A complete chord. */
  | { readonly kind: 'chord'; readonly chord: string }
  /** Only modifiers are down; keep waiting. */
  | { readonly kind: 'modifiersOnly' }
  /** A plain key with no modifier would swallow typing everywhere; refused. */
  | { readonly kind: 'needsModifier' }
  /** A key the plugin cannot register (media keys, lock keys, IME keys, …). */
  | { readonly kind: 'unsupported' };

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
]);

const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: 'space',
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Escape: 'escape',
  PrintScreen: 'printscreen',
  ScrollLock: 'scrolllock',
  Pause: 'pause',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsubtract',
  NumpadMultiply: 'nummultiply',
  NumpadDivide: 'numdivide',
  NumpadDecimal: 'numdecimal',
  NumpadEnter: 'numenter',
};

const LETTER = /^Key([A-Z])$/;
const DIGIT = /^Digit([0-9])$/;
const NUMPAD_DIGIT = /^Numpad([0-9])$/;
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** The plugin token for a `KeyboardEvent.code`, or `null` when the plugin cannot take the key. */
export const keyToken = (code: string): string | null => {
  const letter = LETTER.exec(code);
  if (letter?.[1] !== undefined) {
    return letter[1].toLowerCase();
  }
  const digit = DIGIT.exec(code);
  if (digit?.[1] !== undefined) {
    return digit[1];
  }
  const numpad = NUMPAD_DIGIT.exec(code);
  if (numpad?.[1] !== undefined) {
    return `num${numpad[1]}`;
  }
  if (FUNCTION_KEY.test(code)) {
    return code.toLowerCase();
  }
  return NAMED_KEYS[code] ?? null;
};

export interface ChordKeys {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Reads one `keydown`. Function keys may stand alone (`F9` is a common toggle); every other
 * key needs at least one modifier. Shift alone counts as a modifier only with a function key,
 * since `Shift+A` is just typing `A`.
 */
export const recordChord = (event: ChordKeys): RecordedChord => {
  if (MODIFIER_CODES.has(event.code)) {
    return { kind: 'modifiersOnly' };
  }
  const key = keyToken(event.code);
  if (key === null) {
    return { kind: 'unsupported' };
  }
  const modifiers = [
    ...(event.ctrlKey ? ['ctrl'] : []),
    ...(event.altKey ? ['alt'] : []),
    ...(event.shiftKey ? ['shift'] : []),
    ...(event.metaKey ? ['super'] : []),
  ];
  const functionKey = FUNCTION_KEY.test(event.code);
  const strong = modifiers.some((modifier) => modifier !== 'shift');
  if (!functionKey && !strong) {
    return { kind: 'needsModifier' };
  }
  return { kind: 'chord', chord: [...modifiers, key].join('+') };
};
