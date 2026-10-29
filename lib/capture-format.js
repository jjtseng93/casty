import {isCDPTimeout} from './cdp.js';
import {openSync,fstatSync,closeSync} from 'node:fs';

export const isRaw = format => format === 'bgra' || format === 'rgba';
export const standardFormat = (configured='auto',transport='inline') =>
  configured === 'auto' ? (transport === 'file' ? 'jpeg' : 'png') : configured;

function descriptor(data,format) {
  // The producer supplies the path; names and extensions are not protocol fields.
  // Casty never deletes these files. Kitty t=t transfers cleanup to the terminal,
  // with the producer responsible for abandoned frames.
  const frame=JSON.parse(data);
  if(frame?.version!==1||frame.transport!=='file'||!isRaw(frame.format)||(format&&frame.format!==format)
    ||typeof frame.path!=='string'||!frame.path||frame.path.includes('\0')
    ||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.height<1
    ||frame.width*frame.height>16777216||frame.stride!==frame.width*4||frame.bytes!==frame.stride*frame.height)
    throw Error('Invalid raw frame descriptor');
  return frame;
}
export function validateRawFrame(data,format) {
  const frame=descriptor(data,format);
  const fd=openSync(frame.path,'r');
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size!==frame.bytes)throw Error('Invalid raw frame file');}
  finally{closeSync(fd);}
  return frame;
}
// Raw is negotiated once per connection, ahead of all configured codecs.
// Shared by normal captures and resize captures. Navigation can invalidate a
// capture or its temporary file without invalidating negotiated raw support.
export function transientRawCaptureError(error) {
  return isCDPTimeout(error) || error?.code === "ENOENT" || /^(compositor closed|Renderer closed during capture|Capture superseded by navigation)$/.test(error?.message ?? "");
}
export async function createCapturePolicy(client,{
  configured='auto',getTransport=()=> 'inline',queryPreference,timeout=5000,getClip=async()=>undefined,
}={}) {
  const fallback=()=>standardFormat(configured,getTransport());
  let format=fallback(),firstFrame;
  let closed=false;
  const clipped = async params => {const clip=await getClip();return clip ? {...params,clip} : params;};
  async function rawCapture(params,wait) {
    params=await clipped(params);
    wait=client.timeoutFor?.('Page.captureScreenshot',wait) ?? wait;
    let timer;
    const request=Promise.resolve().then(()=>client.send('Page.captureScreenshot',params,wait));
    try{
      const result=await Promise.race([request,new Promise((_,reject)=>{
        timer=setTimeout(()=>{reject(Error('Raw capture timed out'));},wait);
      })]);
      if(closed)throw Error('Capture policy is closed');
      validateRawFrame(result?.data,params.format);
      return result;
    }finally{clearTimeout(timer);}
  }
  if(getTransport()==='file'){
    try{
      const preferred=await queryPreference();
      if(isRaw(preferred)){
        const result=await rawCapture({format:preferred,optimizeForSpeed:true,captureBeyondViewport:false},timeout);
        format=preferred;firstFrame=result.data;
      }
    }catch{format=fallback();}
  }
  return {
    get format(){if(isRaw(format)&&getTransport()!=='file')format=fallback();return format;},
    retireRaw(){if(isRaw(format))format=fallback();},
    takeFirstFrame(){const data=firstFrame;firstFrame=undefined;return data;},
    async capture(options={},wait=timeout){
      if(closed)throw Error('Capture policy is closed');
      if(isRaw(format)&&getTransport()!=='file')format=fallback();
      const params=()=>{
        const p={optimizeForSpeed:true,captureBeyondViewport:false,...options,format};
        if(format!=='jpeg')delete p.quality;
        return p;
      };
      if(isRaw(format)){
        try{return await rawCapture(params(),wait);}
        catch(error){if(closed || transientRawCaptureError(error))throw error;format=fallback();}
      }
      return client.send('Page.captureScreenshot',params(),wait);
    },
    close(){closed=true;firstFrame=undefined;},
  };
}

// CDP clip is in document CSS coordinates. Keep fractions until the engine
// converts to physical pixels; do not round terminal dimensions twice.
export async function viewportClip(client, {width,height,zoom}) {
  // This is optional capture metadata, not an operation that must block
  // navigation until it succeeds. The caller falls back to an unclipped shot.
  const metrics=await client.send('Page.getLayoutMetrics', {}, 5000, {retry:false});
  const view=metrics.cssVisualViewport ?? metrics.visualViewport;
  if(!view || !Number.isFinite(view.pageX) || !Number.isFinite(view.pageY))return undefined;
  return {x:view.pageX,y:view.pageY,width:width/zoom,height:height/zoom,scale:1};
}
