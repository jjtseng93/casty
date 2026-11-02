import {test,expect} from 'bun:test';
import {UrlBar,PromptHistory} from '../lib/urlbar.js';
import {syncNativeSelection,nativeSelection} from '../lib/win32-selection.js';
const editor=()=>{const b=new UrlBar({history:new PromptHistory(null)});b.native=true;b.render=()=>{};b.startEditing({text:'ab中😀cd'});return b;};

test('sorted native replies preserve consecutive Shift-Left and Shift-Right direction',()=>{
 const b=editor();
 for(const text of ['d','cd','😀cd']){
  b.handleInput('\x1b[1;2D');
  const [anchor,caret]=nativeSelection(b);
  expect(caret).toBeLessThan(anchor);
  syncNativeSelection(b,b.text,caret,anchor,true);
  expect(b.selectedText).toBe(text);
 }
 b.handleInput('\x1b[1;2C');expect(b.selectedText).toBe('cd');
 b.handleInput('\x1b[D');expect(b.cursor).toBe(4);expect(b.selectionRange).toBe(null);
});

test('mouse selection direction controls collapse and replacement at Unicode boundaries',()=>{
 const b=editor();
 syncNativeSelection(b,b.text,2,5,true);
 expect(b.cursor).toBe(2);expect(b.selectionAnchor).toBe(4);
 expect(nativeSelection(b)).toEqual([5,2]);
 b.handleInput('\x1b[1;2D');expect(b.selectedText).toBe('b中😀');
 b.insertText('貼上');expect(b.text).toBe('a貼上cd');
 syncNativeSelection(b,b.text,1,3,false);expect(b.cursor).toBe(3);
 b.handleInput('\x1b[C');expect(b.cursor).toBe(3);expect(b.selectedText).toBe('');
});

test('unavailable caret geometry retains a known direction and long offsets are not truncated',()=>{
 const b=editor();b.handleInput('\x1b[1;2D');
 syncNativeSelection(b,b.text,7,8);expect(b.cursor).toBe(6);
 const text='x'.repeat(70000)+'😀end';
 syncNativeSelection(b,text,70000,70002,true);
 expect(b.cursor).toBe(70000);expect(b.selectedText).toBe('😀');
 expect(nativeSelection(b)).toEqual([70002,70000]);
});
