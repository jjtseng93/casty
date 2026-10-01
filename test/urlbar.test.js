import test from 'node:test';
import assert from 'node:assert/strict';
import { toURL, UrlBar, PromptHistory } from '../lib/urlbar.js';

test('toURL gives local CLI addresses an HTTP scheme', () => {
  assert.equal(toURL('localhost:3000'), 'http://localhost:3000');
  assert.equal(toURL('localhost/app'), 'http://localhost/app');
  assert.equal(toURL('127.0.0.1:8080/path'), 'http://127.0.0.1:8080/path');
  assert.equal(toURL('[::1]:9000'), 'http://[::1]:9000');
});

test('toURL preserves schemes and defaults public hosts to HTTPS', () => {
  assert.equal(toURL('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(toURL('https://example.com'), 'https://example.com');
  assert.equal(toURL('file:///tmp/page.html'), 'file:///tmp/page.html');
  assert.equal(toURL('example.com/path'), 'https://example.com/path');
});

function editingBar(text, cursor) {
  const bar = new UrlBar({ history: new PromptHistory(null) });
  bar.editing = true;
  bar.text = text;
  bar.cursor = cursor;
  bar.render = () => {};
  return bar;
}

test('Ctrl-U toggles the text before the cursor', () => {
  const bar = editingBar('headtail', 4);
  bar.handleInput('\x15');
  assert.deepEqual({ text: bar.text, cursor: bar.cursor }, { text: 'tail', cursor: 0 });
  bar.handleInput('\x15');
  assert.deepEqual({ text: bar.text, cursor: bar.cursor }, { text: 'headtail', cursor: 4 });
});

test('Ctrl-K toggles the text after the cursor', () => {
  const bar = editingBar('headtail', 4);
  bar.handleInput('\x0b');
  assert.deepEqual({ text: bar.text, cursor: bar.cursor }, { text: 'head', cursor: 4 });
  bar.handleInput('\x0b');
  assert.deepEqual({ text: bar.text, cursor: bar.cursor }, { text: 'headtail', cursor: 4 });
});

test('Ctrl-U and Ctrl-K keep independent saved text', () => {
  const bar = editingBar('🍎headtail', 5);
  bar.handleInput('\x15');
  bar.cursor = 2;
  bar.handleInput('\x0b');
  assert.equal(bar.text, 'ta');

  bar.cursor = 0;
  bar.handleInput('\x15');
  assert.equal(bar.text, '🍎headta');

  bar.cursor = [...bar.text].length;
  bar.handleInput('\x0b');
  assert.equal(bar.text, '🍎headtail');
});

function newBar() {
  const bar = new UrlBar({ history: new PromptHistory(null) });
  bar.render = () => {};
  return bar;
}

test('command mode starts empty with a cmd> prompt and resolves the raw line', async () => {
  const bar = newBar();
  bar.currentUrl = 'https://example.com';
  const result = bar.startEditing({ command: true });
  assert.equal(bar.prompt, 'cmd> ');
  assert.equal(bar.text, '');
  for (const ch of 'zoom 2') bar.handleInput(ch);
  bar.handleInput('\r');
  assert.deepEqual(await result, { mode: 'cmd', line: 'zoom 2' });
  assert.equal(bar.editing, false);
});

test('Esc cancels either mode', async () => {
  const bar = newBar();
  const command = bar.startEditing({ command: true });
  bar.handleInput('r');
  bar.handleInput('\x1b');
  assert.equal(await command, null);
  const address = bar.startEditing();
  assert.equal(bar.prompt, ' > ');
  bar.handleInput('\x1b');
  assert.equal(await address, null);
});

test('clicking the prompt switches modes and keeps the text', async () => {
  const bar = newBar();
  bar.currentUrl = 'example.com';
  const result = bar.startEditing();
  bar.handleClick(2, 1000);
  assert.equal(bar.mode, 'cmd');
  assert.equal(bar.text, 'example.com');
  bar.handleClick(1, 5000);
  assert.equal(bar.mode, 'url');
  bar.handleClick(3, 9000);
  bar.handleInput('\r');
  assert.deepEqual(await result, { mode: 'cmd', line: 'example.com' });
});

test('clicking the text moves the cursor', () => {
  const bar = newBar();
  bar.currentUrl = 'abcdef';
  bar.startEditing({ command: false });
  bar.handleClick(3 + 3, 1000); // prompt " > " is 3 columns; column 6 is on "c"
  assert.equal(bar.cursor, 2);
  assert.equal(bar.selectAll, false);
});

test('Up/Down walk this mode\'s history and bring back the unfinished line', async () => {
  const history = new PromptHistory(null);
  const bar = new UrlBar({ history });
  bar.render = () => {};
  for (const line of ['zoom 2', 'reload', 'zoom 2']) {
    const done = bar.startEditing({ command: true });
    for (const ch of line) bar.handleInput(ch);
    bar.handleInput('\r');
    await done;
  }
  assert.deepEqual(history.list('cmd'), ['reload', 'zoom 2']);
  assert.deepEqual(history.list('url'), []);
  bar.startEditing({ command: true });
  bar.handleInput('h');
  bar.handleInput('\x1b[A');
  assert.equal(bar.text, 'zoom 2');
  bar.handleInput('\x1b[A');
  assert.equal(bar.text, 'reload');
  bar.handleInput('\x1b[A');
  assert.equal(bar.text, 'reload');
  bar.handleInput('\x1b[B');
  bar.handleInput('\x1b[B');
  assert.equal(bar.text, 'h');
});

test('double clicks: left third = next entry, middle = previous, right = Enter', async () => {
  const history = new PromptHistory(null);
  history.add('cmd', 'one');
  history.add('cmd', 'two');
  const bar = new UrlBar({ history });
  bar.render = () => {};
  const cols = process.stdout.columns || 80;
  const middle = Math.floor(cols / 2);
  const result = bar.startEditing({ command: true });
  bar.handleClick(middle, 1000);
  bar.handleClick(middle, 1200);
  assert.equal(bar.text, 'two');
  bar.handleClick(middle, 2000);
  bar.handleClick(middle, 2100);
  assert.equal(bar.text, 'one');
  bar.handleClick(10, 3000);
  bar.handleClick(10, 3100);
  assert.equal(bar.text, 'two');
  bar.handleClick(cols, 4000);
  bar.handleClick(cols, 4100);
  assert.deepEqual(await result, { mode: 'cmd', line: 'two' });
});

test('PromptHistory persists per mode, without duplicates', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'casty-history-')), 'sub', 'history.json');
  const history = new PromptHistory(file);
  history.add('url', 'a.com');
  history.add('cmd', 'zoom 2');
  history.add('url', 'b.com');
  history.add('url', 'a.com');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { url: ['b.com', 'a.com'], cmd: ['zoom 2'] });
  assert.deepEqual(new PromptHistory(file).list('url'), ['b.com', 'a.com']);
});

test('startEditing with text starts from it, unselected, for editing or Enter', async () => {
  const bar = newBar();
  bar.currentUrl = 'https://old.example';
  const result = bar.startEditing({ text: 'example.com/pasted' });
  assert.equal(bar.mode, 'url');
  assert.equal(bar.text, 'example.com/pasted');
  assert.equal(bar.selectAll, false);
  assert.equal(bar.cursor, [...'example.com/pasted'].length);
  bar.handleInput('x');
  bar.handleInput('\r');
  assert.deepEqual(await result, { mode: 'url', url: 'https://example.com/pastedx' });
});

// The rendered edit line with a fixed width: what is visible, and where the cursor is.
function view(bar, cols) {
  const line = bar._editLine(cols).replace(/\x1b\[[0-9;]*m/g, '');
  return { line, cursorCol: bar._editView(cols).cursorCol };
}

test('a long line scrolls with the cursor, and Home/End bring back either end', () => {
  const bar = newBar();
  const url = 'https://example.com/' + 'a'.repeat(40) + 'END';
  bar.currentUrl = url;
  bar.startEditing({ command: false });
  // At the end: the tail is visible and the cursor is on the last column.
  let shown = view(bar, 20);
  assert.equal(shown.line.trimEnd().endsWith('END'), true);
  assert.equal(shown.cursorCol, 19);
  // Home (every terminal's sequence) scrolls back to the prompt and the start.
  for (const home of ['\x1b[H', '\x1bOH', '\x1b[1~', '\x1b[7~']) {
    bar.cursor = [...url].length;
    view(bar, 20);
    bar.handleInput(home);
    shown = view(bar, 20);
    assert.equal(shown.line, 'https://example.com/');
    assert.equal(shown.cursorCol, 0);
  }
  for (const end of ['\x1b[F', '\x1bOF', '\x1b[4~', '\x1b[8~']) {
    bar.cursor = 0;
    view(bar, 20);
    bar.handleInput(end);
    assert.equal(view(bar, 20).line.trimEnd().endsWith('END'), true);
  }
});

test('the line only scrolls as far as the cursor needs, and counts wide characters as two columns', () => {
  const bar = newBar();
  bar.startEditing({ command: true });
  bar.handleInput('一二三四五六七八九十');
  // "cmd> " (5) + 10 wide characters (20) = 25 columns; the cursor stays on screen.
  let shown = view(bar, 16);
  assert.equal(shown.cursorCol, 15);
  // Scrolled by 10 columns: "三" (columns 9-10) is cut in half, so a blank
  // column takes its place and the cursor sits right after "十".
  assert.equal(shown.line, ' 四五六七八九十 ');
  // Moving left inside the visible part does not scroll.
  bar.handleInput('\x1b[D');
  assert.equal(view(bar, 16).line, shown.line);
  assert.equal(view(bar, 16).cursorCol, 13);
});

test('clicking a scrolled line maps the column to the visible character', () => {
  const bar = newBar();
  const url = 'https://example.com/' + 'x'.repeat(30) + 'TAIL';
  bar.currentUrl = url;
  bar.startEditing({ command: false });
  const cols = process.stdout.columns || 80;
  if (cols >= url.length + 4) return; // The line does not scroll on this wide a terminal.
  view(bar, cols);
  // The last visible text column is the end of the URL.
  bar.handleClick(cols, 5000);
  assert.equal(bar.cursor, [...url].length - 1);
});
