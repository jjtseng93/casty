import {test,expect} from 'bun:test';
import {createResizeHandler} from '../lib/resize.js';
import {CDPClient} from '../lib/cdp.js';

test('a timed-out metrics command resumes capture and coalesces busy resizes to the latest size',async()=>{
 const metrics=[],events=[],errors=[];
 const server=Bun.serve({port:0,fetch(req,s){if(s.upgrade(req))return;return new Response('');},websocket:{message(ws,raw){
  const msg=JSON.parse(raw);
  if(msg.method==='Emulation.setDeviceMetricsOverride'){
   metrics.push(msg.params.width);
   if(metrics.length===1){setTimeout(()=>ws.send(JSON.stringify({id:msg.id,result:{}})),100);return;}
  }
  ws.send(JSON.stringify({id:msg.id,result:{}}));
 }}});
 const client=new CDPClient();client.on('error',()=>{});
 try{
  await client.connect(`ws://127.0.0.1:${server.port}`);
  let width=800,active=0,maxActive=0;
  const resize=createResizeHandler({async update(){active++;maxActive=Math.max(maxActive,active);try{events.push('stop');await client.send('Page.stopScreencast');await client.send('Emulation.setDeviceMetricsOverride',{width},40);}finally{active--;}},async resume(){events.push('resume');await client.send('Page.startScreencast');},onError:e=>errors.push(e.message)});
  const first=resize();
  for(let i=0;i<100&&!metrics.length;i++)await Bun.sleep(1);
  width=1000;const second=resize();width=1200;const third=resize();
  await Promise.all([first,second,third]);await Bun.sleep(120);
  expect(metrics).toEqual([800,1200]);expect(events).toEqual(['stop','resume','stop','resume']);
  expect(maxActive).toBe(1);expect(errors).toEqual([]);expect(client.diagnostics().pending).toBe(0);
 }finally{client.close();server.stop(true);}
});

test('one failed resize resumes without requiring another resize event',async()=>{
 const errors=[];let resumed=0,attempts=0;
 const resize=createResizeHandler({async update(){attempts++;throw Error('busy renderer')},async resume(){resumed++},onError:e=>errors.push(e.message)});
 await resize();expect(resumed).toBe(1);expect(attempts).toBe(1);expect(errors).toEqual(['busy renderer']);
 await resize();expect(resumed).toBe(2);
});

test('a failed resume releases the resize queue for later recovery',async()=>{
 const errors=[];let attempts=0;
 const resize=createResizeHandler({async update(){},async resume(){if(++attempts===1)throw Error('disconnected')},onError:e=>errors.push(e.message)});
 await resize();await resize();expect(attempts).toBe(2);expect(errors).toEqual(['disconnected']);
});
