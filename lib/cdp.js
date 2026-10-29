// CDP WebSocket client
// Lightweight CDP client that never sends Runtime.enable

import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';

// Only repeat operations whose effects are safe to repeat. Input, navigation,
// script registration/evaluation and target creation can already have executed.
const RETRYABLE = new Set([
  'Page.enable', 'Page.getLayoutMetrics', 'Page.getFrameTree',
  'Page.getResourceContent', 'Page.getNavigationHistory',
  'Emulation.setDeviceMetricsOverride', 'Network.setUserAgentOverride',
  'Browser.setDownloadBehavior', 'Page.startScreencast', 'Page.stopScreencast',
  'Page.screencastFrameAck',
]);
export const isCDPTimeout = error => ['CDP_TIMEOUT','ETIMEDOUT'].includes(error?.code) || error?.name === 'TimeoutError' || /(?:\btimeout\b|\btimed out\b)/i.test(error?.message ?? '');
const CDP_TIMEOUT = 10000; // ms — reject pending commands after this

export class CDPClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._id = 0;
    this.wsUrl = null;
    this.versionInfo = null;
    this._pending = new Map();
    this._retryWaits = new Set();
    this._streamGeneration = 0;
    this._ackGeneration = 0;
    this._closed = false;
    this._deadlines = new Map();
    this._navigationGeneration = 0;
    this._handshakeTimeout = CDP_TIMEOUT;
  }

  // Connect via WebSocket
  async connect(wsUrl) {
    this._closed = false;
    for (;;) {
      try { return await this._connectOnce(wsUrl); }
      catch (error) {
        if (this._closed || !isCDPTimeout(error)) throw error;
        this._handshakeTimeout = Math.min(2147483647, this._handshakeTimeout * 2);
        // Reconnect only before opening; a live session closing is not a timeout.
        await new Promise((resolve, reject) => {
          const wait = {reject, timer:setTimeout(() => {this._retryWaits.delete(wait);resolve();},1000)};
          this._retryWaits.add(wait);
        });
      }
    }
  }

  async _connectOnce(wsUrl) {
    this.wsUrl = String(wsUrl);
    this._ws = new WebSocket(wsUrl, { perMessageDeflate: false, handshakeTimeout: this._handshakeTimeout });
    this._ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); }
      catch { return; } // Ignore non-JSON frames
      if (msg.id !== undefined) {
        // Command response
        const p = this._pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this._pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result || {});
        }
      } else if (msg.method) {
        // CDP event
        this.emit(msg.method, msg.params || {});
      }
    });
    let opened = false;
    this._ws.on('open', () => { opened = true; });
    this._ws.on('close', () => { if (opened) {this._rejectPending(); this.emit('close');} });
    this._ws.on('error', (err) => {if (opened && this.listenerCount('error')) this.emit('error', err);});
    // once() rejects on 'error' if it fires before 'open'
    await once(this._ws, 'open');
  }

  diagnostics() {
    let address = 'unavailable';
    try { const url = new URL(this.wsUrl); address = `${url.hostname}:${url.port || (url.protocol === 'wss:' ? 443 : 80)}`; } catch {}
    return { address, wsUrl: this.wsUrl, state: ['connecting', 'open', 'closing', 'closed'][this._ws?.readyState ?? 3],
      browser: this.versionInfo?.Browser ?? 'unknown', protocol: this.versionInfo?.['Protocol-Version'] ?? 'unknown', pending: this._pending.size };
  }

  timeoutFor(method, minimum = CDP_TIMEOUT) {
    return Math.max(minimum, this._deadlines.get(method) || 0);
  }

  // Navigation is deliberately retried, except javascript: (arbitrary effects).
  // Backoff also accepts a late reply, so a slow successful navigation need not
  // be restarted. Increasing deadlines prevent permanent failure on slow CPUs.
  async send(method, params = {}, timeoutMs = CDP_TIMEOUT, options = {}) {
    const navigation = ['Page.navigate','Page.navigateToHistoryEntry','Page.reload'].includes(method);
    const retry = options.retry ?? (RETRYABLE.has(method) || (navigation && !/^\s*javascript:/i.test(params.url || '')));
    const stream = method === 'Page.startScreencast' || method === 'Page.stopScreencast';
    const ack = method === 'Page.screencastFrameAck';
    const generation = stream ? ++this._streamGeneration : ack ? ++this._ackGeneration : navigation ? ++this._navigationGeneration : 0;
    const superseded = () => stream ? generation !== this._streamGeneration : ack ? generation !== this._ackGeneration : navigation && generation !== this._navigationGeneration;
    for (;;) {
      const deadline = this.timeoutFor(method, timeoutMs);
      try { return await this._sendOnce(method, params, deadline); }
      catch (error) {
        if (!isCDPTimeout(error)) throw error;
        this._deadlines.set(method, Math.min(2147483647, deadline * 2));
        this.emit('timeout', {method, retry});
        if (!retry) {error.discard?.();throw error;}
        let delay;
        try {
          if (superseded()) throw Error('CDP request superseded');
          // The late response remains eligible until the next attempt starts.
          const result = await Promise.race([
            error.late ? error.late.then(value=>({value})) : new Promise(()=>{}),
            (delay = this._retryDelay()).then(()=>null),
          ]);
          if (superseded()) throw Error('CDP request superseded');
          if (result) return result.value;
          if (method === 'Page.navigate') {
            // The page can commit before navigation's reply (fonts/layout may
            // still be running). Reissuing now can cancel its renderer forever.
            const tree = await this.send('Page.getFrameTree', {}, timeoutMs);
            if (superseded()) throw Error('CDP request superseded');
            const frame = tree.frameTree?.frame;
            let same = frame?.url === params.url;
            try { same = new URL(frame.url).href === new URL(params.url).href; } catch {}
            if (same) return {frameId:frame.id, loaderId:frame.loaderId};
          }
        } finally { delay?.cancel?.(); error.discard?.(); }
      }
    }
  }

  _retryDelay() {
    if (this._ws?.readyState !== WebSocket.OPEN) return Promise.reject(Error('Connection closed'));
    let cancel;
    const promise = new Promise((resolve, reject) => {
      const wait = {reject, timer: setTimeout(() => {
        this._retryWaits.delete(wait); resolve();
      }, 1000)};
      cancel = () => {clearTimeout(wait.timer);this._retryWaits.delete(wait);resolve();};
      this._retryWaits.add(wait);
    });
    promise.cancel = cancel;
    return promise;
  }

  _sendOnce(method, params = {}, timeoutMs = CDP_TIMEOUT) {
    if (this._ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Connection closed'));
    const id = ++this._id;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const timer = setTimeout(() => {
      const entry = this._pending.get(id);
      if (!entry) return;
      const late = new Promise((res, rej) => {entry.resolve=res;entry.reject=rej;});
      late.catch(()=>{});
      reject(Object.assign(new Error(`CDP timeout: ${method}`), {
        code:'CDP_TIMEOUT', method, late, discard:()=>this._pending.delete(id),
      }));
    }, timeoutMs);
    this._pending.set(id, { resolve, reject, timer });
    try {
      this._ws.send(JSON.stringify({ id, method, params }));
    } catch (err) {
      // ws.send() can throw synchronously if socket is closed
      clearTimeout(timer);
      this._pending.delete(id);
      reject(err);
    }
    return promise;
  }

  // Disconnect
  close() {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._rejectPending();
  }

  _rejectPending() {
    for (const wait of this._retryWaits) {
      clearTimeout(wait.timer); wait.reject(Error('Connection closed'));
    }
    this._retryWaits.clear();
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }
}
