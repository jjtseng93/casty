import {test,expect} from 'bun:test';
import {pixelGeometry,imageGeometry} from '../lib/terminal-geometry.js';

test('fractional cells preserve terminal pixels and screenshot aspect through resize',()=>{
 for(const [width,height,cols,rows] of [[883,1643,80,43],[883,1019,80,27],[1920,1035,137,39]]){
  const t=pixelGeometry({width,height},cols,rows);
  expect(t.width).toBe(width);expect(t.height).toBe(height);
  expect(t.cellWidth*cols).toBeCloseTo(width,8);
  expect(t.cellHeight*(rows-1)).toBeCloseTo(height-t.cellHeight,8);
  const zoom=t.cellWidth/8;
  // CDP requires integral CSS viewport dimensions; rounding occurs only here.
  const captureW=Math.round(width/zoom)*zoom;
  const captureH=Math.round((height-t.cellHeight)/zoom)*zoom;
  expect(Math.abs(captureW-width)).toBeLessThanOrEqual(zoom/2+1e-8);
  expect(Math.abs(captureH-(height-t.cellHeight))).toBeLessThanOrEqual(zoom/2+1e-8);
  expect(t.mouseCellWidth).toBe(t.cellWidth);
 }
});

test('invalid pixel replies use the estimated geometry fallback',()=>{
 for(const size of [null,{width:0,height:500},{width:800,height:0},{width:Infinity,height:500}])
  expect(pixelGeometry(size,80,24)).toBeNull();
});


test('image area reserves exactly one column without shortening height or changing input units',()=>{
 for(const [width,height,cols,rows] of [[883,1643,80,43],[883,1019,80,27],[1920,1035,137,39]]){
  const full=pixelGeometry({width,height},cols,rows);
  const image=imageGeometry(full);
  expect(image.cols).toBe(cols-1);
  expect(image.width).toBeCloseTo(width-full.cellWidth,8);
  expect(image.rows).toBe(rows);
  expect(image.height).toBe(height);
  expect(image.cellWidth).toBe(full.cellWidth);
  expect(image.mouseCellWidth).toBe(full.mouseCellWidth);
  // jsgotty's available width now equals the requested Kitty width: no
  // additional uniform scaling, so the full rows-1 content height survives.
  const viewerScale=Math.min(1,(cols-1)/image.cols);
  expect(viewerScale).toBe(1);
  expect(Math.round((image.rows-1)*viewerScale)).toBe(rows-1);
 }
 expect(imageGeometry({cols:1,cellWidth:10}).cols).toBe(1);
});
