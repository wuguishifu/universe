import fitAddonJs from '@xterm/addon-fit/lib/addon-fit.js?raw';
import xtermCss from '@xterm/xterm/css/xterm.css?raw';
import xtermJs from '@xterm/xterm/lib/xterm.js?raw';

/** What the page posts to React Native. */
export type TerminalMessage =
  | { type: 'ready'; cols: number; rows: number }
  | { type: 'resize'; cols: number; rows: number }
  /** Typed on the iOS (or a hardware) keyboard, or pasted. */
  | { type: 'input'; data: string }
  /** A swipe in a full-screen app (no scrollback), sent as arrow keys. */
  | { type: 'scrollKeys'; key: 'ArrowUp' | 'ArrowDown'; count: number }
  | { type: 'mode'; appCursor: boolean }
  | { type: 'title'; title: string }
  | { type: 'bell' };

const MESSAGE_TYPES = new Set<string>([
  'ready',
  'resize',
  'input',
  'scrollKeys',
  'mode',
  'title',
  'bell',
] satisfies TerminalMessage['type'][]);

/** The page is ours (inline HTML, no navigation), so its messages are trusted to be well formed. */
export function parseTerminalMessage(raw: string): TerminalMessage | undefined {
  try {
    const message = JSON.parse(raw);
    if (MESSAGE_TYPES.has(message?.type)) {
      return message;
    }
  } catch {
    // Not one of ours.
  }
  return undefined;
}

/** JS to run in the page: `terminalCall('write', base64)`. */
export function terminalCall(
  method: 'write' | 'writeText' | 'focus' | 'blur' | 'paste',
  arg?: string,
) {
  return `window.sapphire && window.sapphire.${method}(${arg === undefined ? '' : JSON.stringify(arg)}); true;`;
}

export const TERMINAL_BACKGROUND = '#0b0d10';

// Tango-ish, readable on the dark background.
const THEME = {
  background: TERMINAL_BACKGROUND,
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  cursorAccent: TERMINAL_BACKGROUND,
  selectionBackground: '#3a4250',
  black: '#2e3436',
  red: '#ef5350',
  green: '#8ae234',
  yellow: '#fce94f',
  blue: '#729fcf',
  magenta: '#ad7fa8',
  cyan: '#34e2e2',
  white: '#d3d7cf',
  brightBlack: '#6c7378',
  brightRed: '#ff6e6e',
  brightGreen: '#b5f56a',
  brightYellow: '#fff27a',
  brightBlue: '#98c1f0',
  brightMagenta: '#d3a6ce',
  brightCyan: '#7ff5f5',
  brightWhite: '#ffffff',
};

// Runs in the WebView. Plain ES2020: it isn't compiled.
const PAGE_SCRIPT = `
(() => {
  const post = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const container = document.getElementById('terminal');

  const term = new Terminal({
    fontFamily: 'Menlo, monospace',
    fontSize: 12,
    cursorBlink: true,
    scrollback: 5000,
    theme: ${JSON.stringify(THEME)},
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();

  term.onData((data) => post({ type: 'input', data }));
  term.onResize(({ cols, rows }) => post({ type: 'resize', cols, rows }));
  term.onTitleChange((title) => post({ type: 'title', title }));
  term.onBell(() => post({ type: 'bell' }));

  // xterm has no event for DECCKM, so check after each write.
  let appCursor = term.modes.applicationCursorKeysMode;
  term.onWriteParsed(() => {
    const next = term.modes.applicationCursorKeysMode;
    if (next !== appCursor) {
      appCursor = next;
      post({ type: 'mode', appCursor });
    }
  });

  // The keyboard and the key bar resize the page; keep the grid filling it.
  let fitQueued = false;
  new ResizeObserver(() => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      fit.fit();
    });
  }).observe(container);

  // Touch: a tap brings up the keyboard, a drag scrolls (with momentum). In a full-screen app
  // there's no scrollback, so the drag goes to the app as arrow keys instead, like
  // Terminal.app's alternate scroll mode.
  const lineHeight = () => container.clientHeight / term.rows;
  let lastY = 0, startY = 0, startX = 0, carry = 0, velocity = 0, lastTime = 0, dragging = false, momentum = 0;

  const scrollBy = (pixels) => {
    carry += pixels;
    const lines = Math.trunc(carry / lineHeight());
    if (lines === 0) return;
    carry -= lines * lineHeight();
    if (term.buffer.active.type === 'alternate') {
      post({ type: 'scrollKeys', key: lines > 0 ? 'ArrowDown' : 'ArrowUp', count: Math.abs(lines) });
    } else {
      term.scrollLines(lines);
    }
  };

  container.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    cancelAnimationFrame(momentum);
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = lastY = touch.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    carry = 0;
    dragging = false;
    event.stopPropagation();
  }, { capture: true, passive: true });

  container.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!dragging && Math.hypot(touch.clientX - startX, touch.clientY - startY) < 8) return;
    dragging = true;
    const dy = lastY - touch.clientY;
    const dt = Math.max(1, event.timeStamp - lastTime);
    // px/ms, capped: a fast flick shouldn't fling through the whole scrollback.
    velocity = Math.max(-3, Math.min(3, dy / dt));
    lastY = touch.clientY;
    lastTime = event.timeStamp;
    scrollBy(dy);
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });

  container.addEventListener('touchend', (event) => {
    event.stopPropagation();
    if (!dragging) {
      term.focus();
      return;
    }
    // Momentum only in the scrollback; arrow keys shouldn't keep coming after the finger lifts.
    if (term.buffer.active.type === 'alternate') return;
    let v = velocity * 16;
    const step = () => {
      // Stop if a full-screen app took over mid-fling, or the arrows would go to it.
      if (Math.abs(v) < 0.5 || term.buffer.active.type === 'alternate') return;
      scrollBy(v);
      v *= 0.95;
      momentum = requestAnimationFrame(step);
    };
    momentum = requestAnimationFrame(step);
  }, { capture: true, passive: true });

  const decode = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  window.sapphire = {
    write: (base64) => term.write(decode(base64)),
    writeText: (text) => term.write(text),
    focus: () => term.focus(),
    blur: () => term.blur(),
    // Goes back out through onData, wrapped for bracketed paste if the app asked for it.
    paste: (text) => term.paste(text),
  };

  post({ type: 'ready', cols: term.cols, rows: term.rows });
})();
`;

export const TERMINAL_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${xtermCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: ${TERMINAL_BACKGROUND}; overflow: hidden; overscroll-behavior: none; }
  body { -webkit-user-select: none; -webkit-touch-callout: none; }
  #terminal { position: absolute; inset: 4px 4px 0 6px; }
</style>
</head>
<body>
<div id="terminal"></div>
<script>${xtermJs}</script>
<script>${fitAddonJs}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
