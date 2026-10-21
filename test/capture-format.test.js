import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCapturePolicy,standardFormat} from '../lib/capture-format.js';
import {startScreencast} from '../lib/browser.js';
function fixture(format='bgra',producer='land'){
 const dir=mkdtempSync(join(tmpdir(),'raw-test-'+producer+'-')),path=join(dir,'pixels-without-extension');
 writeFileSync(path,Buffer.from([1,2,3,255]));
 return {dir,path,data:JSON.stringify({version:1,transport:'file',path,format,width:1,height:1,stride:4,bytes:4}),close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('raw outranks every setting and probe frame is reused; close leaves producer files untouched',async()=>{
 for(const configured of ['auto','png','jpeg','webp'])for(const format of ['bgra','rgba']){
  const f=fixture(format);let calls=0;
  try{
   const policy=await createCapturePolicy({send:async()=>{calls++;return {data:f.data};}},{configured,getTransport:()=> 'file',queryPreference:async()=>format});
   expect(policy.format).toBe(format);expect(calls).toBe(1);
   if(configured==='auto'){expect(policy.takeFirstFrame()).toBe(f.data);expect(policy.takeFirstFrame()).toBeUndefined();}
   policy.close();expect(existsSync(f.path)).toBe(true);
  }finally{f.close();}
 }
});
test('rejected, ignored, missing and timed-out raw formats restore original codecs',async()=>{
 for(const configured of ['auto','png','jpeg','webp'])for(const send of [()=>{throw Error('Invalid image format');},()=>({data:'iVBORw0KGgo='}),()=>({data:'{}'}),()=>new Promise(()=>{})]){
  const policy=await createCapturePolicy({send},{configured,getTransport:()=> 'file',queryPreference:async()=> 'bgra',timeout:5});
  expect(policy.format).toBe(standardFormat(configured,'file'));policy.close();
 }
 let queried=false;
 const policy=await createCapturePolicy({send(){throw Error('no raw');}},{getTransport:()=> 'inline',queryPreference:()=>{queried=true;}});
 expect(policy.format).toBe('png');expect(queried).toBe(false);policy.close();
});
test('late raw probe leaves producer files untouched',async()=>{
 const f=fixture();let resolve;
 try{
  const policy=await createCapturePolicy({send:()=>new Promise(r=>resolve=r)},{getTransport:()=> 'file',queryPreference:async()=> 'bgra',timeout:5});
  expect(policy.format).toBe('jpeg');resolve({data:f.data});await Bun.sleep(1);
  expect(existsSync(f.path)).toBe(true);policy.close();
 }finally{f.close();}
});
test('live raw failure retires raw, restores JPEG refinement and survives resize reuse',async()=>{
 const f=fixture(),requests=[],frames=[];let captures=0,cleanup;
 const client={on(){},removeListener(){},async send(method,params){requests.push([method,params.format]);if(method==='Page.captureScreenshot'){
  if(params.format==='bgra'){if(captures++===0)return {data:f.data};throw Error('raw lost');}
  return {data:'frame-'+params.format};
 }return {};}};
 const policy=await createCapturePolicy(client,{getTransport:()=> 'file',queryPreference:async()=> 'bgra'});
 policy.takeFirstFrame();
 try{
  const s=await startScreencast(client,{width:100,height:100,format:policy.format,capturePolicy:policy,onFrame:s=>frames.push(s)});cleanup=s.cleanup;
  await Bun.sleep(650);
  expect(policy.format).toBe('jpeg');expect(frames).toContain('frame-jpeg');expect(frames).toContain('frame-png');
  const count=captures;await policy.capture({quality:85});await s.forceCapture();expect(captures).toBe(count);
 }finally{cleanup?.();policy.close();f.close();}
});
test('changing to inline retires raw before transmitting another frame',async()=>{
 const f=fixture();let transport='file';const calls=[];
 try{
  const policy=await createCapturePolicy({send:async(_m,p)=>{calls.push(p.format);return {data:p.format==='bgra'?f.data:'PNG'};}},{getTransport:()=>transport,queryPreference:async()=> 'bgra'});
  policy.takeFirstFrame();transport='inline';expect(policy.format).toBe('png');expect((await policy.capture()).data).toBe('PNG');
  expect(calls).toEqual(['bgra','png']);policy.close();
 }finally{f.close();}
});

test('arbitrary producer names use the same negotiated transport without cleanup',async()=>{
 const f=fixture('bgra','any-producer');
 try{
  const p=await createCapturePolicy({send:async()=>({data:f.data})},{getTransport:()=> 'file',queryPreference:async()=> 'bgra'});
  expect(p.format).toBe('bgra');p.close();expect(existsSync(f.path)).toBe(true);
 }finally{f.close();}
});

test('clip keeps fractional size and follows document scroll for raw probe and captures',async()=>{
 const {viewportClip}=await import('../lib/capture-format.js');
 const f=fixture();const calls=[];let y=0;
 const geometry={width:1918,height:1053,zoom:1.75};
 const client={send:async(method,params)=>{
  if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{pageX:0,pageY:y}};
  calls.push(params);return {data:params.format==='bgra'?f.data:'PNG'};
 }};
 try {
  const policy=await createCapturePolicy(client,{getTransport:()=> 'file',queryPreference:async()=> 'bgra',getClip:()=>viewportClip(client,geometry)});
  expect(calls[0].clip).toEqual({x:0,y:0,width:1096,height:1053/1.75,scale:1});
  y=200;await policy.capture();expect(calls.at(-1).clip.y).toBe(200);
  geometry.height=999;await policy.capture();expect(calls.at(-1).clip.height).toBe(999/1.75);
  policy.retireRaw();await policy.capture();expect(calls.at(-1).clip).toBeUndefined();
  policy.close();
 }finally{f.close();}
});

test('screencast keeps Chromium max limits plus crop extension and never displays notification images',async()=>{
 const {EventEmitter}=await import('node:events');
 const client=new EventEmitter(),calls=[],frames=[];
 client.send=async(method,params)=>{calls.push({method,params});return method==='Page.captureScreenshot'?{data:'full-frame'}:{};};
 const session=await startScreencast(client,{width:800,height:600,format:'png',onFrame:data=>frames.push(data)});
 try{
  await Bun.sleep(10);
  expect(calls.find(c=>c.method==='Page.startScreencast').params).toMatchObject({maxWidth:200,maxHeight:150,clip:{x:0,y:0,width:200,height:150,scale:1}});
  client.emit('Page.screencastFrame',{sessionId:1,data:'cropped-notification'});
  await Bun.sleep(70);
  expect(frames.length).toBeGreaterThan(0);expect(frames.every(data=>data==='full-frame')).toBe(true);
 }finally{session.cleanup();}
});
