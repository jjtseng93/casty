import {openSync,fstatSync,closeSync,unlinkSync,realpathSync} from 'node:fs';
import {isAbsolute,basename,dirname} from 'node:path';

export const isRaw = format => format === 'bgra' || format === 'rgba';
export const standardFormat = (configured='auto',transport='inline') =>
  configured === 'auto' ? (transport === 'file' ? 'jpeg' : 'png') : configured;

function descriptor(data,format) {
  const frame=JSON.parse(data);
  if(frame?.version!==1||frame.transport!=='file'||!isRaw(frame.format)||(format&&frame.format!==format)
    ||typeof frame.path!=='string'||!isAbsolute(frame.path)
    ||!/^tty-graphics-protocol-(?:land|browser)-[\w-]+$/.test(basename(dirname(frame.path)))
    ||!/^\d+\.(rgba|bgra)$/.test(basename(frame.path))
    ||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.height<1
    ||frame.width*frame.height>16777216||frame.stride!==frame.width*4||frame.bytes!==frame.stride*frame.height)
    throw Error('Invalid raw frame descriptor');
  return frame;
}
export function validateRawFrame(data,format) {
  const frame=descriptor(data,format);
  if(realpathSync(frame.path)!==frame.path)throw Error('Raw frame path must not be a symlink');
  const fd=openSync(frame.path,'r');
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size!==frame.bytes)throw Error('Invalid raw frame file');}
  finally{closeSync(fd);}
  return frame;
}
export function discardRawFrame(data) {
  if(typeof data!=='string'||!data.startsWith('{'))return;
  try{const frame=descriptor(data);if(realpathSync(frame.path)===frame.path)unlinkSync(frame.path);}catch{}
}

// Raw is negotiated once per connection, ahead of all configured codecs.
// Shared by normal captures and resize captures, so a failed raw path stays off.
export async function createCapturePolicy(client,{
  configured='auto',getTransport=()=> 'inline',queryPreference,timeout=5000,
}={}) {
  const fallback=()=>standardFormat(configured,getTransport());
  let format=fallback(),firstFrame;
  let closed=false;
  async function rawCapture(params,wait) {
    let expired=false,timer;
    const request=Promise.resolve().then(()=>client.send('Page.captureScreenshot',params,wait));
    request.then(result=>{if(expired||closed)discardRawFrame(result?.data);},()=>{});
    try{
      const result=await Promise.race([request,new Promise((_,reject)=>{
        timer=setTimeout(()=>{expired=true;reject(Error('Raw capture timed out'));},wait);
      })]);
      if(closed){discardRawFrame(result?.data);throw Error('Capture policy is closed');}
      try{validateRawFrame(result?.data,params.format);}catch(error){discardRawFrame(result?.data);throw error;}
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
    get format(){return format;},
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
        catch(error){if(closed)throw error;format=fallback();}
      }
      return client.send('Page.captureScreenshot',params(),wait);
    },
    close(){closed=true;discardRawFrame(firstFrame);firstFrame=undefined;},
  };
}
