import {test,expect} from 'bun:test';
import {attachPage,parseAttachEndpoint,attachDisplay} from '../lib/attach.js';

test('attach endpoints and display coordinates',()=>{
 expect(parseAttachEndpoint('9222').href).toBe('http://127.0.0.1:9222/');
 expect(parseAttachEndpoint('https://host:1234').protocol).toBe('https:');
 expect(parseAttachEndpoint('wss://host/devtools/page/1').protocol).toBe('wss:');
 for(const value of ['0','65536','file:///tmp/x','ws://host/devtools/browser/1'])expect(()=>parseAttachEndpoint(value)).toThrow();
 const display=attachDisplay({width:800,height:600,cellWidth:10,cellHeight:20,cols:80,rows:30},{width:1600,height:900});
 expect([display.cols,display.rows]).toEqual([80,23]);
 expect(display.map(40.5,13)).toEqual({x:800,y:450});
 expect(display.map(1,25)).toBeNull();
});

for(const kind of ['port','http','ws'])test(`attach ${kind} uses an existing target without changing it`,async()=>{
 const methods=[],paths=[];
 const server=Bun.serve({port:0,hostname:'127.0.0.1',fetch(req,server){
  const path=new URL(req.url).pathname;paths.push(path);
  if(path.startsWith('/devtools/page/')){server.upgrade(req);return;}
  if(path==='/json/list')return Response.json([{type:'page',webSocketDebuggerUrl:`ws://127.0.0.1:${server.port}/devtools/page/existing`}]);
  if(path==='/json/version')return Response.json({Browser:'Test/1'});
  return new Response('',{status:404});
 },websocket:{message(ws,data){
  const message=JSON.parse(data);methods.push(message.method);
  ws.send(JSON.stringify({id:message.id,result:message.method==='Page.getLayoutMetrics'?{cssVisualViewport:{clientWidth:1024,clientHeight:768}}:{}}));
 }}});
 let client;
 try {
  const endpoint=kind==='port'?String(server.port):kind==='http'?`http://127.0.0.1:${server.port}`:`ws://127.0.0.1:${server.port}/devtools/page/existing`;
  const result=await attachPage(endpoint);client=result.client;
  expect([result.cssWidth,result.cssHeight]).toEqual([1024,768]);
  client.close();
  expect(methods).toEqual(['Page.enable','Page.getLayoutMetrics']);
  expect(paths.some(p=>p==='/json/new')).toBe(false);
 }finally{client?.close();server.stop(true)}
});

test('multiple or missing pages never silently create/select a target',async()=>{
 for(const pages of [[],[{type:'page',title:'A',webSocketDebuggerUrl:'ws://localhost/devtools/page/a'},{type:'page',title:'B',webSocketDebuggerUrl:'ws://localhost/devtools/page/b'}]]){
  const server=Bun.serve({port:0,fetch:()=>Response.json(pages)});
  try{await expect(attachPage(String(server.port))).rejects.toThrow(pages.length?'Multiple pages':'No existing');}
  finally{server.stop(true)}
 }
});

test('attach fit uses actual fractional Kitty cells after keyboard resize',()=>{
 const viewport={width:800,height:1200};
 for(const rows of [40,22,40]){
  const term={cols:80,rows,cellWidth:7,cellHeight:15,mouseCellWidth:7.9,mouseCellHeight:15.9,width:560,height:rows*15};
  const fit=attachDisplay(term,viewport);
  const width=fit.cols*7.9,height=fit.rows*15.9;
  expect(Math.abs(width-height*800/1200)).toBeLessThan(16);
  expect(fit.cols).toBeLessThanOrEqual(80);
  expect(fit.rows).toBeLessThanOrEqual(rows-1);
 }
});


test('attach does not lose a second column to CSS viewport rounding',()=>{
 const term={cols:44,rows:25,width:385.2,height:457.5,cellWidth:8.755,cellHeight:18.3};
 const fit=attachDisplay(term,{width:352,height:402});
 expect(fit.cols).toBe(44);
 expect(fit.rows).toBe(24);
 expect(fit.map(44,25)).not.toBeNull();
 expect(fit.map(45,25)).toBeNull();
 // A genuinely different aspect ratio must still be fitted, not stretched
 // across the complete available area.
 const narrow=attachDisplay(term,{width:100,height:1000});
 expect(narrow.cols).toBeLessThan(10);
 expect(narrow.rows).toBe(24);
});
