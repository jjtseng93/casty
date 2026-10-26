// Serialize terminal resizes and retain only the latest geometry request.
// update may pause the screencast before a slow CDP command; always resume it,
// even when that command times out or the first resized capture fails.
export function createResizeHandler({ update, resume, onError }) {
  let running = null;
  let pending = false;
  async function drain() {
    do {
      pending = false;
      try { await update(); }
      catch (error) { onError(error); }
      finally {
        try { await resume(); }
        catch (error) { onError(error); }
      }
    } while (pending);
  }
  return function requestResize() {
    pending = true;
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  };
}
