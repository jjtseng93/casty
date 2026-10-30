import {readAttachViewport} from './attach.js';
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


// Re-read remote CSS geometry before each frame, including idle refreshes.
// This does not resize the remote target or restart its screencast.
export function createNativeAttachPolicy(client, onViewport) {
  return {
    format: 'bgra',
    async capture(_options, timeout) {
      const viewport = await readAttachViewport(client);
      onViewport(viewport);
      return client.send('Page.captureScreenshot', {
        format:'bgra', optimizeForSpeed:true, captureBeyondViewport:false,
      }, timeout);
    },
  };
}
