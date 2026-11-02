// Match WM_CHAR to its physical key without turning IME commits/paste into
// extra key presses. LPARAM's scan+extended bits are shared by both messages.
const scan = l => Number((BigInt(l)>>16n)&511n);
export class Win32TextInput {
 constructor(){this.pending=new Map();this.composing=false;}
 reset(){this.pending.clear();}
 composition(active){this.composing=active;this.reset();}
 down(info,l){
  if(this.composing||!info.key||info.key==='Dead'||[...info.key].length!==1)return;
  this.pending.set(scan(l),info);
 }
 character(text,l){
  const code=scan(l),info=this.pending.get(code);this.pending.delete(code);
  return !this.composing&&info?.key===text?info:null;
 }
}
