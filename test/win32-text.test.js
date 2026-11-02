import {test,expect} from 'bun:test';
import {Win32TextInput} from '../lib/win32-text.js';
const a={key:'a',code:'KeyA',keyCode:65,modifiers:0},scan=0x1en<<16n;
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
