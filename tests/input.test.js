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

test('Ctrl+Alt arrows and Alt+Tab are distinct from plain and Alt-only keys', () => {
  for(const [suffix,key] of [['A','ArrowUp'],['B','ArrowDown'],['C','ArrowRight'],['D','ArrowLeft']]){
    expect(parseInput('\x1b[1;7'+suffix)).toMatchObject({key,modifiers:3});
    expect(parseInput('\x1b[1;3'+suffix)).toMatchObject({key,modifiers:1});
    expect(parseInput('\x1b['+suffix)).toMatchObject({key,modifiers:0});
  }
  expect(parseInput('\x1b\t')).toMatchObject({key:'Tab',code:'Tab',modifiers:1});
  expect(parseInput('\t')).toMatchObject({key:'Tab',code:'Tab',modifiers:0});
});

test('Tab modifier reports preserve all eight Ctrl/Alt/Shift combinations', () => {
  const masks=[0,8,1,9,2,10,3,11];
  for(let i=0;i<masks.length;i++){
    for(const sequence of [`\x1b[9;${i+1}u`,`\x1b[27;${i+1};9~`])
      expect(parseInput(sequence)).toMatchObject({key:'Tab',code:'Tab',modifiers:masks[i]});
  }
  expect(parseInput('\x1b[Z')).toMatchObject({key:'Tab',modifiers:8});
  expect(parseInput('\x1b\x1b[Z')).toMatchObject({key:'Tab',modifiers:9});
  expect(parseInput('\x1b[1;6Z')).toMatchObject({key:'Tab',modifiers:10});
  expect(parseInput('\x1b[9u')).toMatchObject({key:'Tab',modifiers:0});
});

test('SGR wheel directions preserve both axes and all modifier combinations', async () => {
  const {mouseWheelEvent} = await import('../lib/input.js');
  const deltas = [[0,-100],[0,100],[-100,0],[100,0]];
  for(let direction=0;direction<4;direction++)for(let bits=0;bits<8;bits++){
    const code=64+direction+(bits<<2);
    expect(mouseWheelEvent(code,12,34)).toEqual({type:'mouseWheel',x:12,y:34,
      deltaX:deltas[direction][0],deltaY:deltas[direction][1],
      modifiers:(bits&1?8:0)|(bits&2?1:0)|(bits&4?2:0)});
    expect(mouseWheelEvent(code,12,34,true)).toBeNull();
  }
  for(const code of [0,32,35,128,192])expect(mouseWheelEvent(code,1,2)).toBeNull();
});
