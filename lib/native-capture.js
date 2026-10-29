import {startScreencast, stopScreencast} from './browser.js';
import {createResizeHandler} from './resize.js';

// Initial capture and subsequent resizes share one owner and one queue.
// Closing immediately retires capture; drain waits for cancellation to settle.
export function createNativeCapture({client, update, frameOptions, onError}) {
  let closed = false, stream = null, pending = Promise.resolve();
  const resize = createResizeHandler({
    async update() {
      if (closed) return;
      if (stream) {
        const previous = stream;
        stream = null;
        await stopScreencast(client, previous.cleanup);
      }
      if (!closed) await update();
    },
    async resume() {
      if (closed) return;
      const next = await startScreencast(client, frameOptions());
      if (closed) next.cleanup();
      else stream = next;
    },
    onError(error) { if (!closed) onError(error); },
  });
  return {
    resize() { return closed ? Promise.resolve() : (pending = resize()); },
    forceCapture() { if (!closed) return stream?.forceCapture(); },
    close() { closed = true; stream?.cleanup(); stream = null; },
    drain() { return pending; },
  };
}
