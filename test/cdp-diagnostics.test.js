import {test,expect} from 'bun:test';
import {CDPClient} from '../lib/cdp.js';
import {parseCommand} from '../lib/commands.js';
test('CDP diagnostics keep the connected endpoint and report state without requests',async()=>{
 const server=Bun.serve({port:0,fetch(req,server){if(server.upgrade(req))return;return new Response('');},websocket:{message(){}}});
 const client=new CDPClient();client.on('error',()=>{});
 try{
  const wsUrl=`ws://127.0.0.1:${server.port}/devtools/page/test`;
  await client.connect(wsUrl);client.versionInfo={Browser:'Buninu/0.2.0','Protocol-Version':'1.3'};
  expect(client.diagnostics()).toEqual({address:`127.0.0.1:${server.port}`,wsUrl,state:'open',browser:'Buninu/0.2.0',protocol:'1.3',pending:0});
  client.close();expect(client.diagnostics().state).toBe('closed');expect(client.diagnostics().wsUrl).toBe(wsUrl);
  expect(parseCommand('cdp ws')).toEqual({name:'cdp',arg:'ws'});
 }finally{client.close();server.stop(true);}
});
