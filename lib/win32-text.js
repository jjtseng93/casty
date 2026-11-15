// Match WM_CHAR to its physical key without turning IME commits/paste into
// extra key presses. LPARAM's scan+extended bits are shared by both messages.
const scan = l => Number((BigInt(l)>>16n)&511n);
export class Win32TextInput {
 constructor(){this.pending=new Map();this.composing=false;this.processedSpace=null;this.restoredSpace=null;}
 reset(preserveProcessedSpace=false){this.pending.clear();this.restoredSpace=null;if(!preserveProcessedSpace)this.processedSpace=null;}
 composition(active){this.composing=active;this.pending.clear();}
 compositionUpdate(flags){
  // GCS_COMPSTR/COMPATTR/COMPCLAUSE/CURSORPOS/DELTASTART identify real
  // preedit. A result-only Space may start and end composition in one turn.
  if(flags&0x1b8)this.processedSpace=null;
 }
 // Some Windows IMEs consume Space as VK_PROCESSKEY, then emit WM_CHAR
 // without a scan code. Wait for that literal space before restoring its key
 // event; composition commits must remain text, not application shortcuts.
 processKey(info){
  this.processedSpace=!this.composing&&info.code==='Space'&&!(info.modifiers&7)?info:null;
 }
 recoverSpace(text){
  const info=this.processedSpace;this.processedSpace=null;
  const restored=!this.composing&&text===' '?info:null;
  if(restored)this.restoredSpace=restored;
  return restored;
 }
 releaseProcessed(info){
  const restored=info.code===this.restoredSpace?.code?this.restoredSpace:null;
  this.up(info);
  return restored?{...restored,eventType:3}:null;
 }
 up(info){
  if(info.code===this.processedSpace?.code)this.processedSpace=null;
  if(info.code===this.restoredSpace?.code)this.restoredSpace=null;
 }
 down(info,l){
  this.processedSpace=null;
  if(this.composing||!info.key||info.key==='Dead'||[...info.key].length!==1)return;
  this.pending.set(scan(l),info);
 }
 character(text,l){
  const code=scan(l),info=this.pending.get(code);this.pending.delete(code);
  return !this.composing&&info?.key===text?info:null;
 }
}
