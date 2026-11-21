import {readAttachViewport} from './attach.js';
import {startScreencast, stopScreencast} from './browser.js';
import {createResizeHandler} from './resize.js';

// The terminal frontend forces a capture when the page reports progress (bin/casty.js), so a
// slow engine still shows its page once it finishes, however late the load events come.
export const DELAYED_CAPTURE_MS = [0, 300, 1000];

// Initial capture and subsequent resizes share one owner and one queue.
// Closing immediately retires capture; drain waits for cancellation to settle.
export function createNativeCapture({client, update, frameOptions, onError}) {
  let closed = false, stream = null, pending = Promise.resolve(), timers = [];
  const force = () => { if (!closed) return stream?.forceCapture(); };
  const delayedCapture = () => {
    if (closed) return;
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    for (const ms of DELAYED_CAPTURE_MS) {
      if (ms === 0) force();
      else timers.push(setTimeout(force, ms));
    }
  };
  const frameNavigated = ({frame}) => { if (!frame?.parentId) delayedCapture(); };
  const pageEvents = [
    ['Page.domContentEventFired', delayedCapture], ['Page.loadEventFired', delayedCapture],
    ['Page.frameNavigated', frameNavigated], ['Page.navigatedWithinDocument', delayedCapture],
  ];
  for (const [name, listener] of pageEvents) client.on(name, listener);
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
    forceCapture: force,
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      for (const [name, listener] of pageEvents) client.removeListener(name, listener);
      stream?.cleanup(); stream = null;
    },
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
