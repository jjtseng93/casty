import {test,expect} from 'bun:test';
import {UrlBar} from '../lib/urlbar.js';
import {splitBrowserArgs} from '../lib/chrome.js';

test('command entry stays in the loading slot, with stable width and loading color',()=>{
 const bar=new UrlBar({commandEntry:true});bar.currentUrl='example.com';
 const plain=s=>s.replace(/\x1b\[[0-9;]*m/g,'');
 const idle=bar._displayLine(30);bar.loading=true;const loading=bar._displayLine(30);
 expect(plain(idle)).toBe(' @ example.com'.padEnd(30));expect(plain(loading)).toBe(plain(idle));
 expect(loading).not.toBe(idle);expect(new UrlBar()._displayLine(10)).not.toContain('@');
});

test('no-shortcuts remains a frontend flag with URL, explicit -- and Bun-stripped --',async()=>{
 const own=new Set(['--no-shortcuts','--help']);
 expect(splitBrowserArgs(['--no-shortcuts','--linear-dmabuf'],own)).toEqual({args:['--no-shortcuts'],browserArgs:['--linear-dmabuf']});
 expect(splitBrowserArgs(['--no-shortcuts','about:blank','--','--poll-interval=1'],own)).toEqual({args:['--no-shortcuts','about:blank'],browserArgs:['--poll-interval=1']});
 const child=Bun.spawn([process.execPath,new URL('../index.js',import.meta.url).pathname,'--no-shortcuts','--help'],{stdout:'pipe',stderr:'pipe'});
 expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toContain('--no-shortcuts');
});

test('no-shortcuts forwards all page keys; @ opens empty commands, URL editing and q still work',async()=>{
 const url=new URL('../lib/input.js',import.meta.url).href;
 const script=`
 import assert from 'node:assert/strict';
 import {EventEmitter} from 'node:events';
 import {startInputHandling,stopInputHandling} from ${JSON.stringify(url)};
 const output=[],events=[];let quits=0;
 process.stdout.write=s=>{output.push(String(s));return true;};
 process.stdin.setRawMode=()=>{};process.stdin.resume=()=>process.stdin;
 process.on('SIGINT',()=>quits++);
 const client=new EventEmitter();client.send=async(method,params)=>{events.push({method,params});return {};};
 const bindings={'ctrl+q':'quit','ctrl+e':'command','ctrl+v':'paste','alt+c':'copy','alt+l':'url_bar','ctrl+u':'back','ctrl+k':'forward','alt+left':'back','ctrl+l':'hints','alt+f':'hints'};
 const bar=startInputHandling(client,10,20,1,bindings,()=>{},null,{}, {noShortcuts:true});
 bar.history.file=null;bar.setUrl('https://example.com/');
 const feed=async s=>{process.stdin.emit('data',Buffer.from(s));await Bun.sleep(15);};
 const click=async col=>{await feed('\\x1b[<0;'+col+';1M');await feed('\\x1b[<0;'+col+';1m');};
 const keys=()=>events.filter(e=>e.method==='Input.dispatchKeyEvent').map(e=>e.params);
 await feed('\\x11\\x05\\x16');assert.equal(quits,0);assert.equal(bar.editing,false);
 assert.deepEqual(keys().filter(k=>k.type==='rawKeyDown').map(k=>k.key),['q','e','v']);events.length=0;
 await feed('\\x1b[?0u\\x1b[?11u');
 for(const [cp,mods] of [[113,5],[101,5],[118,5],[99,3],[108,3],[117,5],[107,5],[108,5],[102,3]])await feed('\\x1b['+cp+';'+mods+'u\\x1b['+cp+';1:3u');
 await feed('\\x1b[1;3D\\x1b[1;1:3D');
 assert.equal(quits,0);assert.equal(bar.editing,false);assert.equal(keys().filter(k=>k.type==='rawKeyDown').length,10);
 assert.ok(events.every(e=>e.method==='Input.dispatchKeyEvent'));events.length=0;
 await click(8);assert.equal(bar.mode,'url');assert.equal(bar.text,'https://example.com/');
 await feed('\\x1b[9u\\x1b[9;1:3u');assert.equal(bar.mode,'cmd');assert.equal(bar.text,'https://example.com/');
 await feed('\\t');assert.equal(bar.mode,'url');assert.equal(bar.selectedText,'');bar.selectAll=true;
 await feed('\\x1b[99;3u\\x1b[99;1:3u');assert.ok(output.includes('\\x1b]52;c;'+Buffer.from(bar.text).toString('base64')+'\\x07'));
 await feed('\\x1b[118;5u');await feed('\\x1b]52;c;'+Buffer.from('replaced').toString('base64')+'\\x07');await feed('\\x1b[118;1:3u');assert.equal(bar.text,'replaced');
 await feed('\\x1b[<0;5;1M');await feed('\\x1b[<32;8;1M');await feed('\\x1b[<0;8;1m');
 assert.equal(bar.selectedText,'epl');
 await feed('\\x1b[99;3u\\x1b[99;1:3u');assert.ok(output.includes('\\x1b]52;c;ZXBs\\x07'));
 await feed('\\x1b[1;2C\\x1b[1;1:3C');assert.equal(bar.selectedText,'epla');
 await feed('\\x1b[118;5u');await feed('\\x1b]52;c;IQ==\\x07');await feed('\\x1b[118;1:3u');assert.equal(bar.text,'r!ced');
 await feed('\\x1b[118;5u');await feed('\\x1b]52;c;WA==\\x07');await feed('\\x1b[118;1:3u');assert.equal(bar.text,'r!Xced');
 await feed('\\x1b[27u\\x1b[27;1:3u');assert.equal(bar.editing,false);
 await click(2);assert.equal(bar.mode,'cmd');assert.equal(bar.text,'');assert.equal(bar.editing,true);
 await feed('\\x1b[97u\\x1b[97;1:3u');await feed('\\x1b[27u\\x1b[27;1:3u');
 await click(2);assert.equal(bar.text,'');
 await feed('\\x1b[113u\\x1b[113;1:3u\\x1b[13u\\x1b[13;1:3u');
 assert.equal(quits,1);assert.equal(keys().length,0);
 stopInputHandling();process.exit(0);
 `;
 const child=Bun.spawn([process.execPath,'-e',script],{stdout:'pipe',stderr:'pipe'});const errors=new Response(child.stderr).text();
 const status=await child.exited;const stderr=await errors;if(status)console.error(stderr);
 expect(status).toBe(0);expect(stderr).toBe('');
},10000);
