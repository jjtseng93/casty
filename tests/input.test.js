import { test, expect } from 'bun:test';
import { parseInput } from '../lib/input.js';
import { toKeyName } from '../lib/keys.js';

test('legacy Alt and Ctrl+Alt letters remain distinct', () => {
  const alt = parseInput('\x1bw');
  const ctrlAlt = parseInput('\x1b\x17');
  expect(alt).toMatchObject({key:'w',code:'KeyW',modifiers:1});
  expect(ctrlAlt).toMatchObject({key:'w',code:'KeyW',keyCode:87,modifiers:3});
  expect(toKeyName(alt)).toBe('alt+w');
  expect(toKeyName(ctrlAlt)).toBe('ctrl+alt+w');
  expect(parseInput('\x17')).toMatchObject({key:'w',modifiers:2});
  expect(parseInput('\x1b\x03')).toMatchObject({key:'c',code:'KeyC',modifiers:3});
});

test('ambiguous control bytes preserve Alt+special key meanings', () => {
  for (const [byte,key] of [['\t','Tab'],['\r','Enter'],['\n','Enter'],['\x08','Backspace'],['\x7f','Backspace']]) {
    expect(parseInput('\x1b'+byte)).toMatchObject({key,modifiers:1});
    expect(parseInput(byte)).toMatchObject({key,modifiers:0});
  }
  expect(parseInput('\x1b[1;7D')).toMatchObject({key:'ArrowLeft',modifiers:3});
});
