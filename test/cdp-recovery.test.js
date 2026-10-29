import {test,expect} from 'bun:test';
import {CDPClient} from '../lib/cdp.js';
import {startScreencast} from '../lib/browser.js';
import {EventEmitter} from 'node:events';

async function endpoint(run,reply){
 const messages=[];
 const server=Bun.serve({port:0,fetch(r,s){if(s.upgrade(r))return;return new Response('');},websocket:{message(ws,data){const m=JSON.parse(data);messages.push({...m,time:Date.now()});reply?.(ws,m,messages.length);}}});
 const client=new CDPClient();
 try{await client.connect(`ws://127.0.0.1:${server.port}`);await run(client,messages);}
 finally{client.close();server.stop(true);}
}
test('safe timeout retries after completion plus one second, with one pending command',async()=>{
 await endpoint(async(c,m)=>{
  await c.send('Page.getLayoutMetrics',{},30);
  expect(m).toHaveLength(3);
  expect(m[1].time-m[0].time).toBeGreaterThanOrEqual(1020);
  expect(m[2].time-m[1].time).toBeGreaterThanOrEqual(1020);
  expect(c.diagnostics().pending).toBe(0);
 },(ws,m,n)=>{if(n===3)ws.send(JSON.stringify({id:m.id,result:{}}));});
});
test('close cancels backoff; unsafe input is never replayed',async()=>{
 await endpoint(async(c,m)=>{
  await expect(c.send('Input.insertText',{text:'once'},20)).rejects.toThrow('CDP timeout');
  expect(m).toHaveLength(1);
  const p=c.send('Page.enable',{},20);
  await Bun.sleep(60);c.close();await expect(p).rejects.toThrow('Connection closed');
  await Bun.sleep(1050);expect(m).toHaveLength(2);
 });
});
test('protocol errors are not retried',async()=>{
 await endpoint(async(c,m)=>{
  await expect(c.send('Page.enable',{},20)).rejects.toThrow('unsupported');expect(m).toHaveLength(1);
 },(ws,m)=>ws.send(JSON.stringify({id:m.id,error:{message:'unsupported'}})));
});
test('stop supersedes a timed-out start and prevents a late restart',async()=>{
 await endpoint(async(c,m)=>{
  const start=c.send('Page.startScreencast',{},20);
  const result=start.catch(e=>e.message);
  await Bun.sleep(60);await c.send('Page.stopScreencast',{},20);
  expect(await result).toContain('superseded');expect(m).toHaveLength(2);
 },(ws,m)=>{if(m.method==='Page.stopScreencast')ws.send(JSON.stringify({id:m.id,result:{}}));});
});
test('ordinary capture recovers without events and ignores invalidation bursts during backoff',async()=>{
 const c=new EventEmitter();let calls=0;const frames=[];
 c.send=async method=>{if(method!=='Page.captureScreenshot')return {};if(++calls===1)throw Error('CDP timeout: Page.captureScreenshot');return {data:'ok'};};
 const stream=await startScreencast(c,{width:20,height:20,onFrame:f=>frames.push(f)});
 try{
  await Bun.sleep(20);for(let i=0;i<100;i++)c.emit('Page.screencastFrame',{sessionId:i});
  await Bun.sleep(300);expect(calls).toBe(1);
  await Bun.sleep(800);expect(calls).toBe(2);expect(frames).toEqual(['ok']);
  await Bun.sleep(100);expect(calls).toBe(2);
 }finally{stream.cleanup();}
});

test('a timed-out legacy press still releases its key and mouse button',async()=>{
 const {KeyboardDispatch}=await import('../lib/keyboard-protocol.js');
 const {dispatchClick}=await import('../lib/click.js');
 const calls=[];
 const c={async send(method,p){calls.push(p.type);if(p.type==='rawKeyDown'||p.type==='mousePressed')throw Error('CDP timeout: '+method);return {};}};
 await expect(new KeyboardDispatch(c).send({key:'a',code:'KeyA',text:'a'})).rejects.toThrow('CDP timeout');
 expect(calls).toEqual(['rawKeyDown','keyUp']);calls.length=0;
 await expect(dispatchClick(c,1,1)).rejects.toThrow('CDP timeout');
 expect(calls.filter(Boolean)).toEqual(['mousePressed','mouseReleased']);
});

test('Page.navigate retries a lost reply, but accepts a late reply without re-navigation',async()=>{
 await endpoint(async(c,m)=>{
  await c.send('Page.navigate',{url:'https://buninu.org/'},20);
  expect(m.filter(m=>m.method==='Page.navigate')).toHaveLength(2);
 },(ws,m,n)=>{if(m.method==='Page.getFrameTree')ws.send(JSON.stringify({id:m.id,result:{frameTree:{frame:{url:'about:blank'}}}}));else if(n>1)ws.send(JSON.stringify({id:m.id,result:{frameId:'page'}}));});
 await endpoint(async(c,m)=>{
  await c.send('Page.navigate',{url:'https://buninu.org/'},20);
  expect(m).toHaveLength(1);expect(c.diagnostics().pending).toBe(0);
 },(ws,m)=>setTimeout(()=>ws.send(JSON.stringify({id:m.id,result:{frameId:'page'}})),80));
});
test('a newer navigation cancels an older navigation retry',async()=>{
 await endpoint(async(c,m)=>{
  const old=c.send('Page.navigate',{url:'https://old.invalid'},20).catch(e=>e.message);
  await Bun.sleep(60);await c.send('Page.navigate',{url:'https://buninu.org/'},20);
  expect(await old).toContain('superseded');expect(m).toHaveLength(2);
 },(ws,m,n)=>{if(m.method==='Page.getFrameTree')ws.send(JSON.stringify({id:m.id,result:{frameTree:{frame:{url:'about:blank'}}}}));else if(n>1)ws.send(JSON.stringify({id:m.id,result:{frameId:'page'}}));});
});
test('slow captures learn a longer deadline instead of always discarding their result',async()=>{
 await endpoint(async(c,m)=>{
  await expect(c.send('Page.captureScreenshot',{},20)).rejects.toThrow('timeout');
  expect(c.timeoutFor('Page.captureScreenshot',20)).toBe(40);
  const frame=await c.send('Page.captureScreenshot',{},20);
  expect(frame.data).toBe('image');expect(m).toHaveLength(2);
 },(ws,m)=>setTimeout(()=>ws.send(JSON.stringify({id:m.id,result:{data:'image'}})),30));
});

test('a committed navigation waits for rendering instead of restarting the page',async()=>{
 await endpoint(async(c,m)=>{
  const result=await c.send('Page.navigate',{url:'https://buninu.org'},20);
  expect(result.frameId).toBe('page');
  expect(m.map(x=>x.method)).toEqual(['Page.navigate','Page.getFrameTree']);
 },(ws,m)=>{if(m.method==='Page.getFrameTree')ws.send(JSON.stringify({id:m.id,result:{frameTree:{frame:{id:'page',url:'https://buninu.org/',loaderId:'current'}}}}));});
});
