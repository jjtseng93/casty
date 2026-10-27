// CSI 14t reports the whole text area. Preserve fractional cell dimensions:
// flooring each cell loses up to one pixel per column/row, then Kitty stretches
// that smaller screenshot back over the actual cells at unequal X/Y scales.
export function pixelGeometry(size, cols, rows) {
  if (!(size?.width > 0 && size?.height > 0 && cols > 0 && rows > 0)
      || ![size.width,size.height,cols,rows].every(Number.isFinite)) return null;
  const {width,height} = size;
  const cellWidth = width / cols, cellHeight = height / rows;
  return {cols,rows,width,height,cellWidth,cellHeight,
    mouseCellWidth:cellWidth,mouseCellHeight:cellHeight,pixelGeometryKnown:true};
}

// Reserve the last column for every image placement, without changing cell
// metrics or height. The URL bar independently uses stdout.columns in full.
export function imageGeometry(term) {
  const cols = Math.max(1, term.cols - 1);
  return {...term, cols, width:cols * term.cellWidth};
}
