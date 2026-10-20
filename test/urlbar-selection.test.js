import {test,expect} from 'bun:test';
import {UrlBar,PromptHistory} from '../lib/urlbar.js';
import {parseKittyKey,localKeyText} from '../lib/keyboard-protocol.js';
function bar(text){const b=new UrlBar({history:new PromptHistory(null)});b.render=()=>{};b.editing=true;b.text=text;b.cursor=[...text].length;return b;}

test('Shift arrows extend, shrink, reverse and collapse a partial Unicode selection',()=>{
 const b=bar('ab中😀cd');b.cursor=2;
 b.handleInput('\x1b[1;2C');b.handleInput('\x1b[1;2C');expect(b.selectedText).toBe('中😀');
 expect(b._editLine(40)).toContain('\x1b[7m中😀\x1b[27m');
 b.handleInput('\x1b[1;2D');expect(b.selectedText).toBe('中');
 b.handleInput('\x1b[1;2D');expect(b.selectedText).toBe('');
 b.handleInput('\x1b[1;2D');expect(b.selectedText).toBe('b');
 b.handleInput('\x1b[C');expect(b.cursor).toBe(2);expect(b.selectedText).toBe('');
 b.handleInput(localKeyText(parseKittyKey('\x1b[1;2D')));expect(b.selectedText).toBe('b');
 b.handleInput('\x1b[1;2H');expect(b.selectedText).toBe('ab');
 b.handleInput('\x1b[1;2F');expect(b.selectedText).toBe('中😀cd');
});

test('paste inserts at cursor, or replaces only the selected range; deletion and typing match',()=>{
 const b=bar('abcdef');b.cursor=2;b.insertText('中');expect(b.text).toBe('ab中cdef');
 b.handleInput('\x1b[1;2C');b.handleInput('\x1b[1;2C');expect(b.selectedText).toBe('cd');
 b.insertText('😀');expect(b.text).toBe('ab中😀ef');expect(b.cursor).toBe(4);
 expect(b.selectedText).toBe('');b.handleInput('\x1b[1;2D');b.handleInput('\x7f');expect(b.text).toBe('ab中ef');
 b.handleInput('\x1b[1;2C');b.handleInput('X');expect(b.text).toBe('ab中Xf');
 b.handleInput('\x01');b.insertText('all');expect(b.text).toBe('all');
});

test('mouse dragging selects forward and backward without running double-click actions',()=>{
 const b=bar('ab中😀cd');b.cursor=0;
 b.pointerDown(6,1000);b.pointerMove(10);b.pointerUp();expect(b.selectedText).toBe('中😀');
 b.pointerDown(10,1100);b.pointerMove(6);b.pointerUp();expect(b.selectedText).toBe('中😀');
 expect(b.text).toBe('ab中😀cd');expect(b.editing).toBe(true);
 b.pointerDown(4,1200);b.pointerMove(5);b.pointerUp();expect(b.selectedText).toBe('a');
});

test('opening click preserves select-all while its drag can select a smaller range',()=>{
 const b=bar('abcdef');b.selectAll=true;b.armDrag(5);b.pointerUp();expect(b.selectAll).toBe(true);
 b.armDrag(5);b.pointerMove(7);b.pointerUp();expect(b.selectedText).toBe('bc');
});

test('drag mapping and highlight track horizontal scrolling without splitting surrogate pairs',()=>{
 const old=Object.getOwnPropertyDescriptor(process.stdout,'columns');
 Object.defineProperty(process.stdout,'columns',{value:12,configurable:true});
 try {
   const b=bar('abcdefghijklmnop中😀');b._editView(12);
   b.pointerDown(4,1000);const start=b.cursor;b.pointerMove(7);b.pointerUp();
   expect(b.selectedText).toBe([...b.text].slice(start,b.cursor).join(''));
   expect(b.selectedText.length).toBeGreaterThan(0);expect(b._editLine(12)).toContain('\x1b[7m');
 }finally{if(old)Object.defineProperty(process.stdout,'columns',old);else delete process.stdout.columns;}
});

test('selection hides the block cursor at the exclusive end and restores it when collapsed',()=>{
 const b=bar('ab中cd');b.render=UrlBar.prototype.render;b.cursor=1;
 const write=process.stdout.write;let output='';
 process.stdout.write=chunk=>{output+=String(chunk);return true;};
 const step=(key,selected,visible)=>{
   output='';b.handleInput(key);
   expect(b.selectedText).toBe(selected);
   expect(output.endsWith(visible?'\x1b[?25h':'\x1b[?25l')).toBe(true);
   if(!visible)expect(output).not.toContain('\x1b[?25h');
 };
 try{
   step('\x1b[1;2C','b',false);
   expect(output).toContain('\x1b[7mb\x1b[27m中');
   step('\x1b[1;2C','b中',false);
   step('\x1b[1;2D','b',false);
   step('\x1b[1;2D','',true);
   step('\x1b[1;2D','a',false);
   step('\x1b[C','',true);
   step('\x01','ab中cd',false);
   step('X','',true);
 }finally{process.stdout.write=write;}
});
