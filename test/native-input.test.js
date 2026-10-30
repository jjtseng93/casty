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

test('native character input does not synthesize a second Space key or reinterpret Unicode',async()=>{
 const f=fixture();try{
  const space={key:' ',code:'Space',keyCode:32,modifiers:0,eventType:1};
  await f.controller.dispatchNative('',space);
  await f.controller.dispatchNativeText(' ');
  await f.controller.dispatchNative('',{...space,eventType:3});
  await f.controller.dispatchNativeText('π😀');
  const keys=f.calls.filter(c=>c.method==='Input.dispatchKeyEvent');
  expect(keys.map(c=>c.params.type)).toEqual(['rawKeyDown','keyUp']);
  expect(keys.map(c=>c.params.code)).toEqual(['Space','Space']);
  expect(f.calls.filter(c=>c.method==='Input.insertText').map(c=>c.params.text)).toEqual([' ','π😀']);
 }finally{f.controller.dispose();}
});

test('native copy failures propagate instead of showing a false success',async()=>{
 const client=new EventEmitter();client.send=async()=>({result:{value:'selected'}});
 const bar=new UrlBar({history:new PromptHistory(null)});bar.native=true;bar.render=()=>{};
 const controller=startInputHandling(client,1,1,1,{},()=>{},null,{}, {native:{urlBar:bar,quit(){},
  clipboardWrite:async()=>{throw Error('clipboard unavailable');}}});
 try{
  await expect(controller.execAction('copy')).rejects.toThrow('clipboard unavailable');
  expect(bar._status||'').not.toContain('Copied');
 }finally{controller.dispose();}
});

test('native deactivation releases held input and permits subsequent presses',async()=>{
 const f=fixture({noShortcuts:true});
 try {
  await f.key('a',0);
  await f.controller.dispatchNative('\x1b[<0;20;20M');
  await f.controller.dispatchNative('\x1b[<32;40;40M');
  await f.controller.releaseNativeInput();
  const keys=f.calls.filter(c=>c.method==='Input.dispatchKeyEvent');
  expect(keys.map(c=>c.params.type)).toEqual(['rawKeyDown','keyUp']);
  const mouse=f.calls.filter(c=>c.method==='Input.dispatchMouseEvent');
  expect(mouse.some(c=>c.params.type==='mousePressed')).toBe(true);
  expect(mouse.at(-1).params).toMatchObject({type:'mouseReleased',buttons:0,modifiers:0});
  await f.controller.releaseNativeInput();
  expect(f.calls.filter(c=>c.method==='Input.dispatchKeyEvent')).toHaveLength(2);
  await f.key('a',0);
  expect(f.calls.filter(c=>c.method==='Input.dispatchKeyEvent').at(-1).params.type).toBe('rawKeyDown');
 }finally{f.controller.dispose();}
});
