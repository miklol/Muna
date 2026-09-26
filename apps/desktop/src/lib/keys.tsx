/**
 * Renders a chord (`tauri-plugin-global-shortcut` syntax, `ctrl+alt+space`) as keyboard caps.
 * Shared by the settings rows, the shortcuts pane and the command palette.
 */
export interface KeysProps {
  shortcut: string;
  className?: string;
}

const keyNames: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Win',
  meta: 'Win',
  cmd: 'Win',
  command: 'Win',
  space: 'Space',
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  del: 'Del',
  insert: 'Ins',
  home: 'Home',
  end: 'End',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  printscreen: 'PrtSc',
  scrolllock: 'ScrLk',
  pause: 'Pause',
  numadd: 'Num +',
  numsubtract: 'Num −',
  nummultiply: 'Num ×',
  numdivide: 'Num ÷',
  numdecimal: 'Num .',
  numenter: 'Num Enter',
};

const numKey = /^num(\d)$/i;
const keyCode = /^key([a-z])$/i;
const digit = /^digit(\d)$/i;

/** The cap text for one token of a chord. */
export const keyName = (key: string): string => {
  const lower = key.toLowerCase();
  const named = keyNames[lower];
  if (named !== undefined) {
    return named;
  }
  const num = numKey.exec(lower);
  if (num?.[1] !== undefined) {
    return `Num ${num[1]}`;
  }
  const letter = keyCode.exec(lower);
  if (letter?.[1] !== undefined) {
    return letter[1].toUpperCase();
  }
  const number = digit.exec(lower);
  if (number?.[1] !== undefined) {
    return number[1];
  }
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
};

export function Keys({ shortcut, className }: KeysProps) {
  return (
    <span className={['inline-flex items-center gap-1', className].filter(Boolean).join(' ')}>
      {shortcut.split('+').map((key, index) => (
        <kbd
          key={`${key}-${String(index)}`}
          className="rounded-control bg-surface-2 px-1.5 py-0.5 font-sans text-caption font-medium text-text-1"
        >
          {keyName(key)}
        </kbd>
      ))}
    </span>
  );
}
