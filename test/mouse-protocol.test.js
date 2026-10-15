import {test,expect} from 'bun:test';
import {MouseProtocol,mouseCoordinates} from '../lib/mouse-protocol.js';
import {parseCommand,helpText} from '../lib/commands.js';
const make=(options={})=>{const writes=[],input=[];const protocol=new MouseProtocol({write:s=>writes.push(s),timeout:20,...options});return {protocol,writes,input,feed:s=>protocol.feed(s,v=>input.push(v))};};
test('1016 negotiation accepts fragmented replies and preserves adjacent keys',()=>{
 const p=make();try{p.protocol.start();expect(p.writes.at(-1)).toBe('\x1b[?1016$p');
 p.feed('a\x1b[?101');p.feed('6;2$yb');expect(p.protocol.pixel).toBe(true);expect(p.input.join('')).toBe('ab');expect(p.writes.at(-1)).toContain('\x1b[?1016h');
 }finally{p.protocol.stop();}expect(p.writes.at(-1)).toContain('\x1b[?1016l');
});
test('Konsole timeout and unknown/disabled capabilities fall back; late replies never upgrade',async()=>{
 for(const state of [0,3,4]){const p=make();try{p.protocol.start();p.feed(`\x1b[?1016;${state}$y`);expect(p.protocol.pixel).toBe(false);expect(p.writes.at(-1)).toBe('\x1b[?1000;1002;1006h');}finally{p.protocol.stop();}}
 const p=make();try{p.protocol.start();await Bun.sleep(40);expect(p.protocol.pending).toBe(false);expect(p.protocol.pixel).toBe(false);p.feed('\x1b[?1016;1$y');expect(p.protocol.pixel).toBe(false);expect(p.input).toEqual([]);}finally{p.protocol.stop();}
});
test('manual off cancels negotiation and a later on can query again',()=>{
 const p=make();try{p.protocol.start();p.protocol.forceCell=true;p.protocol.start();p.feed('\x1b[?1016;2$y');expect(p.protocol.pixel).toBe(false);
 p.protocol.forceCell=false;p.protocol.start();p.feed('\x1b[?1016;1$y');expect(p.protocol.pixel).toBe(true);
 expect(parseCommand('pixelmouse off')).toEqual({name:'pixelmouse',arg:'off'});expect(helpText()).toContain('pixelmouse [on|off]');}finally{p.protocol.stop();}
});
test('pixel coordinates preserve sub-cell motion, URL bar and zoom',()=>{
 expect(mouseCoordinates(25,61,10,20,2,true)).toEqual({col:3,row:4,x:12.5,y:20.5});
 expect(mouseCoordinates(26,61,10,20,2,true).x).toBe(13);
 expect(mouseCoordinates(25,19,10,20,1,true).row).toBe(1);
 expect(mouseCoordinates(3,4,10,20,2,false)).toEqual({col:3,row:4,x:12.5,y:25});
});

test('1016 maps terminal pixels to image pixels independently on both axes',()=>{
 // The terminal stretches a 10x20-per-cell image over actual 5x8 CSS cells.
 const p=mouseCoordinates(400,240,10,20,1,true,5,8);
 expect(p.x).toBe(800);expect(p.y).toBe(580);
 expect(p.col).toBe(81);expect(p.row).toBe(31);
 const fractional=mouseCoordinates(800,550,9,17,1,true,9.5,17.5);
 expect(fractional.x).toBeCloseTo(800/9.5*9);
 expect(fractional.y).toBeCloseTo((550-17.5)/17.5*17);
});
test('unknown terminal pixel dimensions keep 1006 even if 1016 is supported',()=>{
 const p=make();try{p.protocol.dimensionsKnown=false;p.protocol.start();expect(p.protocol.pending).toBe(false);p.feed('\x1b[?1016;2$y');expect(p.protocol.pixel).toBe(false);expect(p.writes).not.toContain('\x1b[?1016$p');}finally{p.protocol.stop();}
});
