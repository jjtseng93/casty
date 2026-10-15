// DECRQM negotiation is independent of tracking (1002/1003).
const replies = [0, 1, 2, 3, 4].map(n => `\x1b[?1016;${n}$y`);
export class MouseProtocol {
  constructor({ write, tracking = 1002, forceCell = false, timeout = 500 }) {
    Object.assign(this, { write, tracking, forceCell, timeout });
    this.pixel = false;
    this.dimensionsKnown = true;
    this.pending = false;
    this.tail = '';
  }
  start() {
    this.stop();
    if (this.forceCell || !this.dimensionsKnown) { this.activate(false); return; }
    this.pending = true;
    this.timer = setTimeout(() => this.activate(false), this.timeout);
    this.write('\x1b[?1016$p');
  }
  activate(pixel) {
    clearTimeout(this.timer);
    this.pending = false;
    this.pixel = pixel;
    this.write(`\x1b[?1000;${this.tracking};1006h${pixel ? '\x1b[?1016h' : ''}`);
    this.onChange?.(pixel);
  }
  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.tailTimer);
    this.pending = false;
    this.pixel = false;
    this.tail = '';
    this.write(`\x1b[?1016l\x1b[?1000;${this.tracking};1006l`);
  }
  // Replies can be fragmented or mixed with keyboard input. Late replies are
  // consumed but never change the mode after a timeout.
  feed(chunk, onInput) {
    clearTimeout(this.tailTimer);
    let text = this.tail + chunk;
    this.tail = '';
    text = text.replace(/\x1b\[\?1016;([0-4])\$y/g, (_, state) => {
      if (this.pending) this.activate(this.dimensionsKnown && (state === '1' || state === '2'));
      return '';
    });
    const last = text.lastIndexOf('\x1b');
    if (last >= 0 && replies.some(reply => reply.startsWith(text.slice(last)))) {
      this.tail = text.slice(last);
      text = text.slice(0, last);
      this.tailTimer = setTimeout(() => {
        const tail = this.tail; this.tail = '';
        // Preserve Escape/Alt input; do not type a truncated terminal reply.
        if (tail && !tail.startsWith('\x1b[?')) onInput(tail);
      }, this.pending ? this.timeout : 50);
    }
    if (text) onInput(text);
  }
}

export function mouseCoordinates(x, y, cellWidth, cellHeight, zoom, pixel, mouseCellWidth = cellWidth, mouseCellHeight = cellHeight) {
  // Kitty stretches the image to a cell rectangle. SGR 1016 uses terminal
  // pixels, which need not match the integer pixels used to encode that image.
  return pixel ? {
    col: Math.floor(x / mouseCellWidth) + 1, row: Math.floor(y / mouseCellHeight) + 1,
    x: x * (cellWidth / mouseCellWidth) / zoom,
    y: (y - mouseCellHeight) * (cellHeight / mouseCellHeight) / zoom,
  } : {
    col: x, row: y,
    x: (x - 0.5) * cellWidth / zoom, y: (y - 1.5) * cellHeight / zoom,
  };
}
