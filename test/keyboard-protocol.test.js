import {test,expect} from 'bun:test';
import {KeyboardProtocol,KeyboardDispatch,parseKittyKey,localKeyText} from '../lib/keyboard-protocol.js';
import {parseInput} from '../lib/input.js';

test('Kitty modifiers retain all Ctrl/Alt/Shift/Super combinations and event types',()=>{
  for(let bits=0;bits<16;bits++)for(let event=1;event<=3;event++)for(const letter of ['w','f','x']) {
    const key=parseInput(`\x1b[${letter.charCodeAt(0)};${bits+1}:${event}u`);
    expect(key.modifiers).toBe((bits&1?8:0)|(bits&2?1:0)|(bits&4?2:0)|(bits&8?4:0));
    expect(key.eventType).toBe(event);expect(key.code).toBe('Key'+letter.toUpperCase());
    if(bits&14||event===3)expect(key.text).toBeUndefined();
  }
  expect(parseInput('\x1b[119;9u')).toMatchObject({key:'w',code:'KeyW',modifiers:4});
  expect(parseInput('\x1b[57444;9u')).toMatchObject({key:'Meta',code:'MetaLeft',modifiers:4});
  expect(parseInput('\x1b[57450;1:3u')).toMatchObject({key:'Meta',code:'MetaRight',eventType:3});
  expect(parseInput('\x1b[1;9:2D')).toMatchObject({key:'ArrowLeft',modifiers:4,eventType:2});
  expect(parseInput('\x1b[2;3~')).toMatchObject({key:'Insert',modifiers:1});
  expect(parseInput('\x1b[11;2:3~')).toMatchObject({key:'F1',modifiers:8,eventType:3});
  for(const seq of ['\x1b[11~','\x1b[P','\x1b[1P'])expect(parseInput(seq)).toMatchObject({key:'F1',modifiers:0});
  expect(parseInput('\x1b[57399u')).toMatchObject({key:'0',code:'Numpad0',location:3});
});

test('Kitty Unicode and shifted characters do not go through legacy Option remapping',()=>{
  expect(parseInput('\x1b[229u')).toMatchObject({key:'å',text:'å',modifiers:0});
  expect(parseInput('\x1b[97;2u')).toMatchObject({key:'A',text:'A',code:'KeyA'});
  expect(parseInput('\x1b[97;65u')).toMatchObject({key:'A',text:'A'});
  expect(parseInput('\x1b[97;66u')).toMatchObject({key:'a',text:'a'});
  expect(parseInput('\x1b[49;2u')).toMatchObject({key:'!',code:'Digit1',text:'!'});
  expect(parseInput('\x1b[128512u').text).toBe('😀');
  expect(localKeyText(parseInput('\x1b[101;5u'))).toBe('\x05');
  expect(localKeyText(parseInput('\x1b[119;9u'))).toBe('');
  expect(localKeyText(parseInput('\x1b[13u'))).toBe('\r');
  expect(localKeyText(parseInput('\x1b[97;1:3u'))).toBe('');
});

test('negotiation preserves the outer stack, frames split UTF-8/CSI and coalesced reports',()=>{
  const output=[],tokens=[];
  const k=new KeyboardProtocol({write:s=>output.push(s),onInput:s=>tokens.push(s)});
  k.start();expect(output).toEqual(['\x1b[?u']);
  k.feed('\x1b[?');k.feed('0u');expect(output.at(-1)).toBe('\x1b[>11u\x1b[?u');
  k.feed('\x1b[?11u\x1b[119;9u\x1b[119;1:3u\x1b[<0;20;30M');
  expect(k.flags).toBe(11);
  expect(tokens).toEqual(['\x1b[119;9u','\x1b[119;1:3u','\x1b[<0;20;30M']);
  for(const byte of Buffer.from('中文😀'))k.feed(Buffer.from([byte]));
  expect(tokens.slice(3).join('')).toBe('中文😀');
  k.stop();k.stop();expect(output.filter(s=>s==='\x1b[<u')).toHaveLength(1);
  k.feed('\x1b[?11u');expect(k.flags).toBe(0);
});

test('unsupported terminals stay legacy; a late probe reply never enables Kitty',async()=>{
  const output=[],tokens=[];
  const k=new KeyboardProtocol({write:s=>output.push(s),onInput:s=>tokens.push(s),timeout:15,escapeTimeout:5});
  k.start();await Bun.sleep(25);k.feed('\x1b[?0uabc\r');k.feed('\x1b');await Bun.sleep(10);
  expect(output).toEqual(['\x1b[?u']);expect(tokens).toEqual(['abc','\r','\x1b']);k.stop();
  expect(output).toEqual(['\x1b[?u']);
});

test('CDP forwards real press/repeat/release, suppresses orphan releases and restores held keys',async()=>{
  const calls=[],d=new KeyboardDispatch({send:async(method,p)=>calls.push(p)});
  for(const seq of ['\x1b[119;9u','\x1b[119;9:2u','\x1b[119;1:3u'])await d.send(parseInput(seq),true);
  expect(calls.map(x=>x.type)).toEqual(['rawKeyDown','rawKeyDown','keyUp']);
  expect(calls[0].modifiers).toBe(4);expect(calls[1].autoRepeat).toBe(true);
  await d.send(parseInput('\x1b[101;1:3u'),true);expect(calls).toHaveLength(3);
  await d.send(parseInput('\x1b[97u'),true);
  expect(calls.slice(3).map(x=>x.type)).toEqual(['rawKeyDown','char']);
  await d.releaseAll();expect(calls.at(-1)).toMatchObject({type:'keyUp',key:'a',modifiers:0});
  calls.length=0;await d.send(parseInput('\x1b[119;9u'),false);
  expect(calls.map(x=>x.type)).toEqual(['rawKeyDown','keyUp']);
});
