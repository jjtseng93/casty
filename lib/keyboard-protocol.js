// Kitty keyboard protocol -> CDP. No terminal-specific key remapping.
// https://sw.kovidgoyal.net/kitty/keyboard-protocol/
import { StringDecoder } from 'node:string_decoder';

const special = new Map();
const add = (number, key, code = key, keyCode = 0, location = 0) =>
  special.set(number, { key, code, keyCode, location });
for (const [n,key,vk] of [[27,'Escape',27],[13,'Enter',13],[9,'Tab',9],[127,'Backspace',8],
  [57348,'Insert',45],[57349,'Delete',46],[57350,'ArrowLeft',37],[57351,'ArrowRight',39],
  [57352,'ArrowUp',38],[57353,'ArrowDown',40],[57354,'PageUp',33],[57355,'PageDown',34],
  [57356,'Home',36],[57357,'End',35],[57358,'CapsLock',20],[57359,'ScrollLock',145],
  [57360,'NumLock',144],[57361,'PrintScreen',44],[57362,'Pause',19],[57363,'ContextMenu',93]]) add(n,key,key,vk);
for (let i=0;i<35;i++) add(57364+i,`F${i+1}`,`F${i+1}`,112+i);
for (let i=0;i<10;i++) add(57399+i,String(i),`Numpad${i}`,96+i,3);
for (const [i,key,code,vk] of [[0,'.','Decimal',110],[1,'/','Divide',111],[2,'*','Multiply',106],
  [3,'-','Subtract',109],[4,'+','Add',107],[5,'Enter','Enter',13],[6,'=','Equal',187],[7,',','Comma',188]])
  add(57409+i,key,`Numpad${code}`,vk,3);
['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Insert','Delete','Clear']
  .forEach((key,i)=>add(57417+i,key,['Numpad4','Numpad6','Numpad8','Numpad2','Numpad9','Numpad3','Numpad7','Numpad1','Numpad0','NumpadDecimal','Numpad5'][i],0,3));
['MediaPlay','MediaPause','MediaPlayPause','MediaReverse','MediaStop','MediaFastForward','MediaRewind',
 'MediaTrackNext','MediaTrackPrevious','MediaRecord','AudioVolumeDown','AudioVolumeUp','AudioVolumeMute']
 .forEach((key,i)=>add(57428+i,key));
for (let side=0;side<2;side++) ['Shift','Control','Alt','Meta','Hyper','Meta'].forEach((key,i)=>
  add(57441+side*6+i,key,`${key}${side?'Right':'Left'}`,{Shift:16,Control:17,Alt:18,Meta:side?92:91}[key]||0,side+1));
add(57453,'AltGraph','AltRight',18,2);
const punctuation = { '`':['Backquote','~',192], '-':['Minus','_',189], '=':['Equal','+',187],
  '[':['BracketLeft','{',219], ']':['BracketRight','}',221], '\\':['Backslash','|',220],
  ';':['Semicolon',':',186], "'":['Quote','"',222], ',':['Comma','<',188], '.':['Period','>',190],
  '/':['Slash','?',191], ' ':['Space',' ',32] };
const tilde = {2:57348,3:57349,5:57354,6:57355,7:57356,8:57357,
  11:57364,12:57365,13:57366,14:57367,15:57368,17:57369,18:57370,19:57371,20:57372,21:57373,23:57374,24:57375};
const suffix = {A:57352,B:57353,C:57351,D:57350,H:57356,F:57357,P:57364,Q:57365,R:57366,S:57367};
export const kittyModifiers = bits => (bits&1?8:0)|(bits&2?1:0)|(bits&4?2:0)|(bits&(8|32)?4:0);

export function parseKittyKey(sequence) {
  const m=/^\x1b\[(\d*)(?::(\d*))?(?::(\d*))?(?:;(\d+)(?::([123]))?)?(?:;[\d:]+)?([u~ABCDHFPQS])$/.exec(sequence);
  if (!m) return null;
  const final=m[6];
  // Function keys share their CSI forms with legacy input. SS3 and raw
  // control bytes remain in the legacy parser.
  if(final!=='u' && final!=='~' && m[1] && m[1]!=='1')return null;
  const bits=Number(m[4]||1)-1;
  if (bits<0 || !Number.isSafeInteger(bits)) return null;
  const modifiers=kittyModifiers(bits), eventType=Number(m[5]||1);
  let number=Number(m[1]||1);
  if(final==='~')number=tilde[number];
  else if(final!=='u')number=suffix[final];
  let info=special.get(number), text;
  if (!info) {
    if (!Number.isInteger(number)||number<32||number>0x10ffff||(number>=0xd800&&number<=0xdfff)||
      (number>=57344&&number<=63743)) return null;
    const base=String.fromCodePoint(number);
    let key=base, code='',keyCode=0;
    if (/^[a-z]$/i.test(base)) {
      code='Key'+base.toUpperCase();keyCode=base.toUpperCase().charCodeAt(0);
      key=Boolean(bits&1)!==Boolean(bits&64)?base.toUpperCase():base;
    } else if (/^[0-9]$/.test(base)) {
      code='Digit'+base;keyCode=base.charCodeAt(0);if(bits&1)key=')!@#$%^&*('[Number(base)];
    } else if (punctuation[base]) {
      [code,,keyCode]=punctuation[base];if(bits&1)key=punctuation[base][1];
    }
    if (m[2] && (bits&1)) {
      const shifted=Number(m[2]);
      if(shifted>0x10ffff||(shifted>=0xd800&&shifted<=0xdfff))return null;
      key=String.fromCodePoint(shifted);
    }
    info={key,code,keyCode,location:0};text=key;
  } else if (info.key==='Enter') text='\r';
  else if (info.key==='Tab') text='\t';
  else if (info.key==='Backspace') text='\x08';
  else if ([...info.key].length===1) text=info.key;
  // Ctrl/Alt/Super combinations are key events, never inserted characters.
  if (bits&(2|4|8|16|32) || eventType===3) text=undefined;
  return {...info,modifiers,text,eventType,kitty:true};
}

// Translate only for casty's local text widgets. Never downgrade Super to Alt.
export function localKeyText(info) {
  if (info.eventType===3 || info.modifiers&5) return '';
  if (info.modifiers&8) {
    const suffix={ArrowUp:'A',ArrowDown:'B',ArrowRight:'C',ArrowLeft:'D',Home:'H',End:'F'}[info.key];
    if(suffix)return `\x1b[1;${info.modifiers&2?6:2}${suffix}`;
  }
  if (info.modifiers&2) {
    if (/^Key[A-Z]$/.test(info.code)) return String.fromCharCode(info.code.charCodeAt(3)-64);
    return '';
  }
  return ({Escape:'\x1b',Enter:'\r',Tab:'\t',Backspace:'\x7f',Delete:'\x1b[3~',
    ArrowUp:'\x1b[A',ArrowDown:'\x1b[B',ArrowRight:'\x1b[C',ArrowLeft:'\x1b[D',Home:'\x1b[H',End:'\x1b[F'})[info.key] ?? info.text ?? '';
}

// Frame input before async CDP dispatch: CSI reports can span reads, and a
// single read may contain several keys, mouse events and negotiation replies.
export class KeyboardProtocol {
  constructor({write,onInput,timeout=1000,escapeTimeout=50}) {
    Object.assign(this,{write,onInput,timeout,escapeTimeout});
    this.decoder=new StringDecoder('utf8');this.tail='';this.flags=0;this.pushed=false;this.running=false;
  }
  start() {
    if(this.running)return;
    this.running=true;this.pending=true;
    this.timer=setTimeout(()=>{this.pending=false;},this.timeout);
    this.write('\x1b[?u');
  }
  reply() {
    if(!this.pending||!this.running)return;
    this.pending=false;clearTimeout(this.timer);
    this.pushed=true;
    // Query the applied flags too: a terminal may implement only a subset.
    this.awaitingFlags=true;
    this.write('\x1b[>11u\x1b[?u');
  }
  stop() {
    clearTimeout(this.timer);clearTimeout(this.tailTimer);
    this.running=false;this.pending=false;this.awaitingFlags=false;
    if(this.pushed)this.write('\x1b[<u');
    this.pushed=false;this.flags=0;this.tail='';
  }
  feed(chunk) {
    clearTimeout(this.tailTimer);
    this.tail+=typeof chunk==='string'?chunk:this.decoder.write(chunk);
    while(this.tail) {
      let length=0;
      if(this.tail[0]!=='\x1b') {
        const m=/^[^\x00-\x1f\x7f\x1b]+/u.exec(this.tail);
        length=m?m[0].length:1;
      } else if(this.tail.length===1) break;
      else if(this.tail[1]==='[') {
        const m=/^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.tail);
        if(!m)break;
        length=m[0].length;
      } else if(this.tail[1]===']'||this.tail[1]==='_') {
        const m=/^\x1b[\]_][\s\S]*?(?:\x07|\x1b\\)/.exec(this.tail);
        if(!m)break;
        length=m[0].length;
      } else if(this.tail[1]==='O') {
        if(this.tail.length<3)break;
        length=3;
      } else length=1+String.fromCodePoint(this.tail.codePointAt(1)).length;
      const token=this.tail.slice(0,length);this.tail=this.tail.slice(length);
      const response=/^\x1b\[\?(\d+)u$/.exec(token);
      if(response) {
        if(this.awaitingFlags) {this.flags=Number(response[1])&11;this.awaitingFlags=false;}
        else this.reply();
      } else this.onInput(token);
    }
    if(this.tail) {
      // Only Escape/Alt ambiguity has a short timeout. Incomplete CSI/OSC is
      // never emitted as text; bound it so a broken peer cannot grow memory.
      if(this.tail.length>65536)this.tail='';
      else this.tailTimer=setTimeout(()=>{
        const tail=this.tail;this.tail='';
        if(tail==='\x1b')this.onInput(tail);
      },this.tail==='\x1b'?this.escapeTimeout:this.timeout);
    }
  }
}

export class KeyboardDispatch {
  constructor(client) {this.client=client;this.held=new Map();}
  async send(info,events=false) {
    const {key,code,keyCode=0,text,modifiers=0,eventType=1,location=0}=info;
    const id=code||key;
    const base={key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode,modifiers,
      location:location===3?0:location,isKeypad:location===3};
    if(eventType===3) {
      if(this.held.delete(id))await this.client.send('Input.dispatchKeyEvent',{type:'keyUp',...base});
      return;
    }
    if(events)this.held.set(id,base);
    try {
      await this.client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...base,autoRepeat:eventType===2});
      if(text)await this.client.send('Input.dispatchKeyEvent',{type:'char',...base,text});
    } finally {
      // Legacy input has no later physical release event to rescue a timeout.
      if(!events)await this.client.send('Input.dispatchKeyEvent',{type:'keyUp',...base});
    }
  }
  async releaseAll() {
    const held=[...this.held.values()];this.held.clear();
    for(const base of held)await this.client.send('Input.dispatchKeyEvent',{type:'keyUp',...base,modifiers:0});
  }
}
