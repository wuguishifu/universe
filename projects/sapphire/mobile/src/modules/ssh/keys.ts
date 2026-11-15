/**
 * What the key bar sends. Everything that turns a key press into bytes for the shell lives here,
 * so the iOS keyboard, the key bar, and swipes on the terminal all agree.
 */

export type Modifiers = { ctrl: boolean; alt: boolean };

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false };

export type SpecialKey =
  | 'Escape'
  | 'Tab'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Delete';

const ESC = '\x1b';

const CURSOR: Partial<Record<SpecialKey, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

const TILDE: Partial<Record<SpecialKey, number>> = {
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
};

/** xterm's modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). */
function modifierParam({ ctrl, alt }: Modifiers) {
  return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

/**
 * The sequence xterm itself would send. `appCursor` is DECCKM (vim, less, and most full-screen
 * apps turn it on), which switches unmodified arrows from `ESC [ A` to `ESC O A`.
 */
export function encodeKey(
  key: SpecialKey,
  modifiers: Modifiers = NO_MODIFIERS,
  appCursor = false,
): string {
  const modified = modifiers.ctrl || modifiers.alt;
  const cursor = CURSOR[key];
  if (cursor) {
    if (modified) {
      return `${ESC}[1;${modifierParam(modifiers)}${cursor}`;
    }
    return `${ESC}${appCursor ? 'O' : '['}${cursor}`;
  }
  const tilde = TILDE[key];
  if (tilde !== undefined) {
    return modified
      ? `${ESC}[${tilde};${modifierParam(modifiers)}~`
      : `${ESC}[${tilde}~`;
  }
  if (key === 'Escape') {
    return modifiers.alt ? ESC + ESC : ESC;
  }
  // Tab: no terminal encodes ctrl+tab, and alt+tab is just ESC tab.
  return modifiers.alt ? ESC + '\t' : '\t';
}

/** The control character for ctrl + `char`, following xterm's table, or undefined if none. */
export function controlCharacter(char: string): string | undefined {
  if (/^[a-z]$/i.test(char)) {
    return String.fromCharCode(char.toUpperCase().charCodeAt(0) & 0x1f);
  }
  switch (char) {
    case ' ':
    case '@':
    case '2':
      return '\x00';
    case '[':
    case '3':
      return ESC;
    case '\\':
    case '4':
      return '\x1c';
    case ']':
    case '5':
      return '\x1d';
    case '^':
    case '6':
      return '\x1e';
    case '_':
    case '-':
    case '/':
    case '7':
      return '\x1f';
    case '?':
    case '8':
      return '\x7f';
    default:
      return undefined;
  }
}

/**
 * Applies the key bar's armed modifiers to what the iOS keyboard typed. Only a single typed
 * character is modified: longer input is a paste, an autocomplete or dictation, and goes through
 * as is.
 */
export function applyModifiers(text: string, modifiers: Modifiers): string {
  if ((!modifiers.ctrl && !modifiers.alt) || [...text].length !== 1) {
    return text;
  }
  let out = text;
  if (modifiers.ctrl) {
    out = controlCharacter(text) ?? text;
  }
  return modifiers.alt ? ESC + out : out;
}

/** Shown while ctrl is armed: one tap sends the chord. */
export const CTRL_CHORDS = [
  { label: 'C', hint: 'interrupt' },
  { label: 'D', hint: 'EOF' },
  { label: 'Z', hint: 'suspend' },
  { label: 'R', hint: 'history' },
  { label: 'L', hint: 'clear' },
  { label: 'A', hint: 'line start' },
  { label: 'E', hint: 'line end' },
  { label: 'U', hint: 'kill line' },
  { label: 'W', hint: 'kill word' },
  { label: 'K', hint: 'kill to end' },
  { label: 'B', hint: 'tmux' },
  { label: '\\', hint: 'quit' },
] as const;

/** Shown while alt is armed: readline's word motions. */
export const ALT_CHORDS = [
  { label: 'b', hint: 'word back' },
  { label: 'f', hint: 'word forward' },
  { label: 'd', hint: 'delete word' },
  { label: '.', hint: 'last arg' },
  { label: 'u', hint: 'upcase word' },
  { label: 'c', hint: 'capitalize' },
] as const;

/** Characters buried two layers deep on the iOS keyboard. */
export const SYMBOLS = [
  '-',
  '/',
  '|',
  '~',
  '`',
  '\\',
  '$',
  '*',
  '&',
  '>',
  '<',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  ';',
  ':',
  "'",
  '"',
  '=',
  '_',
  '#',
  '!',
  '%',
  '^',
  '@',
] as const;
