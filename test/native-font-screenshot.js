// Manual visual check: capture only the window created by this process.
import {dlopen,ptr} from 'bun:ffi';
import {runWin32} from '../lib/win32.js';
const u=dlopen('user32.dll',{
 FindWindowW:{args:['ptr','ptr'],returns:'ptr'},GetWindowRect:{args:['ptr','ptr'],returns:'bool'},
 GetDC:{args:['ptr'],returns:'ptr'},ReleaseDC:{args:['ptr','ptr'],returns:'i32'},
 PrintWindow:{args:['ptr','ptr','u32'],returns:'bool'},PostMessageW:{args:['ptr','u32','u64','i64'],returns:'bool'}
});
const g=dlopen('gdi32.dll',{
 CreateCompatibleDC:{args:['ptr'],returns:'ptr'},CreateCompatibleBitmap:{args:['ptr','i32','i32'],returns:'ptr'},
 SelectObject:{args:['ptr','ptr'],returns:'ptr'},GetDIBits:{args:['ptr','ptr','u32','u32','ptr','ptr','u32'],returns:'i32'},
 DeleteObject:{args:['ptr'],returns:'bool'},DeleteDC:{args:['ptr'],returns:'bool'}
});
const name=Buffer.from('CastyWin32-'+process.pid+'\0','utf16le');
let capture;
const timer=setTimeout(()=>{capture=(async()=>{
 const hwnd=u.symbols.FindWindowW(ptr(name),0);if(!hwnd)throw Error('Window not found');
 try{
 const rect=new Int32Array(4);u.symbols.GetWindowRect(hwnd,ptr(rect));const width=rect[2]-rect[0],height=rect[3]-rect[1];
 const dc=u.symbols.GetDC(hwnd),mem=g.symbols.CreateCompatibleDC(dc),bitmap=g.symbols.CreateCompatibleBitmap(dc,width,height),old=g.symbols.SelectObject(mem,bitmap);
 try{
 if(!u.symbols.PrintWindow(hwnd,mem,0))throw Error('PrintWindow failed');
 g.symbols.SelectObject(mem,old);
 const info=Buffer.alloc(40);info.writeUInt32LE(40,0);info.writeInt32LE(width,4);info.writeInt32LE(-height,8);info.writeUInt16LE(1,12);info.writeUInt16LE(32,14);
 const pixels=Buffer.alloc(width*height*4);if(!g.symbols.GetDIBits(mem,bitmap,0,height,ptr(pixels),ptr(info),0))throw Error('GetDIBits failed');
 const header=Buffer.alloc(14);header.write('BM');header.writeUInt32LE(54+pixels.length,2);header.writeUInt32LE(54,10);
 await Bun.write(process.argv[2],await new Bun.Image(Buffer.concat([header,info,pixels])).png().toBuffer());
 console.log('Captured',process.argv[2]);
 }finally{g.symbols.DeleteObject(bitmap);g.symbols.DeleteDC(mem);u.symbols.ReleaseDC(hwnd,dc);}
 }finally{u.symbols.PostMessageW(hwnd,16,0,0);}
 })();},3500);
try{await runWin32(['https://example.com']);await capture;}finally{clearTimeout(timer);u.close();g.close();}
