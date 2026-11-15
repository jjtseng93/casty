import {test,expect} from 'bun:test';
import {Win32TextInput} from '../lib/win32-text.js';
import {win32Key} from '../lib/win32-key.js';
const a={key:'a',code:'KeyA',keyCode:65,modifiers:0},scan=0x1en<<16n;
test('IME-processed Space restores its physical key only after a literal WM_CHAR',()=>{
 const input=new Win32TextInput(),space=win32Key(32,0x00390001n,0);
 input.processKey(space);
 expect(input.recoverSpace(' ')).toBe(space);
 expect(input.recoverSpace(' ')).toBe(null);
 input.processKey(space);expect(input.recoverSpace('x')).toBe(null);
 input.processKey(win32Key(32,0x001e0001n,0));expect(input.recoverSpace(' ')).toBe(null);
 input.processKey({...space,modifiers:2});expect(input.recoverSpace(' ')).toBe(null);
});

test('IME composition, focus loss, release and another key discard processed Space',()=>{
 const input=new Win32TextInput(),space=win32Key(32,0x00390001n,0);
 input.processKey(space);input.composition(true);input.compositionUpdate(0x8);input.composition(false);
 expect(input.recoverSpace(' ')).toBe(null);
 input.composition(true);input.processKey(space);expect(input.recoverSpace(' ')).toBe(null);
 input.composition(false);input.processKey(space);input.reset();expect(input.recoverSpace(' ')).toBe(null);
 input.processKey(space);input.up(space);expect(input.recoverSpace(' ')).toBe(null);
 input.processKey(space);input.down(a,scan);expect(input.recoverSpace(' ')).toBe(null);
});

test('result-only Space survives the Windows IME start/result/end sequence',()=>{
 const input=new Win32TextInput(),space=win32Key(32,0x00390001n,0);
 input.processKey(space);input.composition(true);input.reset(true);
 input.compositionUpdate(0x800);input.composition(false);
 expect(input.recoverSpace(' ')).toBe(space);
 input.up(space);expect(input.recoverSpace(' ')).toBe(null);
 input.processKey(space);input.composition(true);input.reset(true);
 input.compositionUpdate(0x800);input.composition(false);
 expect(input.recoverSpace('x')).toBe(null);
});
test('WM_CHAR completes the physical key once while IME commits remain independent',()=>{
 const input=new Win32TextInput();input.down(a,scan);
 expect(input.character('a',scan)).toBe(a);
 expect(input.character('a',scan)).toBe(null);
 input.down(a,scan);input.composition(true);
 input.down(a,scan);expect(input.character('中',scan)).toBe(null);
 input.composition(false);expect(input.character('文',0n)).toBe(null);
 input.down(a,scan);expect(input.character('a',scan)).toBe(a);
});
test('dead keys, changed layout text and focus resets never reuse a physical character',()=>{
 const input=new Win32TextInput();input.down(a,scan);
 expect(input.character('á',scan)).toBe(null);
 input.down({...a,key:'Dead'},scan);expect(input.character('á',scan)).toBe(null);
 input.down(a,scan);input.reset();expect(input.character('a',scan)).toBe(null);
});

test('VK_PROCESSKEY release balances only a recovered Space and clears stale candidates',()=>{
 const input=new Win32TextInput(),space=win32Key(32,0x00390001n,0);
 input.processKey(space);expect(input.releaseProcessed(space)).toBe(null);
 expect(input.recoverSpace(' ')).toBe(null);
 input.processKey(space);input.recoverSpace(' ');
 expect(input.releaseProcessed(a)).toBe(null);
 expect(input.releaseProcessed(space)).toEqual({...space,eventType:3});
 expect(input.releaseProcessed(space)).toBe(null);
 input.processKey(space);input.recoverSpace(' ');input.up(space);
 expect(input.releaseProcessed(space)).toBe(null);
 input.processKey(space);input.recoverSpace(' ');input.reset();
 expect(input.releaseProcessed(space)).toBe(null);
});
