// Explicit Windows smoke check; opens and closes only this process's window.
import {dlopen,ptr} from 'bun:ffi';
import {runWin32} from '../lib/win32.js';
const api=dlopen('user32.dll',{FindWindowW:{args:['ptr','ptr'],returns:'ptr'},PostMessageW:{args:['ptr','u32','u64','i64'],returns:'bool'}});
const name=Buffer.from('CastyWin32-'+process.pid+'\0','utf16le');
const timer=setTimeout(()=>{
 const hwnd=api.symbols.FindWindowW(ptr(name),0);
 if(!hwnd)throw Error('Native window not found');
 api.symbols.PostMessageW(hwnd,16,0,0);
},4000);
try{console.log('Win32 exit:',await runWin32(['about:blank']));}
finally{clearTimeout(timer);api.close();}
