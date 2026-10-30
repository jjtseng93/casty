import {test,expect} from 'bun:test';
import {win32Key} from '../lib/win32-key.js';
const bits=(scan,extended=false)=>BigInt(scan)<<16n|(extended?1n<<24n:0n);
test('Win32 separates layout characters from physical codes',()=>{
 expect(win32Key(0xba,bits(0x27),0,';')).toMatchObject({key:';',code:'Semicolon'});
 expect(win32Key(65,bits(0x1e),8,'A')).toMatchObject({key:'A',code:'KeyA'});
 expect(win32Key(65,bits(0x10),0,'a')).toMatchObject({key:'a',code:'KeyQ'});
 expect(win32Key(0xde,bits(0x28),0,'Dead').key).toBe('Dead');
 expect(win32Key(0xff,0n,0).key).toBe('Unidentified');
});
test('Win32 distinguishes keypad and left/right modifier locations',()=>{
 expect(win32Key(96,bits(0x52),0,'0')).toMatchObject({key:'0',code:'Numpad0',location:3});
 expect(win32Key(13,bits(0x1c,true),0)).toMatchObject({key:'Enter',code:'NumpadEnter',location:3});
 expect(win32Key(17,bits(0x1d,true),2)).toMatchObject({key:'Control',code:'ControlRight',location:2});
 expect(win32Key(16,bits(0x2a),8)).toMatchObject({key:'Shift',code:'ShiftLeft',location:1});
});
