import {test,expect} from 'bun:test';
import {CDPClient} from '../lib/cdp.js';

test('remote close rejects pending CDP calls and subsequent sends immediately',async()=>{
 let socket;
 const server=Bun.serve({port:0,fetch(req,s){s.upgrade(req);},websocket:{open(ws){socket=ws;},message(){}}});
 const client=new CDPClient();
 try{
  await client.connect(`ws://127.0.0.1:${server.port}`);
  const pending=client.send('Pending',{},60000);
  setTimeout(()=>socket.close(),10);
  await expect(pending).rejects.toThrow('Connection closed');
  await expect(client.send('AfterClose')).rejects.toThrow('Connection closed');
  expect(client._pending.size).toBe(0);
 }finally{client.close();server.stop(true);}
});

test('attach holds last frame after remote exit and drains replies before explicit quit',async()=>{
 let socket,child,output='',queries=0,closedAt=0,lastReplyAt=0;
 const timers=[];
 const server=Bun.serve({port:0,fetch(req,s){
  const path=new URL(req.url).pathname;
  if(path.startsWith('/devtools/')){s.upgrade(req);return;}
  if(path==='/json/list')return Response.json([{type:'page',webSocketDebuggerUrl:`ws://127.0.0.1:${s.port}/devtools/page/test`}]);
  return Response.json({Browser:'Test/1'});
 },websocket:{open(ws){socket=ws;},message(ws,data){
  const m=JSON.parse(data);let result={};
  if(m.method==='Page.getLayoutMetrics')result={cssVisualViewport:{clientWidth:800,clientHeight:600}};
  if(m.method==='Page.getNavigationHistory')result={currentIndex:0,entries:[{url:'about:blank'}]};
  ws.send(JSON.stringify({id:m.id,result}));
 }}});
 try{
  child=Bun.spawn([process.execPath,new URL('../index.js',import.meta.url).pathname,'--attach',String(server.port),'--no-shortcuts'],{
   env:{...process.env,CASTY_BROWSER:'/nonexistent'},
   terminal:{cols:80,rows:30,data(term,bytes){
    const text=Buffer.from(bytes).toString();output+=text;
    if(text.includes('\x1b[14t')){
     queries++;
     if(queries===1)term.write('\x1b[4;600;800t');
     else {
      closedAt=Date.now();socket.close();
      timers.push(setTimeout(()=>term.write('\x1b[4;933;'),50));
      timers.push(setTimeout(()=>{lastReplyAt=Date.now();term.write('797t');},200));
     }
    }
   }}
  });
  for(let n=0;n<100&&!output.includes('format=');n++)await Bun.sleep(30);
  expect(output).toContain('format=');await Bun.sleep(200);
  child.terminal.resize(79,29);
  for(let n=0;n<100&&!output.includes('Disconnected');n++)await Bun.sleep(20);
  expect(output).toContain('Disconnected');
  expect(output).toContain('\x1b[38;5;196m');
  const heldOutput=output.length;
  await Bun.sleep(350);
  expect(child.exitCode).toBeNull();
  expect(output.slice(heldOutput)).not.toContain('\x1b[2J');
  const queryCount=queries;
  child.terminal.resize(78,28);await Bun.sleep(200);
  expect(queries).toBe(queryCount);
  // The red @ remains a working local command entry with --no-shortcuts.
  child.terminal.write('\x1b[<0;2;1M\x1b[<0;2;1m');await Bun.sleep(50);
  child.terminal.write('q\r');
  const exit=await Promise.race([child.exited,Bun.sleep(5000).then(()=>{throw Error('attach did not exit');})]);
  expect(exit).toBe(0);expect(queries).toBe(2);
  expect(lastReplyAt).toBeGreaterThan(closedAt);
  expect(Date.now()-lastReplyAt).toBeGreaterThanOrEqual(100);
  expect(output).not.toContain('933;');expect(output).not.toContain('797t');
  expect(output).toContain('\x1b[?1016l');
  const shutdown=output.slice(output.indexOf('casty: shutting down'));
  expect(shutdown).not.toContain('\x1b[14t');
  expect(shutdown).not.toContain('\x1b[?1000;1003;1006h');
 }finally{for(const timer of timers)clearTimeout(timer);child?.kill();child?.terminal.close();server.stop(true);}
},10000);
