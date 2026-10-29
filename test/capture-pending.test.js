import {test, expect} from 'bun:test';
import {startScreencast} from '../lib/browser.js';

const settle = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

function delayedClient() {
  let listener, active=0, maximum=0;
  const requests=[], frames=[];
  return {
    requests, frames,
    get maximum() { return maximum; },
    changed() { listener({sessionId:requests.length}); },
    on(_, callback) { listener=callback; },
    removeListener() {},
    send(method, params) {
      if (method!=='Page.captureScreenshot') return Promise.resolve({});
      active++; maximum=Math.max(maximum,active);
      return new Promise((resolve,reject) => {
        requests.push({params,at:Date.now(),resolve:data=>resolve({data}),reject});
      }).finally(()=>{active--;});
    },
  };
}

async function withStream(interval, run, options={}) {
  const previous=process.env.CASTY_CAPTURE_MIN_INTERVAL;
  process.env.CASTY_CAPTURE_MIN_INTERVAL=String(interval);
  const client=delayedClient();
  let stream;
  try {
    stream=await startScreencast(client,{width:8,height:8,format:'bgra',onFrame:data=>client.frames.push(data),...options});
    await run(client,stream);
  } finally {
    stream?.cleanup();
    if(previous===undefined)delete process.env.CASTY_CAPTURE_MIN_INTERVAL;
    else process.env.CASTY_CAPTURE_MIN_INTERVAL=previous;
  }
}

test('a raw notification burst during a slow capture keeps its final update without another event or a backlog',async()=>{
  await withStream(0,async client=>{
    expect(client.requests).toHaveLength(1);
    for(let i=0;i<100;i++)client.changed();
    expect(client.requests).toHaveLength(1);
    client.requests[0].resolve('before the change');
    await settle();
    expect(client.requests).toHaveLength(2);
    client.requests[1].resolve('latest page');
    await settle();await Bun.sleep(25);
    expect(client.frames).toEqual(['before the change','latest page']);
    expect(client.requests).toHaveLength(2);
    expect(client.maximum).toBe(1);
  });
});

test('a pending update obeys the configured minimum interval',async()=>{
  await withStream(60,async client=>{
    client.changed();client.requests[0].resolve('first');
    await settle();
    await Bun.sleep(90);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].at-client.requests[0].at).toBeGreaterThanOrEqual(60);
    client.requests[1].resolve('latest');await settle();
    expect(client.maximum).toBe(1);
  });
});

test('one forced capture also satisfies ordinary updates received before it starts',async()=>{
  await withStream(60000,async(client,stream)=>{
    for(let i=0;i<10;i++){client.changed();void stream.forceCapture();}
    client.requests[0].resolve('old');await settle();
    // Force bypasses the interval, but ordinary updates do not create a third request.
    expect(client.requests).toHaveLength(2);
    client.requests[1].resolve('new');await settle();await Bun.sleep(25);
    expect(client.requests).toHaveLength(2);
    expect(client.maximum).toBe(1);
  });
});

test('a failed capture retries one observed change and does not start continuous polling',async()=>{
  await withStream(0,async client=>{
    client.changed();client.requests[0].reject(Error('temporary capture failure'));await settle();
    expect(client.requests).toHaveLength(1);await Bun.sleep(1050);
    expect(client.requests).toHaveLength(2);
    client.requests[1].reject(Error('still unavailable'));await settle();await Bun.sleep(25);
    expect(client.requests).toHaveLength(2);
    expect(client.frames).toEqual([]);
    expect(client.maximum).toBe(1);
  });
});

test('cleanup discards an outstanding invalidation and a late screenshot',async()=>{
  await withStream(0,async(client,stream)=>{
    client.changed();stream.cleanup();
    client.requests[0].resolve('too late');await settle();await Bun.sleep(25);
    expect(client.requests).toHaveLength(1);
    expect(client.frames).toEqual([]);
  });
});

test('JPEG refinement does not repeat without another update',async()=>{
  await withStream(0,async client=>{
    client.requests[0].resolve('jpeg');await settle();await Bun.sleep(550);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].params.format).toBe('png');
    client.requests[1].resolve('refined');await settle();await Bun.sleep(550);
    expect(client.requests).toHaveLength(2);
    expect(client.frames).toEqual(['jpeg','refined']);
  },{format:'jpeg'});
});

test('encoded capture notifications cannot sustain their own capture or refinement loop',async()=>{
  await withStream(0,async client=>{
    for(let i=0;i<10;i++)client.changed();
    client.requests[0].resolve('jpeg');await settle();await Bun.sleep(550);
    expect(client.requests).toHaveLength(2);
    for(let i=0;i<10;i++)client.changed();
    client.requests[1].resolve('refined');await settle();await Bun.sleep(550);
    expect(client.requests).toHaveLength(2);
    expect(client.maximum).toBe(1);
  },{format:'jpeg'});
});

test('retiring raw discards its pending invalidation before continuing encoded capture',async()=>{
  let finish,calls=0;
  const policy={format:'bgra',capture:()=>{calls++;return new Promise(resolve=>{finish=()=>{
    policy.format='png';resolve({data:'fallback png'});
  };});}};
  await withStream(0,async client=>{
    for(let i=0;i<10;i++)client.changed();
    finish();await settle();await Bun.sleep(25);
    expect(client.frames).toEqual(['fallback png']);
    expect(calls).toBe(1);
    // Neither the old raw notification nor encoded self-notifications can
    // restart capture. A later real event still starts a new capture normally.
    client.changed();await settle();
    for(let i=0;i<10;i++)client.changed();
    finish();await settle();await Bun.sleep(25);
    expect(client.frames).toEqual(['fallback png','fallback png']);
    expect(calls).toBe(2);
  },{capturePolicy:policy});
});
