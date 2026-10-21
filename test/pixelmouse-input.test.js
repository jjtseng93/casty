import {test,expect} from 'bun:test';

test('Ctrl+E pixelmouse on/off switches real input handling and keeps URL bar coordinates',async()=>{
 const moduleURL=new URL('../lib/input.js',import.meta.url).href;
 const kittyURL=new URL('../lib/kitty.js',import.meta.url).href;
 const script=`
 import assert from 'node:assert/strict';
 import {EventEmitter} from 'node:events';
 import {detectTransport} from ${JSON.stringify(kittyURL)};
 import {startInputHandling,enableMouse,disableMouse} from ${JSON.stringify(moduleURL)};
 const output=[],events=[];
 process.stdout.write=s=>{output.push(String(s));return true;};
 process.stdin.setRawMode=()=>{};process.stdin.resume=()=>process.stdin;
 const client=new EventEmitter();client.send=async(method,params)=>{events.push({method,params});return method==='Page.getNavigationHistory'?{currentIndex:0,entries:[]}:{};};
 const bar=startInputHandling(client,10,20,2,{'ctrl+e':'command'},()=>{});
 bar.history.file=null;
 const feed=async text=>{process.stdin.emit('data',Buffer.from(text));await Bun.sleep(10);};
 const command=async text=>{await feed('\\x05');for(const c of text)await feed(c);await feed('\\r');};
 const click=async(x,y)=>{await feed('\\x1b[<0;'+x+';'+y+'M');await feed('\\x1b[<0;'+x+';'+y+'m');};
 const press=()=>events.filter(e=>e.method==='Input.dispatchMouseEvent'&&e.params.type==='mousePressed').at(-1).params;
 enableMouse();await feed('\\x1b[?101');await feed('6;2$y');await click(25,61);
 assert.equal(press().x,12.5);assert.equal(press().y,20.5);
 await command('pixelmouse off');await click(3,4);assert.equal(press().x,12.5);assert.equal(press().y,25);
 await command('pixelmouse on');assert.equal(output.at(-1).includes('1016$p')||output.some(s=>s==='\\x1b[?1016$p'),true);
 await feed('\\x1b[?1016;2$y');await click(26,61);assert.equal(press().x,13);assert.equal(press().y,20.5);
 bar.updateCellSize(10,20,2,{width:5,height:8,known:true});await click(400,240);assert.equal(press().x,400);assert.equal(press().y,290);
 bar.updateCellSize(10,20,2,{width:10,height:20,known:true});
 await command('kitty file');assert.equal(detectTransport(),'file');
 await command('kitty');assert.ok(output.some(s=>s.includes('Kitty: file')));
 await command('kitty inline');assert.equal(detectTransport(),'inline');
 await command('kitty invalid');assert.equal(detectTransport(),'inline');
 const count=events.filter(e=>e.method==='Input.dispatchMouseEvent').length;
 await feed('\\x1b[<0;25;10M');assert.equal(bar.editing,true);assert.equal(events.filter(e=>e.method==='Input.dispatchMouseEvent').length,count);
 disableMouse();process.exit(0);
 `;
 const child=Bun.spawn([process.execPath,'-e',script],{stdout:'pipe',stderr:'pipe'});
 const errors=new Response(child.stderr).text();
 expect(await child.exited).toBe(0);expect(await errors).toBe('');
},10000);
