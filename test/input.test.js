import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchClick, showClickMarker } from '../lib/click.js';
import { cellToPixel } from '../lib/input.js';

test('cellToPixel aims at the cell centre in Chrome CSS pixels', () => {
  assert.deepEqual(cellToPixel(1, 2, 10, 20, 1.25), { x: 4, y: 8 });
  assert.deepEqual(cellToPixel(11, 12, 10, 20, 1.25), { x: 84, y: 168 });
});

// Input coordinates must stay in CSS pixels: scaling them by the zoom only
// appeared to work while clicks raced Page.captureScreenshot (see README,
// Implementation Notes).
test('dispatchClick sends a matched pressed/released pair in CSS pixels', async () => {
  const calls = [];
  const client = {
    async send(method, params) { calls.push({ method, params }); },
  };

  await dispatchClick(client, 12.5, 34.5, { clickCount: 2 });

  assert.equal(calls[0].method, 'Runtime.evaluate');
  assert.match(calls[0].params.expression, /left:12\.5px/);
  assert.match(calls[0].params.expression, /top:34\.5px/);
  assert.deepEqual(calls.slice(1), [
    {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed', x: 12.5, y: 34.5,
        button: 'left', clickCount: 2, buttons: 1,
      },
    },
    {
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseReleased', x: 12.5, y: 34.5,
        button: 'left', clickCount: 2, buttons: 0,
      },
    },
  ]);
});

test('dispatchClick sends the right button with its buttons bitmask', async () => {
  const calls = [];
  const client = {
    async send(method, params) { calls.push({ method, params }); },
  };

  await dispatchClick(client, 12.5, 34.5, { button: 'right' });

  assert.deepEqual(calls.slice(1).map(c => c.params), [
    { type: 'mousePressed', x: 12.5, y: 34.5, button: 'right', clickCount: 1, buttons: 2 },
    { type: 'mouseReleased', x: 12.5, y: 34.5, button: 'right', clickCount: 1, buttons: 0 },
  ]);
});

test('showClickMarker creates a non-interactive temporary marker', async () => {
  const calls = [];
  await showClickMarker({
    async send(method, params) { calls.push({ method, params }); },
  }, 20, 30, 450);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Runtime.evaluate');
  assert.match(calls[0].params.expression, /pointer-events:none/);
  assert.match(calls[0].params.expression, /setTimeout\(\(\) => marker\.remove\(\), 450\)/);
});
