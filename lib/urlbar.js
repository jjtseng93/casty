// Address bar / search bar (always visible)
// Line 1 of the terminal always shows the current URL
// Alt+L to enter edit mode → Enter to navigate, Escape to cancel

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { showCursor, hideCursor } from './kitty.js';
import { loadConfig, loadJsonFile } from './config.js';
import { searchBookmarks } from './bookmarks.js';

const PROMPTS = { url: ' > ', cmd: 'cmd> ' };
const HISTORY_MAX = 100;
const DOUBLE_CLICK_MS = 400;
export const HISTORY_PATH = join(homedir(), '.casty', 'history.json');

function hasScheme(str) {
  return /^[a-z][a-z0-9+.-]*:/i.test(str);
}

function isLocalAddress(str) {
  return /^(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i.test(str)
    || /^\[::1\](?::\d+)?(?:[/?#]|$)/i.test(str);
}

function isPublicHostname(str) {
  return /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(?::\d+)?(?:[/?#]|$)/.test(str);
}

export function toURL(input) {
  if (isLocalAddress(input)) return 'http://' + input;
  if (hasScheme(input)) return input;
  if (isPublicHostname(input)) return 'https://' + input;

  // /b [query] → bookmark search
  const bm = input.match(/^\/b(?:\s+(.+))?$/);
  if (bm) {
    const results = searchBookmarks(bm[1] || '');
    if (results.length > 0) return results[0].url;
    return null; // No match
  }

  const config = loadConfig();
  return config.searchUrl + encodeURIComponent(input);
}

// East Asian Width (UAX #11) full-width detection
// Character display width (full-width=2, half-width=1)
function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||  // CJK Radicals Supplement, Symbols
    (cp >= 0x3040 && cp <= 0x33BF) ||  // Hiragana, Katakana, CJK Compatibility
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Unified Ideographs Extension A
    (cp >= 0x4E00 && cp <= 0xA4CF) ||  // CJK Unified Ideographs, Yi Syllables
    (cp >= 0xAC00 && cp <= 0xD7FF) ||  // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compatibility Forms, Small Forms
    (cp >= 0xFF01 && cp <= 0xFF60) ||  // Fullwidth Latin, Symbols
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Currency, Symbols
    (cp >= 0x20000 && cp <= 0x2FA1F)   // CJK Extensions B-F, Compatibility Supplement
  ) return 2;
  return 1;
}

function strWidth(str) {
  let w = 0;
  for (const ch of str) w += charWidth(ch.codePointAt(0));
  return w;
}

// Truncate by display width (keep rightmost maxW columns)
function sliceByWidth(str, maxW) {
  const chars = [...str];
  let w = 0;
  let start = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = charWidth(chars[i].codePointAt(0));
    if (w + cw > maxW) break;
    w += cw;
    start = i;
  }
  return { text: chars.slice(start).join(''), width: w };
}

// padEnd by display width
function padEndByWidth(str, totalW) {
  const w = strWidth(str);
  return w >= totalW ? str : str + ' '.repeat(totalW - w);
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Entered lines per mode ({ url: [...], cmd: [...] }), oldest first, like
// jsmdcui's prompt history. file: null keeps it in memory only.
export class PromptHistory {
  constructor(file = HISTORY_PATH) {
    this.file = file;
    const data = file ? loadJsonFile(file, {}) : {};
    this.entries = {};
    for (const mode of Object.keys(PROMPTS)) {
      this.entries[mode] = Array.isArray(data?.[mode]) ? data[mode].filter(e => typeof e === 'string') : [];
    }
  }

  list(mode) { return this.entries[mode]; }

  add(mode, line) {
    if (!line) return;
    const list = this.entries[mode];
    const index = list.indexOf(line);
    if (index >= 0) list.splice(index, 1);
    list.push(line);
    if (list.length > HISTORY_MAX) list.splice(0, list.length - HISTORY_MAX);
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {}
  }
}

export class UrlBar {
  constructor({ history = new PromptHistory() } = {}) {
    this.currentUrl = '';
    this.editing = false;
    this.loading = false;
    this._spinIdx = 0;
    this._status = null;
    this.text = '';
    this.cursor = 0;
    this._savedHead = '';
    this._savedTail = '';
    this.selectAll = false; // Select-all state
    this._resolve = null;
    this._dirty = true;     // Needs re-render
    this._spinTimer = null; // Spinner update interval
    this.mode = 'url';      // 'url' (address) or 'cmd' (Ctrl+E command line)
    this.history = history;
    this._historyIndex = 0;
    this._savedInput = '';
    this._lastClick = { time: 0, zone: null };
  }

  get prompt() { return PROMPTS[this.mode]; }

  // Update current URL and re-render (if not editing)
  setUrl(url) {
    this.currentUrl = url;
    this._dirty = true;
    if (!this.editing) this.render();
  }

  // Status message (downloads, etc.)
  setStatus(msg) { this._status = msg; this._dirty = true; }
  clearStatus() { this._status = null; this._dirty = true; }

  // Render only if content changed (for frame callback)
  renderIfDirty() {
    if (!this._dirty) return;
    this.render();
  }

  // Render on line 1
  render() {
    this._dirty = false;
    this._updateSpinTimer();
    const cols = process.stdout.columns || 80;
    const line = this.editing ? this._editLine(cols) : this._displayLine(cols);
    process.stdout.write(`\x1b[1;1H${line}\x1b[0m`);
    if (this.editing) {
      const prefix = this.prompt;
      const textBeforeCursor = [...this.text].slice(0, this.cursor).join('');
      const cursorCol = prefix.length + strWidth(textBeforeCursor) + 1;
      process.stdout.write(`\x1b[1;${cursorCol}H`);
    }
  }

  // Start/stop spinner timer (100ms interval instead of every frame)
  _updateSpinTimer() {
    if (this.loading && !this._spinTimer) {
      this._spinTimer = setInterval(() => { this._dirty = true; }, 100);
    } else if (!this.loading && this._spinTimer) {
      clearInterval(this._spinTimer);
      this._spinTimer = null;
    }
  }

  _displayLine(cols) {
    let prefix;
    if (this.loading) {
      prefix = ' ' + SPINNER[this._spinIdx++ % SPINNER.length] + ' ';
    } else {
      prefix = '   ';
    }
    const content = this._status || this.currentUrl;
    const full = prefix + content;
    return `\x1b[38;5;250m\x1b[48;5;236m${padEndByWidth(full, cols)}`;
  }

  _editLine(cols) {
    const prefix = this.prompt;
    const maxW = cols - prefix.length;
    const tw = strWidth(this.text);
    const display = tw > maxW ? sliceByWidth(this.text, maxW).text : this.text;
    const dw = strWidth(display);
    const pad = Math.max(0, maxW - dw);
    if (this.selectAll) {
      return `\x1b[48;5;24m\x1b[97m${prefix}\x1b[7m${display}\x1b[27m${' '.repeat(pad)}`;
    }
    return `\x1b[97m\x1b[48;5;24m${prefix}${display}${' '.repeat(pad)}`;
  }

  // Start editing. Resolves { mode: 'url', url } (url null when cancelled or
  // no bookmark matched) or { mode: 'cmd', line }, or null when cancelled.
  // command: true starts in "cmd> " mode with an empty line; text: start from
  // this text (not selected, cursor at the end) instead.
  startEditing({ command = false, text = null } = {}) {
    this.editing = true;
    this.mode = command ? 'cmd' : 'url';
    this.selectAll = !command && text === null;
    this.text = text ?? (command ? '' : this.currentUrl);
    this.cursor = [...this.text].length;
    this._resetHistory();
    showCursor();
    this.render();
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this._resolve = resolve;
    return promise;
  }

  // End editing mode
  _finishEditing(result) {
    this.editing = false;
    hideCursor();

    let value = null;
    if (result) {
      this.history.add(this.mode, result);
      if (this.mode === 'cmd') {
        value = { mode: 'cmd', line: result };
      } else {
        const url = toURL(result);
        if (url === null) {
          // Bookmark not found
          this.setStatus('Bookmark not found');
          setTimeout(() => this.clearStatus(), 2000);
        }
        value = { mode: 'url', url };
      }
    }

    this.render();
    if (this._resolve) {
      this._resolve(value);
      this._resolve = null;
    }
  }

  // Switch between the address and command prompts, keeping the text
  toggleMode() {
    this.mode = this.mode === 'url' ? 'cmd' : 'url';
    this._deselect();
    this._resetHistory();
    this.render();
  }

  _resetHistory() {
    this._historyIndex = this.history.list(this.mode).length;
    this._savedInput = '';
  }

  _setText(text) {
    this.text = text;
    this.cursor = [...text].length;
    this._deselect();
    this.render();
  }

  historyUp() {
    const list = this.history.list(this.mode);
    if (this._historyIndex === list.length) this._savedInput = this.text;
    if (this._historyIndex > 0) this._setText(list[--this._historyIndex]);
  }

  historyDown() {
    const list = this.history.list(this.mode);
    if (this._historyIndex < list.length) {
      this._historyIndex++;
      this._setText(this._historyIndex === list.length ? this._savedInput : list[this._historyIndex]);
    }
  }

  // Left press on line 1 (col is 1-based), as in jsmdcui:
  // - double click: left third = next history entry, middle = previous, right = Enter
  // - click on the prompt (" > " / "cmd> "): switch modes, keeping the text
  // - elsewhere: move the cursor
  handleClick(col, now = Date.now()) {
    if (!this.editing) return;
    const cols = process.stdout.columns || 80;
    const third = Math.floor(cols / 3);
    const zone = col <= third ? 'left' : col <= third * 2 ? 'middle' : 'right';
    const double = this._lastClick.zone === zone && now - this._lastClick.time < DOUBLE_CLICK_MS;
    this._lastClick = double ? { time: 0, zone: null } : { time: now, zone };
    if (double) {
      if (zone === 'left') this.historyDown();
      else if (zone === 'middle') this.historyUp();
      else this._finishEditing(this.text.trim() || null);
      return;
    }
    if (col <= this.prompt.length) {
      this.toggleMode();
      return;
    }
    // Map the column to a character, skipping any text scrolled off the left
    const chars = [...this.text];
    const visible = [...sliceByWidth(this.text, cols - this.prompt.length).text];
    let index = chars.length - visible.length;
    let width = 0;
    const target = col - this.prompt.length - 1;
    while (index < chars.length) {
      const w = charWidth(chars[index].codePointAt(0));
      if (width + w / 2 > target) break;
      width += w;
      index++;
    }
    this.cursor = index;
    this._deselect();
    this.render();
  }

  // Clear selection
  _deselect() { this.selectAll = false; }

  // If selected, replace all on input/delete
  _clearIfSelected() {
    if (this.selectAll) {
      this.text = '';
      this.cursor = 0;
      this.selectAll = false;
    }
  }

  // Ctrl+U / Ctrl+K: cut or restore the text on one side of the cursor.
  // The two sides deliberately keep independent buffers, like bunmsh.
  _toggleSavedText(side) {
    const chars = [...this.text];
    const savedKey = side === 'head' ? '_savedHead' : '_savedTail';

    if (side === 'head' && this.cursor > 0) {
      this[savedKey] = chars.slice(0, this.cursor).join('');
      this.text = chars.slice(this.cursor).join('');
      this.cursor = 0;
    } else if (side === 'head' && this[savedKey]) {
      const saved = this[savedKey];
      this.text = saved + this.text;
      this.cursor = [...saved].length;
      this[savedKey] = '';
    } else if (side === 'tail' && this.cursor < chars.length) {
      this[savedKey] = chars.slice(this.cursor).join('');
      this.text = chars.slice(0, this.cursor).join('');
    } else if (side === 'tail' && this[savedKey]) {
      this.text += this[savedKey];
      this[savedKey] = '';
    }

    this._deselect();
    this.render();
  }

  // Insert text (for paste)
  insertText(str) {
    if (!this.editing) return;
    this._clearIfSelected();
    const chars = [...this.text];
    const input = [...str];
    this.text = chars.slice(0, this.cursor).join('') + str + chars.slice(this.cursor).join('');
    this.cursor += input.length;
    this.render();
  }

  // Handle key input during editing (returns true if consumed)
  handleInput(str) {
    if (!this.editing) return false;

    // Enter → confirm
    if (str === '\r' || str === '\n') {
      this._finishEditing(this.text.trim() || null);
      return true;
    }

    // Escape → cancel
    if (str === '\x1b') {
      this._finishEditing(null);
      return true;
    }

    // Ctrl+C → cancel
    if (str === '\x03') {
      this._finishEditing(null);
      return true;
    }

    // Ctrl+U → toggle text before the cursor
    if (str === '\x15') {
      this._toggleSavedText('head');
      return true;
    }

    // Ctrl+K → toggle text after the cursor
    if (str === '\x0b') {
      this._toggleSavedText('tail');
      return true;
    }

    // Up / Down → history of this mode
    if (str === '\x1b[A' || str === '\x1bOA') {
      this.historyUp();
      return true;
    }
    if (str === '\x1b[B' || str === '\x1bOB') {
      this.historyDown();
      return true;
    }

    // Ctrl+A → select all
    if (str === '\x01') {
      this.selectAll = true;
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // Ctrl+E → move to end
    if (str === '\x05') {
      this._deselect();
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // Ctrl+W → delete word
    if (str === '\x17') {
      this._clearIfSelected();
      const chars = [...this.text];
      const before = chars.slice(0, this.cursor).join('');
      const after = chars.slice(this.cursor).join('');
      const trimmed = before.replace(/\S+\s*$/, '');
      this.text = trimmed + after;
      this.cursor = [...trimmed].length;
      this.render();
      return true;
    }

    // Backspace
    if (str === '\x7f' || str === '\x08') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor > 0) {
        const chars = [...this.text];
        chars.splice(this.cursor - 1, 1);
        this.text = chars.join('');
        this.cursor--;
      }
      this.render();
      return true;
    }

    // Delete
    if (str === '\x1b[3~') {
      if (this.selectAll) {
        this._clearIfSelected();
      } else if (this.cursor < [...this.text].length) {
        const chars = [...this.text];
        chars.splice(this.cursor, 1);
        this.text = chars.join('');
      }
      this.render();
      return true;
    }

    // Left arrow → deselect and move to start
    if (str === '\x1b[D') {
      if (this.selectAll) { this.cursor = 0; this._deselect(); }
      else if (this.cursor > 0) this.cursor--;
      this.render();
      return true;
    }

    // Right arrow → deselect and move to end
    if (str === '\x1b[C') {
      if (this.selectAll) { this._deselect(); }
      else if (this.cursor < [...this.text].length) this.cursor++;
      this.render();
      return true;
    }

    // Home
    if (str === '\x1b[H') {
      this._deselect();
      this.cursor = 0;
      this.render();
      return true;
    }

    // End
    if (str === '\x1b[F') {
      this._deselect();
      this.cursor = [...this.text].length;
      this.render();
      return true;
    }

    // Normal character input → replace all if selected
    if (!str.startsWith('\x1b') && str.charCodeAt(0) >= 32) {
      this._clearIfSelected();
      const chars = [...this.text];
      const input = [...str];
      this.text = chars.slice(0, this.cursor).join('') + str + chars.slice(this.cursor).join('');
      this.cursor += input.length;
      this.render();
      return true;
    }

    return true; // Consume all input while editing
  }
}
