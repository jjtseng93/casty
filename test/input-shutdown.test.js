import {test,expect} from 'bun:test';

for(const mode of ['shutdown-reject','shutdown-resolve','live-reject']) {
 test(`pending input lifecycle: ${mode}`,async()=>{
  const script=`
    import assert from 'node:assert/strict';
    import {EventEmitter} from 'node:events';
    import {startInputHandling,stopInputHandling} from ${JSON.stringify(new URL('../lib/input.js',import.meta.url).href)};
    const errors=[],inputs=[];let captures=0,resolveInput,rejectInput;
    process.stdout.write=()=>true;
    console.error=(...args)=>errors.push(args.join(' '));
    process.stdin.setRawMode=()=>{};process.stdin.resume=()=>process.stdin;
    const client=new EventEmitter();
    client.send=(method,params)=>{
      if(method==='Page.getNavigationHistory')return Promise.resolve({currentIndex:0,entries:[]});
      if(method==='Input.insertText'){
        inputs.push(params.text);
        if(inputs.length===1)return new Promise((resolve,reject)=>{resolveInput=resolve;rejectInput=reject;});
      }
      return Promise.resolve({});
    };
    const bar=startInputHandling(client,10,20,1,{},()=>{},()=>captures++);
    bar.history.file=null;
    process.stdin.emit('data',Buffer.from('a'));
    process.stdin.emit('data',Buffer.from('b'));
    await Bun.sleep(10);
    assert.deepEqual(inputs,['a']);
    const mode=${JSON.stringify(mode)};
    if(mode!=='live-reject')stopInputHandling();
    if(mode==='shutdown-resolve')resolveInput({});
    else rejectInput(new Error('Connection closed'));
    await Bun.sleep(30);
    if(mode==='live-reject'){
      assert.deepEqual(inputs,['a','b']);
      assert.deepEqual(errors,['casty: input error: Connection closed']);
    }else{
      assert.deepEqual(inputs,['a']);assert.deepEqual(errors,[]);assert.equal(captures,0);
    }
    stopInputHandling();process.exit(0);
  `;
  const child=Bun.spawn([process.execPath,'-e',script],{stdout:'pipe',stderr:'pipe'});
  const errors=new Response(child.stderr).text();
  const status=await child.exited;const stderr=await errors;
  if(status)console.error(stderr);
  expect(status).toBe(0);expect(stderr).toBe('');
 });
}
