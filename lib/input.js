// Input event handling
// Receives keyboard/mouse events via stdin raw mode and forwards them to Chrome via CDP

import { setTransport, transportStatus, filterKittyReplies } from './kitty.js';
import { toKeyName } from './keys.js';
import { UrlBar, toURL } from './urlbar.js';
import { parseCommand, parseZoom, helpText } from './commands.js';
import { searchBookmarks } from './bookmarks.js';
import { downloadPage } from './download.js';
import { HintMode } from './hints.js';
import { loadConfig } from './config.js';
import { dispatchClick } from './click.js';
import { MouseProtocol, mouseCoordinates } from './mouse-protocol.js';
import { KeyboardProtocol, KeyboardDispatch, parseKittyKey, localKeyText } from './keyboard-protocol.js';

let stopKeyboard = () => {};
export function stopInputHandling() { stopKeyboard(); }

// SGR 1006 mouse button codes
const MOUSE_BTN_LEFT    = 0;
const MOUSE_BTN_RIGHT   = 2;
const MOUSE_BTN_MOTION  = 35;  // Motion without button (mode 1003)
const MOUSE_BTN_DRAG    = 32;  // Drag flag, added to the held button code
// SGR button code -> CDP button name and its `buttons` bitmask
const MOUSE_BUTTONS = {
  [MOUSE_BTN_LEFT]:  { button: 'left',  mask: 1 },
  [MOUSE_BTN_RIGHT]: { button: 'right', mask: 2 },
};
const SCROLL_DELTA      = 100; // px

// OSC 52 clipboard response timeout
const CLIPBOARD_TIMEOUT = 1000; // ms

// Status message display duration
const STATUS_DISPLAY_MS = 2000;

// Detect mouse tracking mode:
//   1002 = button-event tracking (reports motion only while button held)
//   1003 = any-event tracking (reports all motion — needed for hover on Ghostty)
// Default: 1002 (compatible). Ghostty auto-upgrades to 1003.
// Override via config.json: "mouseMode": 1002 or 1003
function detectMouseMode() {
  const config = loadConfig();
  if (config.mouseMode) return config.mouseMode;
  const termProg = (process.env.TERM_PROGRAM || '').toLowerCase();
  if (termProg === 'ghostty') return 1003;
  return 1002;
}

const MOUSE_MODE = detectMouseMode();

const mouseProtocol = new MouseProtocol({
  write: text => process.stdout.write(text), tracking: MOUSE_MODE,
  forceCell: loadConfig().mousePixels === false,
});

// Called after the stdin handler is attached. Unknown terminals stay on 1006.
export function enableMouse() { mouseProtocol.start(); }
export function disableMouse() { mouseProtocol.stop(); }

// Convert terminal cell coordinates to Chrome viewport CSS pixels.
// row=2 is the top of the browser area (row=1 is the URL bar)
export function cellToPixel(col, row, cellWidth, cellHeight, zoom = 1) {
  return {
    // SGR 1006 reports a whole cell, not the pointer's sub-cell position.
    // Aim at its centre and convert device pixels back to the CSS pixels CDP
    // requires. Row 1 belongs to casty's URL bar.
    x: (col - 0.5) * cellWidth / zoom,
    y: (row - 1.5) * cellHeight / zoom,
  };
}

// Send mouse event via CDP
async function dispatchMouse(client, type, x, y, button = 'left', clickCount = 0, buttons) {
  const event = { type, x, y, button, clickCount };
  if (buttons !== undefined) event.buttons = buttons;
  await client.send('Input.dispatchMouseEvent', event);
}

// Send scroll event via CDP
export function mouseWheelEvent(code, x, y, release = false) {
  // SGR wheel codes 64..67, with Shift/Alt/Ctrl bits kept separately.
  const base = code & ~28;
  if (release || base < 64 || base > 67) return null;
  const direction = base & 3;
  return { type: 'mouseWheel', x, y,
    deltaX: direction >= 2 ? (direction === 2 ? -SCROLL_DELTA : SCROLL_DELTA) : 0,
    deltaY: direction < 2 ? (direction === 0 ? -SCROLL_DELTA : SCROLL_DELTA) : 0,
    modifiers: (code & 4 ? 8 : 0) | (code & 8 ? 1 : 0) | (code & 16 ? 2 : 0),
  };
}

// CDP modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
function modifierBits({ alt = false, ctrl = false, meta = false, shift = false } = {}) {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
}

// ── Key mapping (terminal escape sequences → CDP key info) ──

const SPECIAL_KEYS = {
  '\x1b[A':  { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  '\x1b[B':  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  '\x1b[C':  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  '\x1b[D':  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  '\x1b[H':  { key: 'Home',       code: 'Home',       keyCode: 36 },
  '\x1b[F':  { key: 'End',        code: 'End',        keyCode: 35 },
  '\x1b[5~': { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  '\x1b[6~': { key: 'PageDown',   code: 'PageDown',   keyCode: 34 },
  '\x1b[3~': { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  '\x7f':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '\x08' },
  '\x08':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8,  text: '\x08' },
  '\r':      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
  '\n':      { key: 'Enter',      code: 'Enter',      keyCode: 13, text: '\r' },
  '\t':      { key: 'Tab',        code: 'Tab',        keyCode: 9,  text: '\t' },
  '\x1b':    { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  ' ':       { key: ' ',          code: 'Space',      keyCode: 32, text: ' ' },
  '\x1bOP':   { key: 'F1',  code: 'F1',  keyCode: 112 },
  '\x1bOQ':   { key: 'F2',  code: 'F2',  keyCode: 113 },
  '\x1bOR':   { key: 'F3',  code: 'F3',  keyCode: 114 },
  '\x1bOS':   { key: 'F4',  code: 'F4',  keyCode: 115 },
  '\x1b[15~': { key: 'F5',  code: 'F5',  keyCode: 116 },
  '\x1b[17~': { key: 'F6',  code: 'F6',  keyCode: 117 },
  '\x1b[18~': { key: 'F7',  code: 'F7',  keyCode: 118 },
  '\x1b[19~': { key: 'F8',  code: 'F8',  keyCode: 119 },
  '\x1b[20~': { key: 'F9',  code: 'F9',  keyCode: 120 },
  '\x1b[21~': { key: 'F10', code: 'F10', keyCode: 121 },
  '\x1b[23~': { key: 'F11', code: 'F11', keyCode: 122 },
  '\x1b[24~': { key: 'F12', code: 'F12', keyCode: 123 },
};

// Ctrl+Key (0x01-0x1A) → exclude collisions with Backspace/Tab/Enter
const CTRL_KEYS = {};
const CTRL_EXCLUDE = new Set([7, 8, 12]); // H(BS), I(Tab), M(Enter)
for (let i = 0; i < 26; i++) {
  if (CTRL_EXCLUDE.has(i)) continue;
  const char = String.fromCharCode(i + 1);
  const letter = String.fromCharCode(i + 97);
  const upper = letter.toUpperCase();
  CTRL_KEYS[char] = {
    key: letter,
    code: `Key${upper}`,
    keyCode: upper.charCodeAt(0),
    modifiers: modifierBits({ ctrl: true }),
  };
}

// Base key info for modifier+key combinations
const MOD_SUFFIX = {
  'A': { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  'B': { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  'C': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  'D': { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  'H': { key: 'Home',       code: 'Home',       keyCode: 36 },
  'F': { key: 'End',        code: 'End',        keyCode: 35 },
};

const MOD_TILDE = {
  '3':  { key: 'Delete',   code: 'Delete',   keyCode: 46 },
  '5':  { key: 'PageUp',   code: 'PageUp',   keyCode: 33 },
  '6':  { key: 'PageDown', code: 'PageDown',  keyCode: 34 },
  '15': { key: 'F5',  code: 'F5',  keyCode: 116 },
  '17': { key: 'F6',  code: 'F6',  keyCode: 117 },
  '18': { key: 'F7',  code: 'F7',  keyCode: 118 },
  '19': { key: 'F8',  code: 'F8',  keyCode: 119 },
  '20': { key: 'F9',  code: 'F9',  keyCode: 120 },
  '21': { key: 'F10', code: 'F10', keyCode: 121 },
  '23': { key: 'F11', code: 'F11', keyCode: 122 },
  '24': { key: 'F12', code: 'F12', keyCode: 123 },
};

// macOS Option+char → base char map (US keyboard layout)
const MAC_OPTION_MAP = {
  'å': 'a', '∫': 'b', 'ç': 'c', '∂': 'd',
  'ƒ': 'f', '©': 'g', '˙': 'h', '∆': 'j',
  '˚': 'k', '¬': 'l', 'µ': 'm', 'ø': 'o',
  'π': 'p', 'œ': 'q', '®': 'r', 'ß': 's', '†': 't',
  '√': 'v', '∑': 'w', '≈': 'x', '¥': 'y', 'Ω': 'z',
};

function modBitsFromParam(p) {
  const n = p - 1;
  return modifierBits({ shift: !!(n & 1), alt: !!(n & 2), ctrl: !!(n & 4), meta: !!(n & 8) });
}

// Pre-compiled regexes for parseInput (hot path)
const RE_MOD_ARROW = /^\x1b\[1;(\d+)([A-H])$/;
const RE_MOD_TILDE = /^\x1b\[(\d+);(\d+)~$/;

// Parse escape sequence into key info (with modifiers)
export function parseInput(str) {
  const kitty = parseKittyKey(str);
  if (kitty) return kitty;
  // Back-tab and modifier-preserving Tab reports. No protocol is enabled here;
  // decode these forms when the terminal already emits them.
  const tab = modifiers => ({ key: 'Tab', code: 'Tab', keyCode: 9, modifiers });
  if (str === '\x1b[Z') return tab(modifierBits({ shift: true }));
  if (str === '\x1b\x1b[Z') return tab(modifierBits({ alt: true, shift: true }));
  let tabMatch = str.match(/^\x1b\[9(?:;(\d+))?u$/);
  if (tabMatch) return tab(modBitsFromParam(Number(tabMatch[1] ?? 1)));
  tabMatch = str.match(/^\x1b\[27;(\d+);9~$/);
  if (tabMatch) return tab(modBitsFromParam(Number(tabMatch[1])));
  tabMatch = str.match(/^\x1b\[1;(\d+)Z$/);
  if (tabMatch) return tab(modBitsFromParam(Number(tabMatch[1])) | 8);

  // Exact match for special keys
  const special = SPECIAL_KEYS[str];
  if (special) return { ...special, modifiers: 0 };

  // Ctrl+Key (0x01-0x1A)
  if (str.length === 1 && CTRL_KEYS[str]) return CTRL_KEYS[str];

  // Modified arrows: ESC [ 1 ; <mod> <A-H>
  let m = str.match(RE_MOD_ARROW);
  if (m) {
    const info = MOD_SUFFIX[m[2]];
    if (info) return { ...info, modifiers: modBitsFromParam(parseInt(m[1], 10)) };
  }

  // Modified special keys: ESC [ <num> ; <mod> ~
  m = str.match(RE_MOD_TILDE);
  if (m) {
    const info = MOD_TILDE[m[1]];
    if (info) return { ...info, modifiers: modBitsFromParam(parseInt(m[2], 10)) };
  }

  // Alt+char: ESC + single char (not ESC [ or ESC O sequences)
  if (str.length === 2 && str[0] === '\x1b' && str[1] !== '[' && str[1] !== 'O') {
    const ch = str[1];
    // Legacy terminals prefix Alt with ESC; retain Ctrl on control letters.
    // Tab/Enter/Backspace share bytes with Ctrl-I/M/H, so prefer special keys.
    const special = SPECIAL_KEYS[ch];
    if (special) return { ...special, modifiers: modifierBits({ alt: true }) };
    const value = ch.charCodeAt(0);
    if (value >= 1 && value <= 26) {
      const letter = String.fromCharCode(96 + value);
      return {
        key: letter,
        code: `Key${letter.toUpperCase()}`,
        keyCode: letter.toUpperCase().charCodeAt(0),
        modifiers: modifierBits({ alt: true, ctrl: true }),
      };
    }
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: modifierBits({ alt: true }),
    };
  }

  // macOS Option+char: arrives as Unicode char → convert to alt+char
  if (str.length === 1 && MAC_OPTION_MAP[str]) {
    const ch = MAC_OPTION_MAP[str];
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: modifierBits({ alt: true }),
    };
  }

  // Normal characters
  if (!str.startsWith('\x1b') && str.length >= 1) return 'text';

  return undefined;
}

// ── OSC 52 clipboard ──

// Write to clipboard via OSC 52
function clipboardWrite(text) {
  const b64 = Buffer.from(text).toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

// Read from clipboard via OSC 52
function clipboardRead() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const timeout = setTimeout(() => {
    process.stdin.removeListener('data', onData);
    resolve(null);
  }, CLIPBOARD_TIMEOUT);

  let buf = '';
  const onData = (data) => {
    buf += data.toString();
    // OSC 52 response: ESC ] 52 ; c ; <base64> ESC \ or BEL
    const m = buf.match(/\x1b\]52;c;([A-Za-z0-9+/=]*?)(?:\x1b\\|\x07)/);
    if (m) {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      resolve(Buffer.from(m[1], 'base64').toString());
    }
  };
  process.stdin.on('data', onData);

  // Request clipboard read
  process.stdout.write('\x1b]52;c;?\x07');
  return promise;
}

// Get selected text via CDP
async function getSelection(client) {
  try {
    const { result } = await client.send('Runtime.evaluate', {
      expression: 'window.getSelection().toString()',
    });
    return result.value || '';
  } catch { return ''; }
}

// ── casty action execution ──

async function getHistoryEntry(client, delta) {
  const { currentIndex, entries } = await client.send('Page.getNavigationHistory');
  const idx = currentIndex + delta;
  if (idx >= 0 && idx < entries.length) return { entryId: entries[idx].id };
  return { entryId: entries[currentIndex].id };
}

// Find text in the page (case-insensitive); an empty query moves to the next
// match of the last one. Selects the match and scrolls it into view.
export const FIND_SCRIPT = `(query) => {
  const state = window.__castyFind || (window.__castyFind = { text: '', index: -1 });
  if (query) { if (query !== state.text) state.index = -1; state.text = query; }
  if (!state.text) return { error: 'Usage: find <text>' };
  // Search the concatenated text, so a match may span nodes (pages that wrap
  // each letter in its own element, for one)
  const nodes = [], starts = [];
  let all = '';
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { nodes.push(child); starts.push(all.length); all += child.data; }
      else if (child.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(child.tagName)) walk(child);
    }
  };
  if (document.body) walk(document.body);
  const haystack = all.toLowerCase(), needle = state.text.toLowerCase();
  const matches = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) matches.push(at);
  if (!matches.length) return { text: state.text, total: 0, index: -1 };
  state.index = (state.index + 1) % matches.length;
  // Text node and offset holding character \`at\` (the last node starting at or before it)
  const locate = (at, end) => {
    let i = 0;
    while (i + 1 < nodes.length && (starts[i + 1] < at || (!end && starts[i + 1] === at))) i++;
    return [nodes[i], at - starts[i]];
  };
  const from = matches[state.index];
  const [startNode, startOffset] = locate(from, false);
  const [endNode, endOffset] = locate(from + needle.length, true);
  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {}
  startNode.parentElement?.scrollIntoView?.({ block: 'center' });
  return { text: state.text, total: matches.length, index: state.index };
}`;

async function findInPage(client, query) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `(${FIND_SCRIPT})(${JSON.stringify(query)})`,
    returnByValue: true,
  });
  if (exceptionDetails) return { error: 'Find failed' };
  return result?.value ?? { error: 'Find failed' };
}

// Ported from ../exeapk's ERUDA_TOGGLE_JS: loads eruda (github.com/liriliri/eruda)
// from a CDN on first use, then only shows or hides it. Resolves to a status
// instead of alert()ing, which would block a headless page.
const ERUDA_SCRIPT = `new Promise(resolve => {
  const toggle = () => {
    window.__erudaShown = !window.__erudaShown;
    if (window.__erudaShown) eruda.show(); else eruda.hide();
    resolve(window.__erudaShown ? 'Eruda shown' : 'Eruda hidden');
  };
  if (window.eruda) { toggle(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/eruda';
  s.onload = () => {
    try { eruda.init(); window.__erudaShown = false; toggle(); }
    catch (e) { resolve('Eruda failed: ' + e.message); }
  };
  s.onerror = () => resolve('Eruda load failed (need network, or blocked by the page)');
  (document.body || document.documentElement).appendChild(s);
})`;

async function toggleEruda(client) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: ERUDA_SCRIPT,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) return 'Eruda failed';
  return result?.value ?? 'Eruda failed';
}

// ── Main ──

// Track currentUrl locally (replacement for page.url())
// bindings: { "ctrl+q": "quit", "alt+left": "back", "alt+l": "url_bar", ... }
// zoomControl: { get(), set(factor) } for the zoom factor on top of the automatic zoom
export function startInputHandling(client, cellWidth, cellHeight, zoom, bindings, forceCapture, zoomControl = null, pixelGeometry = {}, { noShortcuts = false, readonly = false, mapPointer = null, getCaptureFormat = () => null } = {}) {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Mutable cell dimensions (updated on resize via updateCellSize)
  let _cellW = cellWidth;
  let _cellH = cellHeight;
  let _zoom = zoom || 1;
  let _mouseCellW = pixelGeometry.width || cellWidth;
  let _mouseCellH = pixelGeometry.height || cellHeight;
  mouseProtocol.dimensionsKnown = pixelGeometry.known !== false;

  let readOnly = readonly;
  const originalSend = client.send;
  const heldMouse = new Map();
  // Recheck at dispatch time too: clipboard/history awaits may span a toggle.
  client.send = function(method, ...args) {
    if (readOnly && (/^Input\./.test(method) || ['Page.navigate','Page.reload','Page.navigateToHistoryEntry','Runtime.evaluate','Runtime.callFunctionOn'].includes(method)))
      return Promise.resolve({});
    if (method === 'Input.dispatchMouseEvent') {
      const event=args[0];
      if(event.type==='mousePressed')heldMouse.set(event.button,event);
      else if(event.type==='mouseReleased')heldMouse.delete(event.button);
      else if(event.type==='mouseMoved')for(const [button,press] of heldMouse)heldMouse.set(button,{...press,x:event.x,y:event.y});
    }
    return originalSend.call(this,method,...args);
  };
  const keyToAction = bindings;
  const urlBar = new UrlBar({ commandEntry: noShortcuts });
  if (readOnly) urlBar.setStatus('Read-only (cmd> readonly off to control)');
  const hintMode = new HintMode(forceCapture);
  const keyDispatch = new KeyboardDispatch(client);
  const localKeys = new Set();
  const widgetKeys = new Set();

  // Capture after user input — immediate + delayed for Chrome rendering lag
  const INPUT_CAPTURE_DELAY = 150; // ms
  let _captureTimer = null;
  function captureAfterInput() {
    if (quitRequested) return;
    forceCapture();
    clearTimeout(_captureTimer);
    _captureTimer = setTimeout(forceCapture, INPUT_CAPTURE_DELAY);
  }

  // Throttled mouse motion (mode 1003 generates events for every pixel)
  let pendingMotion = null;
  let lastClickTime = 0, lastClickX = 0, lastClickY = 0, lastClickCount = 0;
  let lastClickButton = null;
  let pendingPress = null;
  let _motionTimer = null;
  const MOTION_INTERVAL = 16; // ms (~60fps)
  function flushMotion() {
    if (pendingMotion) {
      const { x, y } = pendingMotion;
      pendingMotion = null;
      dispatchMouse(client, 'mouseMoved', x, y, 'none').catch(() => {});
    }
  }
  _motionTimer = setInterval(flushMotion, MOTION_INTERVAL);

  // Track current URL locally
  let currentUrl = '';

  // Build rawBindings for macOS Option key (macOS only)
  // On Linux, ESC+char collides with Alt+char byte sequences
  const rawBindings = {};
  if (process.platform === 'darwin') {
    const MAC_OPTION_ARROWS = { 'alt+left': '\x1bb', 'alt+right': '\x1bf' };
    for (const [keyName, action] of Object.entries(bindings)) {
      const m = keyName.match(/^alt\+([a-z])$/);
      if (m) {
        const optChar = Object.entries(MAC_OPTION_MAP).find(([, v]) => v === m[1]);
        if (optChar) rawBindings[optChar[0]] = action;
      }
      if (MAC_OPTION_ARROWS[keyName]) {
        rawBindings[MAC_OPTION_ARROWS[keyName]] = action;
      }
    }
  }

  // Get initial URL from navigation history
  urlBar.loading = false;
  client.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => {
    // A fast navigation may win this race. Do not let an older about:blank
    // history snapshot overwrite the URL delivered by frameNavigated.
    if (!currentUrl && entries[currentIndex]) {
      currentUrl = entries[currentIndex].url;
      urlBar.setUrl(currentUrl);
    }
  }).catch(() => {});

  // Update URL bar on page navigation (CDP events)
  client.on('Page.frameNavigated', ({ frame }) => {
    // Frame without parentId = main frame
    if (!frame.parentId) {
      currentUrl = frame.url;
      urlBar.setUrl(currentUrl);
      urlBar.loading = true;
    }
  });

  // Loading complete
  client.on('Page.loadEventFired', () => {
    urlBar.loading = false;
  });

  // Download handling (CDP events)
  client.on('Browser.downloadWillBegin', ({ suggestedFilename }) => {
    urlBar.setStatus(`Downloading: ${suggestedFilename}`);
  });
  client.on('Browser.downloadProgress', ({ state }) => {
    if (state === 'completed') {
      urlBar.setStatus('Download complete');
      setTimeout(() => urlBar.clearStatus(), 3000);
    } else if (state === 'canceled') {
      urlBar.setStatus('Download canceled');
      setTimeout(() => urlBar.clearStatus(), 3000);
    }
  });

  function flash(message, ms = STATUS_DISPLAY_MS) {
    urlBar.setStatus(message);
    setTimeout(() => urlBar.clearStatus(), ms);
  }

  async function navigate(url) {
    if(readOnly){flash('Read-only (readonly off to control)');return;}
    urlBar.loading = true;
    await client.send('Page.navigate', { url });
  }

  async function setZoom(factor) {
    if (!zoomControl) { flash('Zoom is not available'); return; }
    await zoomControl.set(factor);
    flash(`Zoom ${Math.round(factor * 100)}%`);
  }

  // Run one "cmd> " line
  async function runCommand(line) {
    const { name, arg, error } = parseCommand(line);
    if (error) { flash(error, 3000); return; }
    if (name === 'readonly') {
      const mode = arg.trim().toLowerCase();
      if (mode && !['on','off'].includes(mode)) { flash('Usage: readonly [on|off]');return; }
      if (mode) {
        pendingMotion=null;pendingPress=null;
        await keyDispatch.releaseAll();
        for(const [button,event] of heldMouse) await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',button,x:event.x,y:event.y,buttons:0});
        heldMouse.clear();
        readOnly=mode==='on';
      }
      flash(`Read-only: ${readOnly?'on':'off'}`);return;
    }
    if (readOnly && !['help','quit','cdp','kitty','pixelmouse','copyurl'].includes(name)) {
      flash('Read-only (readonly off to control)');return;
    }
    switch (name) {
      case 'open': {
        if (!arg) { flash('Usage: open <url|query>'); return; }
        const url = toURL(arg);
        if (url) await navigate(url);
        else flash('Bookmark not found');
        return;
      }
      case 'bookmark': {
        const [first] = searchBookmarks(arg);
        if (first) await navigate(first.url);
        else flash('Bookmark not found');
        return;
      }
      case 'links': await execAction('hints'); return;
      case 'copyurl': await execAction('copy_url'); return;
      case 'pasteurl': await execAction('paste_url'); return;
      case 'download': await execAction('download'); return;
      case 'find': {
        const result = await findInPage(client, arg);
        if (result.error) flash(result.error);
        else if (!result.total) flash(`Not found: ${result.text}`);
        else flash(`${result.text}: ${result.index + 1}/${result.total}`);
        captureAfterInput();
        return;
      }
      case 'eruda': await execAction('eruda'); return;
      case 'cdp': {
        if (arg && arg.trim().toLowerCase() !== 'ws') { flash('Usage: cdp [ws]'); return; }
        const info = client.diagnostics();
        if (arg) flash(info.wsUrl || 'CDP WebSocket unavailable', 15000);
        else flash(`CDP ${info.address} · ${info.state} · ${info.browser} · protocol=${info.protocol} · pending=${info.pending}`, 15000);
        return;
      }
      case 'kitty': {
        const mode = arg.trim().toLowerCase();
        if (mode && !['inline', 'file'].includes(mode)) { flash('Usage: kitty [inline|file]'); return; }
        if (mode) { setTransport(mode); captureAfterInput(); }
        const format = getCaptureFormat();
        flash(`${transportStatus()}${format ? ` · format=${format}${format === 'jpeg' ? ' (adaptive)' : ''}` : ''}`);
        return;
      }
      case 'pixelmouse': {
        const mode = arg.trim().toLowerCase();
        if (!mode) { flash(mouseProtocol.pending ? 'Pixel mouse: checking' : `Pixel mouse: ${mouseProtocol.pixel ? 'on (1016)' : 'off (1006)'}`); return; }
        if (!['on', 'off'].includes(mode)) { flash('Usage: pixelmouse on|off'); return; }
        flushMotion(); pendingPress = null;
        mouseProtocol.onChange = pixel => flash(pixel ? 'Pixel mouse: on (1016)' : mode === 'off' ? 'Pixel mouse: off (1006)' : 'Pixel mouse unavailable; using 1006');
        mouseProtocol.forceCell = mode === 'off';
        if (mode === 'on') flash('Checking pixel mouse support…');
        mouseProtocol.start();
        return;
      }
      case 'help': flash(helpText(), 8000); return;
      case 'zoom': {
        const current = zoomControl?.get() ?? 1;
        if (!arg) { flash(`Zoom ${Math.round(current * 100)}% (zoom n|n%|+|-|reset)`); return; }
        const factor = parseZoom(arg, current);
        if (factor === null) flash(`Invalid zoom: ${arg}`);
        else await setZoom(factor);
        return;
      }
      default: await execAction(name);
    }
  }

  // Execute action
  async function execAction(action) {
    if (readOnly && !['quit','command','url_bar','copy_url','paste_url'].includes(action)) {
      flash('Read-only (readonly off to control)');return true;
    }
    if (action === 'quit') { process.emit('SIGINT'); return true; }
    if (action === 'reload') {
      urlBar.loading = true;
      await client.send('Page.reload');
      return true;
    }
    if (action === 'home') {
      await navigate(toURL(loadConfig().homeUrl));
      return true;
    }
    if (action === 'eruda') {
      try { flash(await toggleEruda(client)); }
      catch (e) { flash(`Eruda failed: ${e.message}`); }
      captureAfterInput();
      return true;
    }
    if (action === 'download') {
      try {
        flash(`Saved: ${await downloadPage(client)}`, 5000);
      } catch (error) {
        flash(`Download failed: ${error.message}`, 5000);
      }
      return true;
    }
    if (action === 'copy_url') {
      if (currentUrl) {
        clipboardWrite(currentUrl);
        flash(`Copied: ${currentUrl}`);
      }
      return true;
    }
    if (action === 'zoom_in' || action === 'zoom_out' || action === 'zoom_reset') {
      const step = { zoom_in: '+', zoom_out: '-', zoom_reset: 'reset' }[action];
      await setZoom(parseZoom(step, zoomControl?.get() ?? 1));
      return true;
    }
    if (action === 'url_bar' || action === 'command' || action === 'paste_url') {
      // paste_url: the clipboard goes into the address bar to edit or send
      let text = null;
      if (action === 'paste_url') {
        text = (await clipboardRead())?.replace(/\s+/g, ' ').trim();
        if (!text) { flash('Clipboard is empty'); return true; }
      }
      // Do not await the editing session: input is handled serially, so the
      // keystrokes that finish editing could never reach the URL bar.
      // Clicking the prompt switches modes, so either result can come back.
      await keyDispatch.releaseAll();
      urlBar.startEditing({ command: action === 'command', text }).then(async (result) => {
        forceCapture();
        if (result?.mode === 'cmd') await runCommand(result.line);
        else if (result?.url) await navigate(result.url);
      }).catch(e => console.error('casty: address bar error:', e.message));
      return true;
    }
    if (action === 'back') {
      urlBar.loading = true;
      await client.send('Page.navigateToHistoryEntry', await getHistoryEntry(client, -1));
      return true;
    }
    if (action === 'forward') {
      urlBar.loading = true;
      await client.send('Page.navigateToHistoryEntry', await getHistoryEntry(client, +1));
      return true;
    }
    if (action === 'copy') {
      const text = await getSelection(client);
      if (text) {
        clipboardWrite(text);
        urlBar.setStatus(`Copied: ${text.slice(0, 40)}${text.length > 40 ? '...' : ''}`);
        setTimeout(() => urlBar.clearStatus(), STATUS_DISPLAY_MS);
      }
      return true;
    }
    if (action === 'paste') {
      const text = await clipboardRead();
      if (text) {
        await client.send('Input.insertText', { text });
        captureAfterInput();
      }
      return true;
    }
    if (action === 'hints') {
      await keyDispatch.releaseAll();
      hintMode.start(client);
      return true;
    }
    return false;
  }

  // Serialize input handling: a mouse release arriving in its own chunk must
  // not overtake the press still awaiting its click marker, or Chrome sees
  // mouseReleased before mousePressed and drops the click.
  let inputChain = Promise.resolve();
  let quitRequested = false;
  function isQuit(token) {
    if (noShortcuts) return false;
    const key = parseInput(token);
    if (key?.eventType === 3) return false;
    return (rawBindings[token] || (key && key !== 'text' && keyToAction[toKeyName(key)])) === 'quit';
  }
  function enqueueInput(str) {
    if (quitRequested) return;
    // Quitting must work even while the browser is stalled and earlier input
    // is still awaiting CDP replies, so it skips the queue. A chunk can hold
    // mouse reports and keys together; tokenize it to find the quit key.
    const tokens = str.match(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[<\d+;-?\d+;-?\d+[Mm]|\x1b\[[0-?]*[ -/]*[@-~]|\x1bO.|\x1b[^\[O]|[\x00-\x1f\x7f]|[^\x00-\x1f\x7f]+/g) || [];
    if (tokens.some(isQuit)) {
      quitRequested = true;
      pendingMotion = null;
      process.emit('SIGINT');
      return;
    }
    inputChain = inputChain
      .then(() => { if (!quitRequested) return handleInput(str); })
      .catch(e => {
        // Closing CDP rejects in-flight input; that is expected after stop.
        if (!quitRequested) console.error('casty: input error:', e.message);
      });
  }

  const keyboard = new KeyboardProtocol({
    write: text => process.stdout.write(text),
    onInput: token => filterKittyReplies(token, text => mouseProtocol.feed(text, enqueueInput)),
  });
  const onStdin = data => keyboard.feed(data);
  process.stdin.on('data', onStdin);
  stopKeyboard = () => {
    quitRequested = true;
    client.send = originalSend;
    process.removeListener('exit', stopKeyboard);
    clearTimeout(_captureTimer);
    clearTimeout(_motionTimer);
    process.stdin.removeListener('data', onStdin);
    keyboard.stop();
    void keyDispatch.releaseAll().catch(() => {});
  };
  process.once('exit', stopKeyboard);
  keyboard.start();

  async function handleInput(str) {
    const result = parseInput(str);
    const key = result && result !== 'text' ? result : null;
    const identity = key && (key.code || key.key);
    // An IME or terminal toolbar can send legacy bytes even after Kitty
    // negotiation. Only Kitty-encoded keys promise a later release event.
    const reportsRelease = Boolean(key?.kitty && (keyboard.flags & 2));
    // Releases bypass widgets/actions and only release keys sent to the page.
    if (key?.eventType === 3) {
      localKeys.delete(identity);
      widgetKeys.delete(identity);
      await keyDispatch.send(key, true);
      captureAfterInput();
      return;
    }
    if (key?.eventType === 2 && localKeys.has(identity)) return;
    if (widgetKeys.has(identity) && !urlBar.editing && !hintMode.active) return;
    const widgetText = key?.kitty ? localKeyText(key) : str;
    // Hint mode active → route all input to hint mode
    if (hintMode.active) {
      if (reportsRelease) widgetKeys.add(identity);
      if (widgetText) await hintMode.handleInput(widgetText);
      return;
    }

    // A left press on the page leaves address editing and continues to the
    // page. Ghostty can report negative coordinates when the pointer leaves
    // its grid.
    if (urlBar.editing && /^\x1b\[</.test(str)) {
      let toPage = false;
      for (const [, cb, rawX, rawY, kind] of str.matchAll(/\x1b\[<(\d+);(-?\d+);(-?\d+)([Mm])/g)) {
        const { col, row } = mouseCoordinates(Number(rawX), Number(rawY), _cellW, _cellH, _zoom, mouseProtocol.pixel, _mouseCellW, _mouseCellH);
        const button = Number(cb) & ~28; // ignore Shift/Alt/Ctrl mouse modifiers
        if (button === MOUSE_BTN_LEFT && kind === 'm') { urlBar.pointerUp(); continue; }
        if (button === MOUSE_BTN_DRAG && kind === 'M' && urlBar.dragging) {
          urlBar.pointerMove(Math.max(1, Number(col))); continue;
        }
        if (button !== MOUSE_BTN_LEFT || kind !== 'M' || Number(col) <= 0) continue;
        if (Number(row) === 1) urlBar.pointerDown(Number(col));
        else if (Number(row) > 1) toPage = true;
      }
      if (!toPage) return;
      urlBar.cancelEditing();
    }

    // URL bar editing → handle copy/paste here, rest goes to URL bar
    if (urlBar.editing) {
      if (reportsRelease) widgetKeys.add(identity);
      const r = parseInput(str);
      const kn = r && r !== 'text' ? toKeyName(r) : null;
      const act = widgetText === '\x03' ? 'copy' : (kn ? keyToAction[kn] : rawBindings[str]);
      if (act === 'quit') { await execAction('quit'); return; }
      if (act === 'paste') {
        if (reportsRelease) localKeys.add(identity);
        const text = await clipboardRead();
        if (text) urlBar.insertText(text);
        return;
      }
      if (act === 'copy') {
        if (reportsRelease) localKeys.add(identity);
        if (urlBar.text) {
          clipboardWrite(urlBar.selectedText || urlBar.text);
          urlBar.setStatus('Copied');
          setTimeout(() => urlBar.clearStatus(), 1500);
        }
        return;
      }
      if (widgetText) urlBar.handleInput(widgetText);
      return;
    }

    // SGR 1006 mouse event: ESC [ < Cb ; Cx ; Cy M/m
    //   Cb: 0=left click, 32=drag, 64..67=scroll up/down/left/right
    //   M=press, m=release
    const mouseRe = /\x1b\[<(\d+);(-?\d+);(-?\d+)([Mm])/g;
    let match;
    let hadMouse = false;

    while ((match = mouseRe.exec(str)) !== null) {
      hadMouse = true;
      const cb = parseInt(match[1]);
      let { col, row, x, y } = mouseCoordinates(Number(match[2]), Number(match[3]), _cellW, _cellH, _zoom, mouseProtocol.pixel, _mouseCellW, _mouseCellH);
      const release = match[4] === 'm';


      // Click on line 1 → open address bar
      if (row === 1 && col > 0 && cb === MOUSE_BTN_LEFT && !release) {
        const action = noShortcuts && col <= 3 ? 'command' : 'url_bar';
        await execAction(action);
        if (action === 'url_bar') urlBar.armDrag(col);
        return;
      }
      // Other buttons on line 1 would land above the page; ignore them
      if (row === 1 && cb === MOUSE_BTN_RIGHT) continue;

      if (readOnly) continue;
      if (mapPointer) {
        const point=mapPointer(col,row);
        if(!point)continue;
        ({x,y}=point);
      }
      const wheel = mouseWheelEvent(cb, x, y, release);
      if (wheel) {
        await client.send('Input.dispatchMouseEvent', wheel);
      } else if (MOUSE_BUTTONS[cb]) {
        // Left and right buttons share one path; only the button differs
        const { button, mask } = MOUSE_BUTTONS[cb];
        if (!release) {
          // Defer the press: a tap (press+release without drag) goes through
          // the exact same dispatchClick() path as hint mode.
          const now = Date.now();
          const MULTI_CLICK_MS = 400;
          const MULTI_CLICK_PX = 5;
          if (button === lastClickButton
              && now - lastClickTime < MULTI_CLICK_MS
              && Math.abs(x - lastClickX) < MULTI_CLICK_PX
              && Math.abs(y - lastClickY) < MULTI_CLICK_PX) {
            lastClickCount = Math.min(lastClickCount + 1, 3);
          } else {
            lastClickCount = 1;
          }
          lastClickButton = button;
          lastClickTime = now;
          lastClickX = x;
          lastClickY = y;
          pendingPress = { x, y, col, row, button, mask, clickCount: lastClickCount };
        } else if (pendingPress) {
          const { x: px, y: py, clickCount, button: pressed } = pendingPress;
          pendingPress = null;
          await dispatchClick(client, px, py, { clickCount, button: pressed, source: `tap ${col},${row}` });
        } else {
          await dispatchMouse(client, 'mouseReleased', x, y, button, lastClickCount || 1, 0);
        }
      } else if (MOUSE_BUTTONS[cb - MOUSE_BTN_DRAG]) {
        const { button, mask } = MOUSE_BUTTONS[cb - MOUSE_BTN_DRAG];
        // Touch slop: a finger wobbling into a neighbouring cell is still a
        // tap, not a drag. Keep the press deferred until it moves further.
        if (pendingPress && (mouseProtocol.pixel
            ? Math.abs(x - pendingPress.x) * _zoom <= 3 && Math.abs(y - pendingPress.y) * _zoom <= 3
            : Math.abs(col - pendingPress.col) <= 1 && Math.abs(row - pendingPress.row) <= 1)) {
          continue;
        }
        if (pendingPress) {
          // Real drag: flush the deferred press at its original position
          const { x: px, y: py, clickCount } = pendingPress;
          pendingPress = null;
          await dispatchMouse(client, 'mousePressed', px, py, button, clickCount, mask);
        }
        await dispatchMouse(client, 'mouseMoved', x, y, button, 0, mask);
      } else if (cb === MOUSE_BTN_MOTION) {
        // Mode 1003: motion without button — throttled to avoid flooding CDP
        pendingMotion = { x, y };
      }
    }

    if (hadMouse) { captureAfterInput(); return; }

    // Check raw input bindings directly (macOS Option+char)
    if (!noShortcuts && rawBindings[str]) {
      await execAction(rawBindings[str]);
      return;
    }

    // Check bindings via parseInput
    if (!noShortcuts && result && result !== 'text') {
      const keyName = toKeyName(result);
      const action = keyToAction[keyName];
      if (action && await execAction(action)) {
        if (reportsRelease) localKeys.add(identity);
        return;
      }
    }

    // Not a casty action → pass through to Chrome
    if (readOnly) return;
    if (result === 'text') {
      await client.send('Input.insertText', { text: str });
      captureAfterInput();
    } else if (result) {
      await keyDispatch.send(result, reportsRelease);
      captureAfterInput();
    }
  }

  // Allow updating cell dimensions after resize
  urlBar.updateCellSize = (w, h, nextZoom = 1, geometry = {}) => {
    _cellW = w;
    _cellH = h;
    _zoom = nextZoom || 1;
    _mouseCellW = geometry.width || w;
    _mouseCellH = geometry.height || h;
    mouseProtocol.dimensionsKnown = geometry.known !== false;
    if (!mouseProtocol.dimensionsKnown && mouseProtocol.pixel) { mouseProtocol.stop(); mouseProtocol.activate(false); }
  };

  return urlBar;
}
