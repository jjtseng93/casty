import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumeNativeFrame} from '../lib/native-frame.js';

test('native presenter releases displayed and discarded frames beyond the 16-file limit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'casty-native-test-'));
 try {
  for(let i=0;i<64;i++){
   expect(readdirSync(dir).length).toBe(0);
   const path=join(dir,`${i}.bgra`),pixels=Buffer.from([i,2,3,255]);
   writeFileSync(path,pixels);
   const data=JSON.stringify({version:1,transport:'file',format:'bgra',width:1,height:1,stride:4,bytes:4,path});
   const frame=await consumeNativeFrame(data,{discard:i%2===1});
   if(i%2===0)expect(Buffer.from(frame.pixels)).toEqual(pixels);
   else expect(frame).toBeNull();
  }
  expect(readdirSync(dir)).toEqual([]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
