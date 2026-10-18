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
