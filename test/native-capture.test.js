import {test, expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {createNativeCapture} from '../lib/native-capture.js';
import {startScreencast} from '../lib/browser.js';

test('initial native capture and resize have one stream owner', async () => {
  const client = new EventEmitter();
  let release, starts = 0;
  client.send = async method => {
    if (method === 'Page.startScreencast' && ++starts === 1)
      await new Promise(resolve => { release = resolve; });
    return {};
  };
  const errors = [];
  const capture = createNativeCapture({client, update: async () => {},
    frameOptions: () => ({width:100,height:100,format:'bgra',onFrame(){}}),
    onError: e => errors.push(e)});
  try {
    const initial = capture.resize();
    while (!release) await Bun.sleep(1);
    const resized = capture.resize();
    expect(starts).toBe(1);
    release();
    await Promise.all([initial, resized]);
    expect(starts).toBe(2);
    expect(client.listenerCount('Page.screencastFrame')).toBe(1);
    expect(errors).toEqual([]);
  } finally { capture.close(); }
  expect(client.listenerCount('Page.screencastFrame')).toBe(0);
});

test('closing during native stream startup retires the late result', async () => {
  const client = new EventEmitter();
  let release;
  client.send = async method => {
    if (method === 'Page.startScreencast') await new Promise(resolve => { release = resolve; });
    return {};
  };
  const capture = createNativeCapture({client,update:async()=>{},
    frameOptions:()=>({width:100,height:100,onFrame(){throw Error('late frame');}}),onError(){}});
  const initial = capture.resize();
  while (!release) await Bun.sleep(1);
  capture.close();
  release();
  await initial;
  await capture.drain();
  expect(client.listenerCount('Page.screencastFrame')).toBe(0);
});

test('a rejected screencast start releases its event listener', async () => {
  const client = new EventEmitter();
  client.send = async () => { throw Error('Connection closed'); };
  await expect(startScreencast(client,{width:100,height:100,onFrame(){}})).rejects.toThrow('Connection closed');
  expect(client.listenerCount('Page.screencastFrame')).toBe(0);
});

test('native attach refreshes remote geometry before frames without resizing it',async()=>{
 const {createNativeAttachPolicy}=await import('../lib/native-capture.js');
 const calls=[],viewports=[];let width=800;
 const client={send:async(method,params)=>{
  calls.push(method);
  if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:width,clientHeight:600}};
  expect(viewports.at(-1).width).toBe(width);
  return {data:'frame'};
 }};
 const policy=createNativeAttachPolicy(client,v=>viewports.push(v));
 await policy.capture({},1000);width=1200;await policy.capture({},1000);
 expect(viewports.map(v=>v.width)).toEqual([800,1200]);
 expect(calls).toEqual(['Page.getLayoutMetrics','Page.captureScreenshot','Page.getLayoutMetrics','Page.captureScreenshot']);
});
