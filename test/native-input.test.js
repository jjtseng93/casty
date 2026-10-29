import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {startInputHandling} from '../lib/input.js';
import {UrlBar,PromptHistory} from '../lib/urlbar.js';
import {runWin32} from '../lib/win32.js';

function fixture(options={}){
 const calls=[],client=new EventEmitter();
 client.send=async(method,params)=>{calls.push({method,params});if(method==='Page.getNavigationHistory')return {currentIndex:0,entries:[{id:1,url:'https://example.com'}]};return {};};
 const bar=new UrlBar({history:new PromptHistory(null),commandEntry:options.noShortcuts});bar.native=true;bar.render=()=>{};
 let quit=0,copied='';
 const controller=startInputHandling(client,1,1,1,{'ctrl+q':'quit','ctrl+e':'command','ctrl+r':'reload','ctrl+v':'paste'},()=>{},null,{},
 {...options,native:{urlBar:bar,quit:()=>quit++,clipboardWrite:text=>{copied=text;},clipboardRead:async()=> '貼上文字'}});
 const key=(letter,modifiers=2,eventType=1)=>controller.dispatchNative('',{key:letter,code:'Key'+letter.toUpperCase(),keyCode:letter.toUpperCase().charCodeAt(0),modifiers,eventType});
 return {controller,calls,bar,key,get quit(){return quit;},get copied(){return copied;}};
}
test('native adapter imports and shares custom bindings, readonly guards, clipboard and editor commands',async()=>{
 expect(typeof runWin32).toBe('function');const f=fixture({readonly:true});
 try{
  await f.key('r');expect(f.calls.some(c=>c.method==='Page.reload')).toBe(false);
  await f.controller.runCommand('readonly off');await f.key('r');expect(f.calls.some(c=>c.method==='Page.reload')).toBe(true);
  await f.key('v');expect(f.calls.some(c=>c.method==='Input.insertText'&&c.params.text==='貼上文字')).toBe(true);
  await f.key('e');expect(f.bar.mode).toBe('cmd');expect(f.bar.editing).toBe(true);
  f.bar.insertText('abc');await f.key('u');expect(f.bar.text).toBe('');await f.key('u');expect(f.bar.text).toBe('abc');
  await f.controller.dispatchNative('\t');expect(f.bar.mode).toBe('url');
  await f.key('q');expect(f.quit).toBe(1);
 }finally{f.controller.dispose();}
});
test('native no-shortcuts forwards keys while retaining local editor quit',async()=>{
 const f=fixture({noShortcuts:true});try{
  await f.key('q');await f.key('q',2,3);expect(f.quit).toBe(0);expect(f.calls.some(c=>c.method==='Input.dispatchKeyEvent'&&c.params.type==='keyUp')).toBe(true);
  await f.controller.execAction('command');await f.key('q');expect(f.quit).toBe(1);
 }finally{f.controller.dispose();}
});
