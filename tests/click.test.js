import {test,expect} from 'bun:test';
import {dispatchClick} from '../lib/click.js';

test('a rejected DOM marker does not suppress a CDP click',async()=>{
  const calls=[];
  const client={async send(method,params){
    calls.push({method,params});
    if(method==='Runtime.evaluate')throw Error('window is not defined');
    return {};
  }};
  await dispatchClick(client,120,80,{button:'right',clickCount:2});
  expect(calls.filter(c=>c.method==='Input.dispatchMouseEvent').map(c=>c.params)).toEqual([
    {type:'mousePressed',x:120,y:80,button:'right',clickCount:2,buttons:2},
    {type:'mouseReleased',x:120,y:80,button:'right',clickCount:2,buttons:0},
  ]);
});

test('actual input failures still propagate',async()=>{
  const client={async send(method){if(method==='Input.dispatchMouseEvent')throw Error('Input disconnected');return {};}};
  await expect(dispatchClick(client,1,2)).rejects.toThrow('Input disconnected');
});
