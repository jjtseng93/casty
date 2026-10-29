import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {launchChrome} from '../lib/chrome.js';
import {setupPage} from '../lib/browser.js';
import {attachPage} from '../lib/attach.js';
import {CDPClient} from '../lib/cdp.js';
import {cdpJson} from '../lib/cdp-http.js';

async function until(predicate) {
  for(let i=0;i<300;i++){if(predicate())return;await Bun.sleep(10);}
  throw Error('test fixture did not become ready');
}

test('cancel a browser that never announces CDP, without a startup deadline',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'casty-cancel-'));
  const script=join(dir,'engine.js'),pidFile=join(dir,'pid');
  await Bun.write(script,`await Bun.write(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  const previous=process.env.CASTY_BROWSER,abort=new AbortController();
  let pid;
  try {
    process.env.CASTY_BROWSER=script;
    const pending=launchChrome({userDataDir:dir,signal:abort.signal}).catch(e=>e);
    await until(()=>existsSync(pidFile));pid=Number(readFileSync(pidFile,'utf8'));
    abort.abort(new Error('window closed'));
    expect((await pending).message).toBe('window closed');
    await until(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
  } finally {
    abort.abort();if(pid)try{process.kill(pid);}catch{}
    if(previous===undefined)delete process.env.CASTY_BROWSER;else process.env.CASTY_BROWSER=previous;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('abort interrupts discovery even if the HTTP response never arrives',async()=>{
  const server=Bun.serve({port:0,fetch:()=>new Promise(()=>{})});
  const abort=new AbortController();
  try {
    const pending=cdpJson(`http://127.0.0.1:${server.port}`,{signal:abort.signal}).catch(e=>e);
    await Bun.sleep(20);abort.abort(new Error('window closed'));
    expect((await pending).message).toBe('window closed');
  }finally{server.stop(true);}
});

for(const attach of [false,true])test(`abort closes ${attach?'attach':'owned'} CDP during page setup`,async()=>{
  let received=false,closed=false;
  const server=Bun.serve({port:0,fetch(req,s){
    const path=new URL(req.url).pathname;
    if(path==='/devtools/page/test'){s.upgrade(req);return;}
    if(path==='/json/version')return Response.json({Browser:'Buninu/0.6.0'});
    const target={type:'page',webSocketDebuggerUrl:`ws://127.0.0.1:${s.port}/devtools/page/test`};
    return Response.json(path==='/json/list'?[target]:target);
  },websocket:{message(){received=true;},close(){closed=true;}}});
  const abort=new AbortController();
  try{
    const pending=(attach?attachPage(String(server.port),{signal:abort.signal}):setupPage({port:server.port},{width:100,height:100,signal:abort.signal})).catch(e=>e);
    await until(()=>received);abort.abort();
    expect(await pending).toBeInstanceOf(Error);
    await until(()=>closed);
  }finally{server.stop(true);}
});

test('abort interrupts a WebSocket handshake and an unresponsive stop command',async()=>{
  const handshakeServer=Bun.serve({port:0,fetch:()=>new Promise(()=>{})});
  const handshakeAbort=new AbortController(),handshakeClient=new CDPClient();
  try{
    const pending=handshakeClient.connect(`ws://127.0.0.1:${handshakeServer.port}`,{signal:handshakeAbort.signal}).catch(e=>e);
    await Bun.sleep(20);handshakeAbort.abort();expect(await pending).toBeInstanceOf(Error);
  }finally{handshakeClient.close();handshakeServer.stop(true);}
  let received=false;
  const server=Bun.serve({port:0,fetch(r,s){if(s.upgrade(r))return;return new Response('');},websocket:{message(){received=true;}}});
  const abort=new AbortController(),client=new CDPClient();
  try{
    await client.connect(`ws://127.0.0.1:${server.port}`,{signal:abort.signal});
    const pending=client.send('Page.stopScreencast',{},20).catch(e=>e);
    await until(()=>received);await Bun.sleep(40);abort.abort();
    expect(await pending).toBeInstanceOf(Error);
    expect(client.diagnostics().pending).toBe(0);
  }finally{client.close();server.stop(true);}
});
