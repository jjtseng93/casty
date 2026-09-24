import test from 'node:test';
import assert from 'node:assert/strict';
import { UrlBar } from '../lib/urlbar.js';

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
