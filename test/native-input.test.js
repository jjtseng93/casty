import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {startInputHandling} from '../lib/input.js';
import {UrlBar,PromptHistory} from '../lib/urlbar.js';
import {runWin32} from '../lib/win32.js';

function fixture(options={}){
 const calls=[],client=new EventEmitter();
 client.send=async(method,params)=>{calls.push({method,params});await options.beforeReply?.(method,params);if(method==='Page.getNavigationHistory')return {currentIndex:0,entries:[{id:1,url:'https://example.com'}]};return {};};
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

test('browser modal input bypasses the page event waiting for its answer without editing the address bar',async()=>{
 const client=new EventEmitter();let release,done=false;
 client.send=async(method,p)=>{
  if(method==='Input.dispatchKeyEvent'&&p.type==='rawKeyDown') {
   if(p.key==='a'){client.emit('Page.javascriptDialogOpening',{type:'alert',message:'3'});await new Promise(resolve=>release=resolve);done=true;}
   if(p.key==='Enter'){client.emit('Page.javascriptDialogClosed',{result:true});release();}
  }return {};
 };
 const bar=new UrlBar({history:new PromptHistory(null)});bar.native=true;bar.render=()=>{};
 const controller=startInputHandling(client,1,1,1,{},()=>{},null,{}, {native:{urlBar:bar,quit(){}}});
 try{
  const pending=controller.dispatchNative('',{key:'a',code:'KeyA',keyCode:65,modifiers:0,eventType:1});
  await Bun.sleep(5);expect(done).toBe(false);expect(bar.editing).toBe(false);
  await controller.dispatchNative('',{key:'Enter',code:'Enter',keyCode:13,modifiers:0,eventType:1});
  await pending;expect(done).toBe(true);
 }finally{controller.dispose();}
});

test('mouse down is immediate, touch slop does not duplicate down, and multi-click counts survive',async()=>{
 const f=fixture();const mouse=()=>f.calls.filter(c=>c.method==='Input.dispatchMouseEvent').map(c=>c.params);
 try{
  await f.controller.dispatchNative('\x1b[<0;20;20M');
  expect(mouse().map(p=>p.type)).toEqual(['mousePressed']);
  await f.controller.dispatchNative('\x1b[<32;21;20M'); // retained touch slop
  expect(mouse().map(p=>p.type)).toEqual(['mousePressed']);
  await f.controller.dispatchNative('\x1b[<0;21;20m');
  expect(mouse().map(p=>p.type)).toEqual(['mousePressed','mouseReleased']);
  expect(mouse()[1].x).toBe(mouse()[0].x);
  await f.controller.dispatchNative('\x1b[<0;20;20M');
  expect(mouse().at(-1).clickCount).toBe(2);
  await f.controller.dispatchNative('\x1b[<32;40;40M');
  expect(mouse().filter(p=>p.type==='mousePressed')).toHaveLength(2);
  expect(mouse().at(-1).type).toBe('mouseMoved');
  await f.controller.dispatchNative('\x1b[<0;40;40m');
  expect(mouse().at(-1).type).toBe('mouseReleased');
  const marker=f.calls.findIndex(c=>c.method==='Runtime.evaluate'&&c.params.expression?.includes('__casty_click_marker'));
  const release=f.calls.findIndex(c=>c.method==='Input.dispatchMouseEvent'&&c.params.type==='mouseReleased');
  expect(marker).toBeGreaterThan(release);
 }finally{f.controller.dispose();}
});


test('double click uses arrival times even when the first CDP reply stalls',async()=>{
 let unblock,started;
 const entered=new Promise(resolve=>started=resolve);
 let first=true;
 const f=fixture({beforeReply:async(method,params)=>{
  if(first&&method==='Input.dispatchMouseEvent'&&params.type==='mousePressed'){
   first=false;started();await new Promise(resolve=>unblock=resolve);
  }
 }});
 try{
  const down=f.controller.dispatchNative('\x1b[<0;20;20M');
  await entered;
  const rest=[
   f.controller.dispatchNative('\x1b[<0;20;20m'),
   f.controller.dispatchNative('\x1b[<0;20;20M'),
   f.controller.dispatchNative('\x1b[<0;20;20m'),
  ];
  await Bun.sleep(450);unblock();
  await Promise.all([down,...rest]);
  const mouse=f.calls.filter(c=>c.method==='Input.dispatchMouseEvent');
  expect(mouse.map(c=>c.params.clickCount)).toEqual([1,1,2,2]);
 }finally{unblock?.();f.controller.dispose();}
});

test('double tap tolerates one terminal cell of finger drift independently of page zoom',async()=>{
 const f=fixture();
 try{
  f.controller.updateCellSize(12,24,0.5);
  for(const report of ['\x1b[<0;20;20M','\x1b[<0;20;20m','\x1b[<0;21;21M','\x1b[<0;21;21m'])
   await f.controller.dispatchNative(report);
  let presses=f.calls.filter(c=>c.method==='Input.dispatchMouseEvent'&&c.params.type==='mousePressed');
  expect(presses.map(c=>c.params.clickCount)).toEqual([1,2]);
  await f.controller.dispatchNative('\x1b[<0;25;25M');
  presses=f.calls.filter(c=>c.method==='Input.dispatchMouseEvent'&&c.params.type==='mousePressed');
  expect(presses.at(-1).params.clickCount).toBe(1);
 }finally{f.controller.dispose();}
});
