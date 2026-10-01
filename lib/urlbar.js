// Address bar / search bar (always visible)
// Line 1 of the terminal always shows the current URL
// Alt+L to enter edit mode → Enter to navigate, Escape to cancel

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { showCursor, hideCursor } from './kitty.js';
import { loadConfig, loadJsonFile } from './config.js';
import { searchBookmarks } from './bookmarks.js';
import { displayWidth, fitWidth, promptView, visualColToCharIdx } from './prompt-width.js';

const PROMPTS = { url: ' > ', cmd: 'cmd> ' };
const HISTORY_MAX = 100;
const DOUBLE_CLICK_MS = 400;
// The sequences terminals send for these keys (normal and application cursor
// mode, VT220 and rxvt Home/End), as jsmdcui recognizes them.
const LEFT_KEYS = new Set(['\x1b[D', '\x1bOD', '\x1b[1;5D', '\x1b[5D']);
const RIGHT_KEYS = new Set(['\x1b[C', '\x1bOC', '\x1b[1;5C', '\x1b[5C']);
const HOME_KEYS = new Set(['\x1b[H', '\x1bOH', '\x1b[1~', '\x1b[7~']);
const END_KEYS = new Set(['\x1b[F', '\x1bOF', '\x1b[4~', '\x1b[8~']);
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

// padEnd by display width, cut to fit the line
function padEndByWidth(str, totalW) {
  const fitted = fitWidth(str, totalW);
  return fitted + ' '.repeat(Math.max(0, totalW - displayWidth(fitted)));
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
    this._scrollX = 0;      // Horizontal scroll of the edit line, as in jsmdcui
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
    if (!this.editing) {
      process.stdout.write(`\x1b[1;1H${this._displayLine(cols)}\x1b[0m`);
      return;
    }
    const view = this._editView(cols);
    process.stdout.write(`\x1b[1;1H${this._editLine(cols, view)}\x1b[0m\x1b[1;${view.cursorCol + 1}H`);
  }

  // The edit line's horizontal scroll: long text scrolls so the cursor stays
  // visible, and Home brings back its start (jsmdcui's prompt).
  _editView(cols) {
    // At the start of the text (Home, or Left there) the whole prompt shows
    // too, instead of only scrolling as far as the cursor as jsmdcui does.
    if (this.cursor === 0) this._scrollX = 0;
    const before = [...this.text].slice(0, this.cursor).join('');
    const view = promptView(this.prompt, this.text, before.length, cols, this._scrollX);
    this._scrollX = view.scrollX;
    return view;
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

  _editLine(cols, view = this._editView(cols)) {
    const prefix = this.prompt;
    const visible = fitWidth((prefix + this.text).slice(view.start), cols - view.lead);
    const shownPrefix = prefix.slice(Math.min(view.start, prefix.length));
    const label = ' '.repeat(view.lead) + visible.slice(0, shownPrefix.length);
    const text = visible.slice(shownPrefix.length);
    const pad = ' '.repeat(Math.max(0, cols - view.lead - displayWidth(visible)));
    if (this.selectAll) {
      return `\x1b[48;5;24m\x1b[97m${label}\x1b[7m${text}\x1b[27m${pad}`;
    }
    return `\x1b[97m\x1b[48;5;24m${label}${text}${pad}`;
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
    this._scrollX = 0;
    this._resetHistory();
    showCursor();
    this.render();
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    this._resolve = resolve;
    return promise;
  }

  // Leave editing as if Escape was pressed
  cancelEditing() {
    if (this.editing) this._finishEditing(null);
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
    this._scrollX = 0;
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
    // Map the column through the scrolled edit line, as jsmdcui does; the
    // prompt (" > " / "cmd> ") switches modes, the text moves the cursor.
    const prefix = this.prompt;
    const total = prefix + this.text;
    const { start, lead } = this._editView(cols);
    const index = visualColToCharIdx(total, start, Math.max(0, col - 1 - lead));
    if (index < prefix.length) {
      this.toggleMode();
      return;
    }
    this.cursor = [...total.slice(prefix.length, index)].length;
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

    // Left arrow (Ctrl+Left too, as in jsmdcui) → deselect and move to start
    if (LEFT_KEYS.has(str)) {
      if (this.selectAll) { this.cursor = 0; this._deselect(); }
      else if (this.cursor > 0) this.cursor--;
      this.render();
      return true;
    }

    // Right arrow (Ctrl+Right too) → deselect and move to end
    if (RIGHT_KEYS.has(str)) {
      if (this.selectAll) { this._deselect(); }
      else if (this.cursor < [...this.text].length) this.cursor++;
      this.render();
      return true;
    }

    // Home
    if (HOME_KEYS.has(str)) {
      this._deselect();
      this.cursor = 0;
      this.render();
      return true;
    }

    // End
    if (END_KEYS.has(str)) {
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
