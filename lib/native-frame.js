import {unlink} from 'node:fs/promises';
import {validateRawFrame} from './capture-format.js';

// Native presenters own the same individual-file cleanup as Kitty t=t.
export async function consumeNativeFrame(data, {discard=false}={}) {
  const frame=validateRawFrame(data,'bgra');
  try {
    if(discard)return null;
    const pixels=new Uint8Array(await Bun.file(frame.path).arrayBuffer());
    if(pixels.byteLength!==frame.bytes)throw Error('Truncated raw frame');
    return {...frame,pixels};
  } finally {
    await unlink(frame.path).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
