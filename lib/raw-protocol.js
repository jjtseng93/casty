// Buninu private extension; not a registered Kitty pixel format.
export const BGRA_FORMAT = 0x42475241;
export const BGRA_REPLY = 'OK Buninu1 bgra';
export function parsePreference(message) {
  if(message==='OK Buninu1 bgra')return 'bgra';
  if(message==='OK Buninu1 rgba')return 'rgba';
  return 'png';
}

// Query never displays pixels. A plain OK is deliberately insufficient:
// some terminals only check transport readability, not pixel format support.
export class BgraProbe {
  constructor({write,createFile,removeFile,timeout=700}) {
    Object.assign(this,{write,createFile,removeFile,timeout});
  }
  query() {
    this.stop();
    this.id=100000+Math.floor(Math.random()*2000000000);
    return new Promise(resolve=>{
      this.resolve=resolve;
      try {
        this.path=this.createFile(Buffer.from([7,19,239,255]));
        this.timer=setTimeout(()=>this.finish('png'),this.timeout);
        this.write(`\x1b_Ga=q,t=f,f=${BGRA_FORMAT},s=1,v=1,i=${this.id},q=0;${Buffer.from(this.path).toString('base64')}\x1b\\`);
      }catch{this.finish('png');}
    });
  }
  reply(id,message) {
    if(this.resolve&&Number(id)===this.id)this.finish(parsePreference(message));
  }
  finish(supported) {
    clearTimeout(this.timer);
    if(this.path){try{this.removeFile(this.path);}catch{}this.path=null;}
    const resolve=this.resolve;this.resolve=null;resolve?.(supported);
  }
  stop(){this.finish('png');}
}

