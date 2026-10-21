// Query replies share stdin with keys; consume complete/fragmented graphics
// replies, including late replies after fallback, without changing key input.
export class KittyTransport {
  constructor({ write, createProbe, removeProbe, timeout = 700, onReply = () => {}, onChange = () => {} }) {
    Object.assign(this, { write, createProbe, removeProbe, timeout, onChange, onReply });
    this.mode = 'inline';
    this.pending = false;
    this.tail = '';
  }
  select(mode) {
    this.cancel();
    this.mode = mode;
    this.onChange(mode);
  }
  cancel() {
    clearTimeout(this.timer);
    this.pending = false;
    if (this.path) { this.removeProbe(this.path); this.path = null; }
  }
  probe() {
    this.cancel();
    this.mode = 'inline';
    this.id = 100000 + Math.floor(Math.random() * 2000000000);
    try { this.path = this.createProbe(); }
    catch { this.select('inline'); return; }
    this.pending = true;
    this.timer = setTimeout(() => this.select('inline'), this.timeout);
    this.write(`\x1b_Ga=q,t=f,f=24,s=1,v=1,i=${this.id},q=0;${Buffer.from(this.path).toString('base64')}\x1b\\`);
  }
  feed(chunk, onInput) {
    clearTimeout(this.tailTimer);
    let text = this.tail + chunk;
    this.tail = '';
    while (text) {
      const start = text.indexOf('\x1b_G');
      if (start < 0) {
        const esc = text.lastIndexOf('\x1b');
        if (esc >= 0 && '\x1b_G'.startsWith(text.slice(esc))) {
          this.tail = text.slice(esc); text = text.slice(0, esc);
        }
        if (text) onInput(text);
        break;
      }
      if (start) onInput(text.slice(0, start));
      const end = text.indexOf('\x1b\\', start + 3);
      if (end < 0) { this.tail = text.slice(start); break; }
      const reply = text.slice(start + 3, end).match(/^i=(\d+)(?:,[^;]*)?;(.*)$/s);
      if(reply)this.onReply(Number(reply[1]),reply[2]);
      if (reply && this.pending && Number(reply[1]) === this.id) this.select(reply[2] === 'OK' ? 'file' : 'inline');
      text = text.slice(end + 2);
    }
    if (this.tail) this.tailTimer = setTimeout(() => {
      const tail = this.tail; this.tail = '';
      if (!tail.startsWith('\x1b_G')) onInput(tail);
    }, this.tail.startsWith('\x1b_G') ? this.timeout : 50);
  }
  stop() { this.cancel(); clearTimeout(this.tailTimer); this.tail = ''; }
}
