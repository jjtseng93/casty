import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, parseCommand, parseZoom, helpText } from '../lib/commands.js';

test('parseCommand resolves names and aliases case-insensitively, keeping the argument', () => {
  assert.deepEqual(parseCommand('zoom 1.5'), { name: 'zoom', arg: '1.5' });
  assert.deepEqual(parseCommand('  O  example.com/a b '), { name: 'open', arg: 'example.com/a b' });
  assert.deepEqual(parseCommand('q'), { name: 'quit', arg: '' });
  assert.deepEqual(parseCommand('yank'), { name: 'copyurl', arg: '' });
  assert.deepEqual(parseCommand('/Hello world'), { name: 'find', arg: 'Hello world' });
  assert.deepEqual(parseCommand('find'), { name: 'find', arg: '' });
  assert.deepEqual(parseCommand('pu'), { name: 'pasteurl', arg: '' });
  assert.match(parseCommand('frobnicate').error, /Unknown command: frobnicate/);
  assert.match(parseCommand('   ').error, /Empty/);
});

test('command names and aliases are unique', () => {
  const names = COMMANDS.flatMap(c => [c.name, ...c.aliases]);
  assert.equal(new Set(names).size, names.length);
  for (const c of COMMANDS) assert.ok(helpText().includes(c.usage));
});

test('parseZoom takes factors, percentages, steps and reset, clamped', () => {
  assert.equal(parseZoom('1.5'), 1.5);
  assert.equal(parseZoom('150%'), 1.5);
  assert.equal(parseZoom('.5'), 0.5);
  assert.equal(parseZoom('+', 1), 1.1);
  assert.equal(parseZoom('-', 1), 0.9);
  assert.equal(parseZoom('+', 1.2), 1.25);
  assert.equal(parseZoom('in', 5), 5);
  assert.equal(parseZoom('out', 0.25), 0.25);
  assert.equal(parseZoom('reset', 3), 1);
  assert.equal(parseZoom('100'), 5);
  assert.equal(parseZoom('abc'), null);
});
