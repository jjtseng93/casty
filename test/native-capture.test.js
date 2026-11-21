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

// A native window has no terminal to redraw, so, like the terminal frontend, it forces a
// capture when the page reports progress instead of waiting for the engine to push a frame.
function slowPage(failures = 0) {
  const client = new EventEmitter();
  const shots = [];
  let failed = 0;
  client.send = async method => {
    if (method !== 'Page.captureScreenshot') return {};
    shots.push(Date.now());
    if (failed < failures) { failed++; throw Object.assign(Error('CDP timeout: Page.captureScreenshot'), {code:'CDP_TIMEOUT'}); }
    return {data:'AA=='};
  };
  const frames = [];
  const capture = createNativeCapture({client, update: async () => {},
    frameOptions: () => ({width:100,height:100,format:'bgra',onFrame: data => frames.push(data)}), onError(){}});
  return {client, shots, frames, capture};
}

test('page progress events force captures like the terminal frontend', async () => {
  const {client, shots, capture} = slowPage();
  try {
    await capture.resize();
    await Bun.sleep(50);
    const before = shots.length;
    client.emit('Page.loadEventFired');
    await Bun.sleep(1500);
    // 0, 300 and 1000 ms after the event.
    expect(shots.length - before).toBe(3);
    const after = shots.length;
    client.emit('Page.frameNavigated', {frame:{id:'child', parentId:'main'}});
    await Bun.sleep(100);
    expect(shots.length).toBe(after); // an iframe navigating is not the page
    client.emit('Page.frameNavigated', {frame:{id:'main'}});
    await Bun.sleep(100);
    expect(shots.length).toBeGreaterThan(after);
  } finally { capture.close(); }
  for (const name of ['Page.domContentEventFired','Page.loadEventFired','Page.frameNavigated','Page.navigatedWithinDocument'])
    expect(client.listenerCount(name)).toBe(0);
});

test('a closed native capture ignores its pending delayed captures', async () => {
  const {client, shots, capture} = slowPage();
  await capture.resize();
  await Bun.sleep(50);
  client.emit('Page.domContentEventFired');
  await Bun.sleep(50);
  capture.close();
  const closedAt = shots.length;
  await Bun.sleep(1300);
  expect(shots.length).toBe(closedAt);
});

test('a very slow engine still gets its page drawn once it answers', async () => {
  // The first screenshots time out; capture keeps retrying until one comes back.
  const {client, frames, capture} = slowPage(3);
  try {
    await capture.resize();
    client.emit('Page.loadEventFired');
    for (let i = 0; i < 60 && !frames.length; i++) await Bun.sleep(100);
    expect(frames.length).toBeGreaterThan(0);
  } finally { capture.close(); }
});

test('a screencast that fails to restart is started again instead of leaving the view frozen', async () => {
  const client = new EventEmitter();
  let starts = 0;
  client.send = async method => {
    if (method === 'Page.startScreencast' && ++starts === 1) throw Error('CDP request superseded');
    return {data: 'AA=='};
  };
  const errors = [];
  const capture = createNativeCapture({client, update: async () => {},
    frameOptions: () => ({width:100,height:100,format:'bgra',onFrame(){}}), onError: e => errors.push(e.message)});
  try {
    await capture.resize();
    expect(starts).toBe(2);
    expect(errors).toEqual(['CDP request superseded']);
    expect(client.listenerCount('Page.screencastFrame')).toBe(1);
  } finally { capture.close(); }
});

test('screencast restarts stop when the capture is closed or the connection is gone', async () => {
  const {startScreencastWithRetry} = await import('../lib/browser.js');
  const gone = new EventEmitter();
  let tries = 0;
  gone.send = async () => { tries++; throw Error('Connection closed'); };
  await expect(startScreencastWithRetry(gone, {width:1,height:1,onFrame(){}}, {delays:[1]})).rejects.toThrow('Connection closed');
  expect(tries).toBe(1);
  const flaky = new EventEmitter();
  let closed = false, attempts = 0;
  flaky.send = async () => { attempts++; closed = true; throw Error('CDP request superseded'); };
  await expect(startScreencastWithRetry(flaky, {width:1,height:1,onFrame(){}}, {stopped: () => closed, delays:[1]})).rejects.toThrow('superseded');
  expect(attempts).toBe(1);
});
