import {isCDPTimeout} from './cdp.js';
// Discovery is read-only. Retry only timeouts; HTTP/protocol errors retain the
// caller's existing fallback. Each body is read under the same deadline.
export async function cdpJson(url, init = {}) {
  let deadline = 10000;
  for (;;) {
    const signal = AbortSignal.timeout(deadline);
    try {
      const response = await fetch(url, {...init, signal});
      if (!response.ok) throw Error(`CDP HTTP ${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      if (!signal.aborted && !isCDPTimeout(error)) throw error;
      // Creating a target is not safe to repeat: setupPage falls back to list.
      if (init.method && init.method !== 'GET') throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
      deadline = Math.min(2147483647, deadline * 2);
    }
  }
}
