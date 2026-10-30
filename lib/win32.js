import {dlopen,JSCallback,ptr} from 'bun:ffi';
import {consumeNativeFrame} from './native-frame.js';
import {startBrowser,setupPage} from './browser.js';
import {startInputHandling} from './input.js';
import {loadKeyBindings,toKeyName} from './keys.js';
import {attachPage,readAttachViewport} from './attach.js';
import {win32Key} from './win32-key.js';
import {createNativeCapture,createNativeAttachPolicy} from './native-capture.js';
import {loadConfig} from './config.js';
import {UrlBar,toURL} from './urlbar.js';

const WM_DESTROY=2,WM_SIZE=5,WM_PAINT=15,WM_CLOSE=16,WM_KEYDOWN=0x100,WM_KEYUP=0x101,WM_CHAR=0x102,WM_MOUSEMOVE=0x200,WM_LBUTTONDOWN=0x201,WM_LBUTTONUP=0x202,WM_LBUTTONDBLCLK=0x203,WM_RBUTTONDOWN=0x204,WM_RBUTTONUP=0x205,WM_MOUSEWHEEL=0x20a;
const VK_TAB=9,VK_RETURN=13,VK_ESCAPE=27,VK_UP=38,VK_DOWN=40,VK_CONTROL=0x11,VK_MENU=0x12,PM_REMOVE=1,SW_SHOW=5,CW_USEDEFAULT=0x80000000,WS_OVERLAPPEDWINDOW=0x00cf0000,WS_CHILD=0x40000000,WS_VISIBLE=0x10000000,WS_EX_CLIENTEDGE=0x200,ES_AUTOHSCROLL=0x80,GWLP_WNDPROC=-4,EM_SETSEL=0x00b1,DIB_RGB_COLORS=0,SRCCOPY=0x00cc0020,IDC_ARROW=32512,BAR_HEIGHT=30;
const utf16=s=>Buffer.from(s+'\0','utf16le'),signed16=n=>(n&0x8000)?n-0x10000:n,low=n=>Number(BigInt.asUintN(16,BigInt(n))),high=n=>Number(BigInt.asUintN(16,BigInt(n)>>16n));

export async function runWin32(frontendArgs,browserArgs=[]){
 if(process.platform!=='win32'){console.error('casty: --win32 is available only on Windows');return 2;}
 const attachIndex=frontendArgs.indexOf('--attach');
 const endpoint=attachIndex<0?null:frontendArgs[attachIndex+1];
 const args=frontendArgs.filter((a,i)=>!['--readonly','--no-shortcuts'].includes(a)&&i!==attachIndex&&(attachIndex<0||i!==attachIndex+1));
 if(attachIndex>=0&&(!endpoint||endpoint.startsWith('-')))throw Error('--attach requires an endpoint');
 if(endpoint&&(args.length||browserArgs.length))throw Error('--attach does not accept navigation URL or browser flags');
 const initialUrl=endpoint?'':toURL(args[0]||loadConfig().homeUrl);
 const noShortcuts=frontendArgs.includes('--no-shortcuts'),readonly=frontendArgs.includes('--readonly');
 const lifetime=new AbortController();
 const state={width:1024,height:690,pixels:null,frameWidth:0,frameHeight:0,client:null,closed:false,currentUrl:initialUrl,editing:false,mode:'url',readOnly:false,zoom:1};
 const user32=dlopen('user32.dll',{
  GetKeyboardState:{args:['ptr'],returns:'bool'},GetKeyboardLayout:{args:['u32'],returns:'ptr'},
  ToUnicodeEx:{args:['u32','u32','ptr','ptr','i32','u32','ptr'],returns:'i32'},
  SystemParametersInfoW:{args:['u32','u32','ptr','u32'],returns:'bool'},
  GetDC:{args:['ptr'],returns:'ptr'},ReleaseDC:{args:['ptr','ptr'],returns:'i32'},FillRect:{args:['ptr','ptr','ptr'],returns:'i32'},
  RegisterClassExW:{args:['ptr'],returns:'u16'},CreateWindowExW:{args:['u32','ptr','ptr','u32','i32','i32','i32','i32','ptr','ptr','ptr','ptr'],returns:'ptr'},DefWindowProcW:{args:['ptr','u32','u64','i64'],returns:'i64'},CallWindowProcW:{args:['ptr','ptr','u32','u64','i64'],returns:'i64'},SetWindowLongPtrW:{args:['ptr','i32','ptr'],returns:'ptr'},
  ShowWindow:{args:['ptr','i32'],returns:'bool'},UpdateWindow:{args:['ptr'],returns:'bool'},MoveWindow:{args:['ptr','i32','i32','i32','i32','bool'],returns:'bool'},SetWindowTextW:{args:['ptr','ptr'],returns:'bool'},GetWindowTextLengthW:{args:['ptr'],returns:'i32'},GetWindowTextW:{args:['ptr','ptr','i32'],returns:'i32'},SetFocus:{args:['ptr'],returns:'ptr'},GetKeyState:{args:['i32'],returns:'i16'},SendMessageW:{args:['ptr','u32','u64','i64'],returns:'i64'},
  BeginPaint:{args:['ptr','ptr'],returns:'ptr'},EndPaint:{args:['ptr','ptr'],returns:'bool'},InvalidateRect:{args:['ptr','ptr','bool'],returns:'bool'},PeekMessageW:{args:['ptr','ptr','u32','u32','u32'],returns:'bool'},TranslateMessage:{args:['ptr'],returns:'bool'},DispatchMessageW:{args:['ptr'],returns:'i64'},PostQuitMessage:{args:['i32'],returns:'void'},DestroyWindow:{args:['ptr'],returns:'bool'},LoadCursorW:{args:['ptr','ptr'],returns:'ptr'},SetCapture:{args:['ptr'],returns:'ptr'},ReleaseCapture:{args:[],returns:'bool'},ScreenToClient:{args:['ptr','ptr'],returns:'bool'},
 });
 const kernel32=dlopen('kernel32.dll',{GetModuleHandleW:{args:['ptr'],returns:'ptr'}}),gdi32=dlopen('gdi32.dll',{SelectObject:{args:['ptr','ptr'],returns:'ptr'},GetTextMetricsW:{args:['ptr','ptr'],returns:'bool'},CreateFontIndirectW:{args:['ptr'],returns:'ptr'},GetStockObject:{args:['i32'],returns:'ptr'},DeleteObject:{args:['ptr'],returns:'bool'},StretchDIBits:{args:['ptr','i32','i32','i32','i32','i32','i32','i32','i32','ptr','ptr','u32','u32'],returns:'i32'}});

 const hInstance=kernel32.symbols.GetModuleHandleW(0),className=utf16('CastyWin32-'+process.pid);
 const PREFIX_WIDTH=40,bindings=loadKeyBindings();
 let hwnd=0,edit=0,prefixWindow=0,oldEditProc=0,controller=null,browser=null,client=null,cast=null;
 let updatingEdit=false,composing=false,resizeTimer,latestFrame=null,reading=false;
 let editHeight=BAR_HEIGHT,releasingCapture=false;
 const layoutEdit=()=>user32.symbols.MoveWindow(edit,PREFIX_WIDTH,Math.floor((BAR_HEIGHT-editHeight)/2),Math.max(1,state.width-PREFIX_WIDTH),editHeight,true);
 let zoom=Number(process.env.CASTY_ZOOM)>0?Number(process.env.CASTY_ZOOM):1;
 let viewport={width:state.width/zoom,height:state.height/zoom};
 const bar=new UrlBar({commandEntry:noShortcuts});bar.native=true;
 const setText=(win,text)=>user32.symbols.SetWindowTextW(win,ptr(utf16(text)));
 const getText=()=>{const n=user32.symbols.GetWindowTextLengthW(edit),b=new Uint16Array(n+1);user32.symbols.GetWindowTextW(edit,ptr(b),n+1);return Buffer.from(b.buffer,0,n*2).toString('utf16le');};
 const syncEdit=()=>{
  if(updatingEdit||!bar.editing||composing)return;
  bar.text=getText();
  const start=new Uint32Array(1),end=new Uint32Array(1);
  user32.symbols.SendMessageW(edit,0xb0,BigInt(ptr(start)),BigInt(ptr(end)));
  bar.cursor=[...bar.text.slice(0,end[0])].length;
  bar.selectionAnchor=start[0]===end[0]?null:[...bar.text.slice(0,start[0])].length;
 };
 bar.render=()=>{
  bar._dirty=false;if(!edit||state.closed||composing)return;
  updatingEdit=true;
  try{
   // Terminal padding belongs to cells; the native label centers the glyphs.
   setText(prefixWindow,(bar.editing?bar.prompt:bar.displayPrefix()).trim());
   const text=bar.editing?bar.text:bar._status||bar.currentUrl;
   if(getText()!==text)setText(edit,text);
   if(bar.editing){
    const chars=[...bar.text],range=bar.selectionRange;
    const start=chars.slice(0,range?range[0]:bar.cursor).join('').length;
    const end=chars.slice(0,range?range[1]:bar.cursor).join('').length;
    user32.symbols.SendMessageW(edit,EM_SETSEL,start,end);
   }
  }finally{updatingEdit=false;}
 };
 bar.renderIfDirty=()=>{if(bar._dirty||bar.loading)bar.render();};
 const originalStart=bar.startEditing.bind(bar);
 bar.startEditing=options=>{const p=originalStart(options);user32.symbols.SetFocus(edit);return p;};
 const originalFinish=bar._finishEditing.bind(bar);
 bar._finishEditing=value=>{originalFinish(value);if(!state.closed)user32.symbols.SetFocus(hwnd);};
 const refresh=()=>cast?.forceCapture();
 const closeSession=()=>{
  if(state.closed)return;
  state.closed=true;
  cast?.close();controller?.dispose();
  // Best effort only: neither a stalled engine nor a remote attach peer may
  // hold local shutdown hostage. Closing CDP cancels its retry/backoff loops.
  if(client)void client.send('Page.stopScreencast',{},1000,{retry:false}).catch(()=>{});
  lifetime.abort();
  client?.close();browser?.proc?.kill();
 };
 const quit=()=>{closeSession();if(hwnd)user32.symbols.DestroyWindow(hwnd);};
 const executeAction=action=>controller?.execAction(action).catch(error=>{
  if(!state.closed)bar.showTemporaryStatus(error.message);
 });
 const clipboardWrite=async text=>{
  const p=Bun.spawn(['powershell.exe','-NoProfile','-Command',"[Console]::InputEncoding=[System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],{stdin:'pipe',stdout:'ignore',stderr:'pipe'});
  p.stdin.write(text);p.stdin.end();if(await p.exited)throw Error('Clipboard write failed');
 };
 const clipboardRead=async()=>{
  const p=Bun.spawn(['powershell.exe','-NoProfile','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::Write((Get-Clipboard -Raw))"],{stdout:'pipe',stderr:'pipe'});
  const text=await new Response(p.stdout).text();if(await p.exited)throw Error('Clipboard read failed');return text;
 };
 const release=async data=>{try{await consumeNativeFrame(data,{discard:true});}catch(e){if(e.code!=='ENOENT')console.error(e.message);}};
 const acceptFrame=data=>{if(latestFrame)void release(latestFrame);latestFrame=data;if(!reading)void pumpFrames();};
 async function pumpFrames(){
  reading=true;
  try{while(latestFrame){const data=latestFrame;latestFrame=null;const f=await consumeNativeFrame(data,{discard:state.closed});
   if(state.closed||latestFrame)continue;state.pixels=f.pixels;state.frameWidth=f.width;state.frameHeight=f.height;user32.symbols.InvalidateRect(hwnd,0,false);
  }}catch(e){if(!state.closed&&e.code!=='ENOENT')console.error('casty: frame:',e.message);}
  finally{reading=false;if(latestFrame)void pumpFrames();}
 }
 const modifiers=()=> (user32.symbols.GetKeyState(18)<0?1:0)|(user32.symbols.GetKeyState(17)<0?2:0)|(user32.symbols.GetKeyState(16)<0?8:0)|((user32.symbols.GetKeyState(91)<0||user32.symbols.GetKeyState(92)<0)?4:0);
 const consumed=new Set();let suppressChar=false,pendingSurrogate='';
 const keyState=new Uint8Array(256),keyText=new Uint16Array(8);
 const translateKey=(vk,l)=>{
  if(!user32.symbols.GetKeyboardState(ptr(keyState)))return '';
  // Ctrl shortcuts must retain their printable key, rather than U+0001 etc.
  // Preserve Ctrl+RightAlt for layouts using AltGr.
  if(!(keyState[0xa5]&128))for(const code of [17,0xa2,0xa3,18,0xa4,0xa5])keyState[code]=0;
  const n=user32.symbols.ToUnicodeEx(vk,Number((BigInt(l)>>16n)&255n),ptr(keyState),ptr(keyText),keyText.length,4,user32.symbols.GetKeyboardLayout(0));
  return n<0?'Dead':n>0?Buffer.from(keyText.buffer,0,Math.min(n,keyText.length)*2).toString('utf16le'):'';
 };
 const releaseInput=()=>{
  consumed.clear();suppressChar=false;pendingSurrogate='';
  void controller?.releaseNativeInput();
 };
 function keyEvent(msg,w,l,inEdit){
  const vk=Number(w),down=msg===0x100||msg===0x104,up=msg===0x101||msg===0x105;
  if(!controller)return false;
  if(down||up){
   const mods=modifiers(),info=win32Key(vk,l,mods,translateKey(vk,l));
   if(up)info.eventType=3;
   if(up){if(consumed.delete(vk)||!inEdit){void controller.dispatchNative('',info);return true;}return false;}
   suppressChar=false;
   if(composing)return false;
   syncEdit();
   const action=bindings[toKeyName(info)];
   // Native EDIT owns printable/IME text. Shared UrlBar owns editing keys.
   const localEdit=inEdit&&((mods&3&&!(user32.symbols.GetKeyState(0xa5)<0&&(mods&2)))||[8,9,13,27,35,36,37,38,39,40,46].includes(vk));
   if(!inEdit||localEdit){
    consumed.add(vk);
    const altGr=user32.symbols.GetKeyState(0xa5)<0&&(mods&2);
    suppressChar=Boolean(localEdit||(!noShortcuts&&action)||(mods&3&&!altGr)||[8,9,13,27].includes(vk));
    void controller.dispatchNative('',info);return true;
   }
  }
  if(msg===0x102||msg===0x106){
   if(suppressChar)return true;
   if(!inEdit){
    const unit=Number(w);
    if(unit>=0xd800&&unit<=0xdbff){pendingSurrogate=String.fromCharCode(unit);return true;}
    const text=(unit>=0xdc00&&unit<=0xdfff?pendingSurrogate:'')+String.fromCharCode(unit);
    pendingSurrogate='';
    void controller.dispatchNativeText(text);return true;
   }
  }
  return false;
 }
 const editProc=new JSCallback((win,msg,w,l)=>{
  if(msg===8&&![hwnd,edit,prefixWindow].includes(Number(w)))releaseInput(); // WM_KILLFOCUS
  if(msg===0x10d)composing=true;
  if(msg===0x10e){composing=false;setTimeout(syncEdit,0);}
  if(msg===WM_LBUTTONDOWN&&!bar.editing){void executeAction('url_bar');return 0;}
  if(msg===WM_LBUTTONDBLCLK&&bar.editing){
   syncEdit();const x=PREFIX_WIDTH+signed16(low(l));if(x<state.width/3)bar.historyDown();else if(x<state.width*2/3)bar.historyUp();else bar.handleInput('\r');return 0;
  }
  if(keyEvent(msg,w,l,true))return 0;
  const result=user32.symbols.CallWindowProcW(oldEditProc,win,msg,w,l);
  if(msg===WM_LBUTTONUP||msg===WM_CHAR||msg===WM_KEYUP)syncEdit();
  return result;
 },{args:['ptr','u32','u64','i64'],returns:'i64'});
 const mouse=(cb,x,y,release=false)=>{
  if(!controller)return;
  // 1px virtual cells; actual page coordinates are supplied by mapPointer.
  void controller.dispatchNative('\x1b[<'+cb+';'+(x+1)+';'+(y-BAR_HEIGHT+2)+(release?'m':'M'));
 };
 const wndProc=new JSCallback((win,msg,w,l)=>{
  if(msg===8&&![hwnd,edit,prefixWindow].includes(Number(w)))releaseInput(); // WM_KILLFOCUS
  if(msg===0x111){
   if(Number(l)===prefixWindow){syncEdit();if(bar.editing)bar.toggleMode();else void executeAction(bar.commandEntry||bar.disconnected?'command':'url_bar');user32.symbols.SetFocus(edit);return 0;}
   if(Number(l)===edit&&high(w)===0x300)syncEdit();
  }
  if(msg===0x1c&&!Number(w)){releaseInput();return 0;} // WM_ACTIVATEAPP
  if(msg===0x215&&!releasingCapture){releaseInput();return 0;} // Unexpected WM_CAPTURECHANGED
  if(msg===WM_PAINT){
   const ps=new Uint8Array(72),dc=user32.symbols.BeginPaint(win,ptr(ps));
   user32.symbols.FillRect(dc,ptr(new Int32Array([0,0,state.width,BAR_HEIGHT])),16); // COLOR_BTNFACE + 1
   if(state.pixels){
    const bmi=new ArrayBuffer(44),v=new DataView(bmi);v.setUint32(0,40,true);v.setInt32(4,state.frameWidth,true);v.setInt32(8,-state.frameHeight,true);v.setUint16(12,1,true);v.setUint16(14,32,true);
    const scale=endpoint?Math.min(state.width/state.frameWidth,state.height/state.frameHeight):null;
    const width=scale?Math.round(state.frameWidth*scale):state.width,height=scale?Math.round(state.frameHeight*scale):state.height;
    gdi32.symbols.StretchDIBits(dc,0,BAR_HEIGHT,width,height,0,0,state.frameWidth,state.frameHeight,ptr(state.pixels),ptr(bmi),DIB_RGB_COLORS,SRCCOPY);
   }user32.symbols.EndPaint(win,ptr(ps));return 0;
  }
  if(msg===WM_SIZE){if(Number(w)===1)return 0;state.width=Math.max(1,low(l));state.height=Math.max(1,high(l)-BAR_HEIGHT);if(edit)layoutEdit();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>state.resize?.(),100);return 0;}
  const x=signed16(low(l)),y=signed16(high(l)),mods=modifiers(),mouseMods=(mods&8?4:0)|(mods&1?8:0)|(mods&2?16:0);
  if(msg===WM_LBUTTONDOWN&&y<BAR_HEIGHT){if(!bar.editing)void executeAction('url_bar');else user32.symbols.SetFocus(edit);return 0;}
  if([WM_LBUTTONDOWN,WM_RBUTTONDOWN].includes(msg)){syncEdit();bar.cancelEditing();user32.symbols.SetFocus(win);user32.symbols.SetCapture(win);mouse((msg===WM_LBUTTONDOWN?0:2)+mouseMods,x,y);return 0;}
  if([WM_LBUTTONUP,WM_RBUTTONUP].includes(msg)){mouse((msg===WM_LBUTTONUP?0:2)+mouseMods,x,y,true);releasingCapture=true;try{user32.symbols.ReleaseCapture();}finally{releasingCapture=false;}return 0;}
  if(msg===WM_MOUSEMOVE){mouse((low(w)&1?32:low(w)&2?34:35)+mouseMods,x,y);return 0;}
  if(msg===WM_MOUSEWHEEL||msg===0x20e){
   const point=new Int32Array([x,y]);user32.symbols.ScreenToClient(win,ptr(point));
   const delta=signed16(high(w)),base=msg===WM_MOUSEWHEEL?(delta>0?64:65):(delta>0?67:66);
   for(let i=0;i<Math.max(1,Math.round(Math.abs(delta)/120));i++)mouse(base+mouseMods,point[0],point[1]);
   return 0;
  }
  if(keyEvent(msg,w,l,false))return 0;
  if(msg===WM_CLOSE){quit();return 0;}if(msg===WM_DESTROY){closeSession();user32.symbols.PostQuitMessage(0);return 0;}
  return user32.symbols.DefWindowProcW(win,msg,w,l);
 },{args:['ptr','u32','u64','i64'],returns:'i64'});
 const wc=new ArrayBuffer(80),v=new DataView(wc);v.setUint32(0,80,true);v.setBigUint64(8,BigInt(wndProc.ptr),true);v.setBigUint64(24,BigInt(hInstance),true);v.setBigUint64(40,BigInt(user32.symbols.LoadCursorW(0,IDC_ARROW)),true);v.setBigUint64(64,BigInt(ptr(className)),true);
 if(!user32.symbols.RegisterClassExW(ptr(wc)))throw Error('RegisterClassExW failed');
 hwnd=user32.symbols.CreateWindowExW(0,ptr(className),ptr(utf16('Casty')),WS_OVERLAPPEDWINDOW|0x02000000,CW_USEDEFAULT,CW_USEDEFAULT,state.width,state.height+BAR_HEIGHT,0,0,hInstance,0);
 if(!hwnd)throw Error('CreateWindowExW failed');
 // SS_NOTIFY | SS_CENTER | SS_CENTERIMAGE: clickable, centered on both axes.
 prefixWindow=user32.symbols.CreateWindowExW(0,ptr(utf16('STATIC')),ptr(utf16('')),WS_CHILD|WS_VISIBLE|0x100|0x1|0x200,0,0,PREFIX_WIDTH,BAR_HEIGHT,hwnd,0,hInstance,0);
 edit=user32.symbols.CreateWindowExW(WS_EX_CLIENTEDGE,ptr(utf16('EDIT')),ptr(utf16(initialUrl)),WS_CHILD|WS_VISIBLE|ES_AUTOHSCROLL,PREFIX_WIDTH,0,Math.max(1,state.width-PREFIX_WIDTH),BAR_HEIGHT,hwnd,0,hInstance,0);
 if(!edit||!prefixWindow)throw Error('CreateWindowExW controls failed');
 // Use the user's UI font instead of EDIT/STATIC's legacy SYSTEM_FONT.
 // NONCLIENTMETRICSW: 504 bytes, lfMessageFont is a LOGFONTW at offset 408.
 const metrics=Buffer.alloc(504);metrics.writeUInt32LE(metrics.length,0);
 const hasMetrics=user32.symbols.SystemParametersInfoW(0x29,metrics.length,ptr(metrics),0);
 if(hasMetrics)metrics.writeInt32LE(Math.round(metrics.readInt32LE(408)*1.15),408);
 const uiFont=hasMetrics?gdi32.symbols.CreateFontIndirectW(ptr(metrics.subarray(408,500))):0;
 const controlFont=uiFont||gdi32.symbols.GetStockObject(17); // DEFAULT_GUI_FONT fallback
 for(const control of [edit,prefixWindow])user32.symbols.SendMessageW(control,0x30,controlFont,1); // WM_SETFONT
 // Single-line EDIT cannot use EM_SETRECT. Center its measured line height,
 // including its two-pixel client edge on each side, within the toolbar.
 const fontDC=user32.symbols.GetDC(edit),textMetrics=Buffer.alloc(60);
 const previousFont=gdi32.symbols.SelectObject(fontDC,controlFont);
 if(gdi32.symbols.GetTextMetricsW(fontDC,ptr(textMetrics)))editHeight=Math.min(BAR_HEIGHT,textMetrics.readInt32LE(0)+4);
 gdi32.symbols.SelectObject(fontDC,previousFont);user32.symbols.ReleaseDC(edit,fontDC);
 layoutEdit();
 oldEditProc=user32.symbols.SetWindowLongPtrW(edit,GWLP_WNDPROC,editProc.ptr);
 user32.symbols.ShowWindow(hwnd,SW_SHOW);
 // Pump throughout startup/navigation, not just after the first page load.
 const message=new Uint8Array(48);
 const pump=setInterval(()=>{if(state.closed)return;for(let i=0;i<100&&user32.symbols.PeekMessageW(ptr(message),0,0,0,PM_REMOVE);i++){user32.symbols.TranslateMessage(ptr(message));user32.symbols.DispatchMessageW(ptr(message));}bar.renderIfDirty();},8);
 try{
  browser=endpoint?null:await startBrowser(zoom,browserArgs,{signal:lifetime.signal});
  const setup=endpoint?await attachPage(endpoint,{signal:lifetime.signal}):await setupPage(browser,{width:state.width,height:state.height,zoom,signal:lifetime.signal});
  client=setup.client;viewport={width:setup.cssWidth,height:setup.cssHeight};
  const mapPointer=(col,row)=>{
   const scale=endpoint?Math.min(state.width/viewport.width,state.height/viewport.height):zoom;
   const x=(col-1)/scale,y=(row-2)/scale;
   return x>=0&&y>=0&&x<viewport.width&&y<viewport.height?{x,y}:null;
  };
  cast=createNativeCapture({
   client,
   async update(){
    if(endpoint){viewport=await readAttachViewport(client);return;}
    viewport={width:Math.max(1,Math.round(state.width/zoom)),height:Math.max(1,Math.round(state.height/zoom))};
    await client.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:zoom,mobile:false});
   },
   frameOptions:()=>({...viewport,format:'bgra',onFrame:acceptFrame,idleRefreshInterval:endpoint?1000:0,
    capturePolicy:endpoint?createNativeAttachPolicy(client,next=>{viewport=next;}):undefined}),
   onError:e=>bar.showTemporaryStatus(e.message)
  });
  const resize=()=>cast.resize();
  state.resize=resize;
  controller=startInputHandling(client,1,1,1,bindings,refresh,endpoint?null:{get:()=>zoom,set:async factor=>{zoom=factor;await resize();}}, {},{
   noShortcuts,readonly,mapPointer,getCaptureFormat:()=> 'bgra',
   native:{urlBar:bar,clipboardRead,clipboardWrite,quit}
  });
  client.on('close',()=>bar.markDisconnected());
  await resize();
  if(!endpoint&&!state.closed)void client.send('Page.navigate',{url:initialUrl}).catch(e=>bar.showTemporaryStatus(e.message));
  while(!state.closed)await Bun.sleep(20);
 }catch(error){
  if(!lifetime.signal.aborted)throw error;
 }finally{
  closeSession();clearInterval(pump);clearTimeout(resizeTimer);clearInterval(bar._spinTimer);
  await cast?.drain();
  if(latestFrame){const data=latestFrame;latestFrame=null;await release(data);}
  while(reading)await Bun.sleep(1);
  // Destroy controls before freeing their callback; no calls on dead handles.
  if(hwnd)user32.symbols.DestroyWindow(hwnd);
  if(uiFont)gdi32.symbols.DeleteObject(uiFont);
  editProc.close();wndProc.close();user32.close();kernel32.close();gdi32.close();
 }
 return 0;
}
