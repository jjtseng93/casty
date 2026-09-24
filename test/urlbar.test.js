import test from 'node:test';
import assert from 'node:assert/strict';
import { toURL, UrlBar } from '../lib/urlbar.js';

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
  const bar = new UrlBar();
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
