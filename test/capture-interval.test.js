import {test,expect} from 'bun:test';
import {startScreencast} from '../lib/browser.js';

test('capture interval can be adjusted or disabled without overlapping requests',async()=>{
 const old=process.env.CASTY_CAPTURE_MIN_INTERVAL;
 try{
  for(const value of ['120','0']){
   process.env.CASTY_CAPTURE_MIN_INTERVAL=value;
   let onChange,finish,calls=0;
   const client={on(_,fn){onChange=fn;},removeListener(){},send(method){
    if(method!=='Page.captureScreenshot')return Promise.resolve({});
    calls++;return new Promise(resolve=>{finish=()=>resolve({data:'frame'});});
   }};
   const stream=await startScreencast(client,{width:8,height:8,onFrame(){}});
   try{
    expect(calls).toBe(1);onChange({sessionId:1});expect(calls).toBe(1);
    finish();await Bun.sleep(1);onChange({sessionId:2});
    if(value==='0')expect(calls).toBe(2);
    else {expect(calls).toBe(1);await Bun.sleep(140);expect(calls).toBe(2);}
    onChange({sessionId:3});expect(calls).toBe(2);finish();await Bun.sleep(1);
   }finally{stream.cleanup();}
  }
 }finally{if(old===undefined)delete process.env.CASTY_CAPTURE_MIN_INTERVAL;else process.env.CASTY_CAPTURE_MIN_INTERVAL=old;}
});

test('idle refresh observes external changes without events and does not queue slow captures',async()=>{
 let finish,calls=0,state='initial';
 const frames=[];
 const client={on(){},removeListener(){},send(method){
  if(method!=='Page.captureScreenshot')return Promise.resolve({});
  calls++;
  return new Promise(resolve=>{finish=()=>resolve({data:state});});
 }};
 const stream=await startScreencast(client,{
  width:8,height:8,idleRefreshInterval:30,onFrame:data=>frames.push(data),
 });
 try{
  finish();await Bun.sleep(5);
  expect(frames).toEqual(['initial']);
  state='changed elsewhere';
  await Bun.sleep(60);expect(calls).toBe(2);
  await Bun.sleep(90);expect(calls).toBe(2);
  finish();await Bun.sleep(5);
  expect(frames).toEqual(['initial','changed elsewhere']);
  // No queued polling requests immediately after the slow capture.
  expect(calls).toBe(2);
  stream.cleanup();await Bun.sleep(60);expect(calls).toBe(2);
 }finally{stream.cleanup();}
});

test('idle refresh retries failed captures and cleanup cancels retries',async()=>{
 let calls=0;
 const client={on(){},removeListener(){},async send(method){
  if(method==='Page.captureScreenshot'){calls++;throw Error('temporary failure');}
  return {};
 }};
 const stream=await startScreencast(client,{width:8,height:8,idleRefreshInterval:20,onFrame(){}});
 try{
  await Bun.sleep(75);expect(calls).toBe(1);
   await Bun.sleep(1050);expect(calls).toBe(2);
  stream.cleanup();const stoppedAt=calls;
  await Bun.sleep(50);expect(calls).toBe(stoppedAt);
 }finally{stream.cleanup();}
});
