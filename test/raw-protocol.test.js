import {test,expect} from 'bun:test';
import {BgraProbe,parsePreference} from '../lib/raw-protocol.js';
import {KittyTransport} from '../lib/kitty-transport.js';
test('only matching versioned preference replies enable raw, including fragmented replies',async()=>{
 for(const reply of ['OK Buninu1 bgra','OK Buninu1 rgba','OK','OK BUNINU1 bgra','EINVAL: unsupported format',null]){
  let writes=[],removed=0;const probe=new BgraProbe({write:s=>writes.push(s),createFile:()=>'/tmp/probe',removeFile:()=>removed++,timeout:10});
  const transport=new KittyTransport({write(){},createProbe(){},removeProbe(){},onReply:(id,message)=>probe.reply(id,message)});
  const result=probe.query();expect(writes[0]).toContain('a=q,t=f');
  transport.feed(`\x1b_Gi=${probe.id+1};OK Buninu1 bgra\x1b\\`,()=>{});
  if(reply){transport.feed(`\x1b_Gi=${probe.id};${reply.slice(0,2)}`,()=>{});transport.feed(`${reply.slice(2)}\x1b\\`,()=>{});}
  expect(await result).toBe(parsePreference(reply));expect(removed).toBe(1);
  transport.feed(`\x1b_Gi=${probe.id};OK Buninu1 bgra\x1b\\`,()=>{throw Error('late reply leaked');});transport.stop();
 }
});
