// DOM code describes the physical key; DOM key comes from the active layout.
const scans = new Map();
for (const [start, codes] of [
 [0x01,'Escape Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace Tab'],
 [0x10,'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Enter ControlLeft'],
 [0x1e,'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backquote ShiftLeft Backslash'],
 [0x2c,'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight NumpadMultiply AltLeft Space CapsLock'],
 [0x3b,'F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 NumLock ScrollLock Numpad7 Numpad8 Numpad9 NumpadSubtract Numpad4 Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal'],
 [0x56,'IntlBackslash F11 F12'],
]) codes.split(' ').forEach((code,i)=>scans.set(start+i,code));
const extended = new Map([[0x1c,'NumpadEnter'],[0x1d,'ControlRight'],[0x35,'NumpadDivide'],[0x38,'AltRight'],[0x47,'Home'],[0x48,'ArrowUp'],[0x49,'PageUp'],[0x4b,'ArrowLeft'],[0x4d,'ArrowRight'],[0x4f,'End'],[0x50,'ArrowDown'],[0x51,'PageDown'],[0x52,'Insert'],[0x53,'Delete'],[0x5b,'MetaLeft'],[0x5c,'MetaRight'],[0x5d,'ContextMenu']]);
const names = {8:'Backspace',9:'Tab',12:'Clear',13:'Enter',16:'Shift',17:'Control',18:'Alt',19:'Pause',20:'CapsLock',27:'Escape',32:' ',33:'PageUp',34:'PageDown',35:'End',36:'Home',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',44:'PrintScreen',45:'Insert',46:'Delete',91:'Meta',92:'Meta',93:'ContextMenu',144:'NumLock',145:'ScrollLock'};
export function win32Key(vk, lParam, modifiers, translated='') {
 const bits=BigInt(lParam),scan=Number((bits>>16n)&255n),ext=Boolean(bits&(1n<<24n));
 let key=names[vk] ?? (vk>=112&&vk<=135?'F'+(vk-111):translated||'Unidentified');
 let code=(ext?extended:scans).get(scan) ?? (vk>=112&&vk<=135?key:'Unidentified');
 if(vk===19)code='Pause';
 if(vk===44)code='PrintScreen';
 const location=code.startsWith('Numpad')?3: /^(Shift|Control|Alt|Meta)Left$/.test(code)?1:/^(Shift|Control|Alt|Meta)Right$/.test(code)?2:0;
 return {key,code,keyCode:vk,modifiers,location,eventType:bits&(1n<<30n)?2:1};
}
