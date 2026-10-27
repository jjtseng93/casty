import {test,expect} from 'bun:test';

test('readonly blocks page input and navigation, toggles locally, and maps attach coordinates',async()=>{
 const script=`
 import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
 import {startInputHandling,stopInputHandling} from ${JSON.stringify(new URL('../lib/input.js',import.meta.url).href)};
 process.stdout.write=()=>true;process.stdin.setRawMode=()=>{};process.stdin.resume=()=>process.stdin;
 const calls=[];const client=new EventEmitter();client.send=async(method,params)=>{
 calls.push([method,params]);return method==='Page.getNavigationHistory'?{currentIndex:0,entries:[{url:'https://example.test'}]}:{};
 };
 const bar=startInputHandling(client,10,20,1,{'ctrl+e':'command','ctrl+r':'reload'},()=>{},null,{},
 {readonly:true,mapPointer:(col,row)=>({x:col*100,y:row*100})});bar.history.file=null;
 const input=async text=>{process.stdin.emit('data',Buffer.from(text));await Bun.sleep(40)};
 const command=async text=>{await input('\\x05');await input(text);await input('\\r')};
 await input('abc');await input('\\x1b[<0;3;4M');await input('\\x1b[<0;3;4m');await input('\\x1b[<64;3;4M');await input('\\x12');
 await command('open https://elsewhere.test');
 assert.equal(calls.some(([m])=>m.startsWith('Input.')||m==='Page.navigate'||m==='Page.reload'||m==='Runtime.evaluate'),false);
 await command('readonly off');await input('x');
 assert.ok(calls.some(([m,p])=>m==='Input.insertText'&&p.text==='x'));
 await input('\\x1b[<64;3;4M');
 assert.ok(calls.some(([m,p])=>m==='Input.dispatchMouseEvent'&&p.type==='mouseWheel'&&p.x===300&&p.y===400));
 await command('readonly on');const count=calls.length;await input('y');await input('\\x1b[<65;3;4M');
 assert.equal(calls.slice(count).some(([m])=>m.startsWith('Input.')),false);
 stopInputHandling();process.exit(0);
 `;
 const child=Bun.spawn([process.execPath,'-e',script],{stdout:'pipe',stderr:'pipe'});
 const stderr=await new Response(child.stderr).text();expect({exit:await child.exited,stderr}).toEqual({exit:0,stderr:''});
},10000);
