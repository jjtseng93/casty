import {setTimeout as delay} from 'node:timers/promises';
import {cdpJson} from './cdp-http.js';
import {isRaw} from './capture-format.js';
// Raw CDP browser control
// Runtime.enable must never be sent

import { join } from 'node:path';
import { homedir } from 'node:os';
import { CDPClient, isCDPTimeout } from './cdp.js';
import { launchChrome } from './chrome.js';
import { loadConfig } from './config.js';
import { DOWNLOAD_DIR } from './download.js';

const DEFAULT_CHROME_VERSION = '146.0.7680.80';

// Platform-specific identity (must match real OS to avoid TLS/TCP fingerprint mismatch)
const PLATFORM = process.platform === 'darwin'
  ? { ua: 'Macintosh; Intel Mac OS X 10_15_7', nav: 'MacIntel',
      uaPlatform: 'macOS', uaPlatformVersion: '15.0.0',
      glVendor: 'Google Inc. (Apple)', glRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' }
  : process.platform === 'win32'
  ? { ua: 'Windows NT 10.0; Win64; x64', nav: 'Win32',
      uaPlatform: 'Windows', uaPlatformVersion: '15.0.0',
      glVendor: 'Google Inc. (Intel)', glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
  : { ua: `X11; Linux ${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
      nav: `Linux ${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`,
      uaPlatform: 'Linux', uaPlatformVersion: '',
      glVendor: 'Google Inc. (Intel)', glRenderer: 'ANGLE (Intel, Mesa Intel UHD Graphics, OpenGL 4.5)' };

const buildUserAgent = (v) =>
  `Mozilla/5.0 (${PLATFORM.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
const PROFILE_DIR = join(homedir(), '.casty', 'profile');

// Screencast settings (low-res stream for change detection)
const SCREENCAST_SCALE     = 4;    // Downscale factor (1/4 resolution)
const SCREENCAST_NTH_FRAME = 1;    // Every frame (no decimation, faster change detection)

// Capture control
function captureMinInterval() {
  const raw = process.env.CASTY_CAPTURE_MIN_INTERVAL;
  if (raw == null || raw.trim() === '') return 16;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= 0 && value <= 60000) return value;
  console.warn('casty: CASTY_CAPTURE_MIN_INTERVAL must be an integer from 0 to 60000 ms; using 16 ms');
  return 16;
}
// A screenshot started just before navigation can remain unanswered until the
// generic CDP timeout. Release the capture queue quickly so the new page gets
// its own high-resolution frame without waiting for user input.
const SCREENSHOT_TIMEOUT   = 2000; // ms

// Build stealth script with locale-dependent language settings
// lang: primary language (e.g. "ja", "en-US")
function buildStealthScript(lang, { media = false, mediaPort = 0, mediaToken = '', chromium = true } = {}) {
  // Build Accept-Language style list: primary, then en-US/en fallbacks
  const languages = [lang];
  if (lang !== 'en-US' && lang !== 'en') {
    languages.push('en-US', 'en');
  } else if (lang === 'en-US') {
    languages.push('en');
  }
  const langArray = JSON.stringify(languages);

  return `
${chromium ? `
// navigator.plugins (headless exposes empty array)
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const arr = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    ];
    arr.refresh = () => {};
    return arr;
  },
});

// navigator.mimeTypes
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const arr = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    ];
    arr.refresh = () => {};
    return arr;
  },
});

// navigator.languages (derived from system locale or config)
Object.defineProperty(navigator, 'languages', {
  get: () => ${langArray},
});

// navigator.language
Object.defineProperty(navigator, 'language', {
  get: () => '${lang}',
});

// window.chrome (undefined in headless)
if (!window.chrome) {
  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {}, connect: function(){}, id: undefined, sendMessage: function(){} },
    csi: function() { return {}; },
    loadTimes: function() { return {}; },
  };
}

// Permissions API (headless behaves differently)
const origQuery = navigator.permissions.query.bind(navigator.permissions);
navigator.permissions.query = (params) => {
  if (params.name === 'notifications') {
    return Promise.resolve({ state: Notification.permission });
  }
${media ? `  if (params.name === 'camera' || params.name === 'microphone') {
    return Promise.resolve({ state: 'granted' });
  }` : ''}
  return origQuery(params);
};

// WebGL vendor/renderer (hide SwiftShader)
// 0x9245 = UNMASKED_VENDOR_WEBGL, 0x9246 = UNMASKED_RENDERER_WEBGL
const getParam = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p) {
  if (p === 0x9245) return '${PLATFORM.glVendor}';
  if (p === 0x9246) return '${PLATFORM.glRenderer}';
  return getParam.call(this, p);
};

// navigator.connection (can be undefined in headless)
if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }),
  });
}
` : ''}

// casty currently presents one page target. Keep ordinary target=_blank
// links and forms in that target instead of opening an invisible Chrome tab.
document.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest('a[target="_blank"]') : null;
  if (anchor) anchor.target = '_self';
}, true);
document.addEventListener('submit', (event) => {
  if (event.target instanceof HTMLFormElement && event.target.target === '_blank') {
    event.target.target = '_self';
  }
}, true);

${media && mediaPort ? `
// getUserMedia with real device capture via ffmpeg WebSocket relay
if (!navigator.mediaDevices) navigator.mediaDevices = {};
if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = (constraints) => {
    return new Promise((resolve) => {
      const tracks = [];
      const ws = new WebSocket('ws://127.0.0.1:${mediaPort}/${mediaToken}');
      ws.binaryType = 'arraybuffer';

      let canvas, ctx, vstream;
      if (constraints.video) {
        const w = constraints.video.width?.ideal || constraints.video.width?.max || 640;
        const h = constraints.video.height?.ideal || constraints.video.height?.max || 480;
        canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        ctx = canvas.getContext('2d');
        vstream = canvas.captureStream(15);
        tracks.push(...vstream.getVideoTracks());
      }

      let pcmQueue;
      if (constraints.audio) {
        const actx = new AudioContext({ sampleRate: 48000 });
        if (actx.state === 'suspended') actx.resume();
        pcmQueue = [];
        // Use 1 input channel to ensure onaudioprocess fires reliably
        const proc = actx.createScriptProcessor(4096, 1, 1);
        // Feed silence into input to keep processor running
        const silence = actx.createBufferSource();
        const silenceBuf = actx.createBuffer(1, 4096, 48000);
        silence.buffer = silenceBuf;
        silence.loop = true;
        silence.connect(proc);
        silence.start();
        proc.onaudioprocess = (e) => {
          const out = e.outputBuffer.getChannelData(0);
          const chunk = pcmQueue.shift();
          if (chunk) {
            const s16 = new Int16Array(chunk);
            for (let i = 0; i < out.length && i < s16.length; i++) out[i] = s16[i] / 32768;
            if (s16.length < out.length) out.fill(0, s16.length);
          } else {
            out.fill(0);
          }
        };
        const dest = actx.createMediaStreamDestination();
        proc.connect(dest);
        tracks.push(...dest.stream.getAudioTracks());
      }

      ws.onmessage = (e) => {
        const buf = new Uint8Array(e.data);
        const type = buf[0];
        const payload = buf.slice(1);
        if (type === 1 && canvas) {
          createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
            .then(bmp => { ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); });
        } else if (type === 2 && pcmQueue) {
          pcmQueue.push(payload.buffer);
        }
      };

      const stream = new MediaStream(tracks);
      // Close WebSocket when all tracks are stopped (camera/mic off)
      for (const track of tracks) {
        track.addEventListener('ended', () => {
          if (stream.getTracks().every(t => t.readyState === 'ended')) {
            ws.close();
          }
        });
      }
      resolve(stream);
    });
  };
  navigator.mediaDevices.enumerateDevices = () => Promise.resolve([
    { deviceId: 'default', kind: 'audioinput', label: 'Default Microphone', groupId: 'default' },
    { deviceId: 'default', kind: 'videoinput', label: 'Default Camera', groupId: 'default' },
    { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker', groupId: 'default' },
  ]);
}
` : ''}
`;
}

// Build Accept-Language header from primary language
function buildAcceptLanguage(lang) {
  if (lang === 'en-US') return 'en-US,en;q=0.9';
  if (lang === 'en') return 'en';
  return `${lang},en-US;q=0.9,en;q=0.8`;
}


// HTTP GET → JSON (using global fetch)
async function fetchJson(url, init = undefined) {
  try {
    return await cdpJson(url, init);
  } catch (error) { init?.signal?.throwIfAborted(); return null; }
}

// Phase 1: Launch Chrome with its real device scale factor equal to the
// emulated one. Page.captureScreenshot temporarily rescales the emulated view
// by (emulated DSF / real DSF); with a mismatch, Input events racing a capture
// land in device pixels instead of CSS pixels and clicks miss their target.
// `browserArgs` are extra flags from the command line (after "--").
export async function startBrowser(zoom = 1, browserArgs = [], {signal} = {}) {
  const args = zoom !== 1 ? [`--force-device-scale-factor=${zoom}`] : [];
  return launchChrome({ userDataDir: PROFILE_DIR, args: [...args, ...browserArgs], signal });
}

// Phase 2: CDP connection + page setup (navigation is done by the caller)
// Tries /json/new first, then /json/list, then Target.createTarget via browser CDP
export async function setupPage({ port, wsUrl }, { width, height, zoom = 1, mediaPort = 0, mediaToken = '', signal } = {}) {
  signal?.throwIfAborted();
  const config = loadConfig();
  const lang = config.language;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Detect Chrome version from CDP endpoint
  const versionInfo = await fetchJson(`${baseUrl}/json/version`, {signal});
  // CDP is also implemented by non-Chromium engines. Keep their advertised
  // identity and APIs: Chrome-specific patches create contradictory signals
  // and can throw before the rest of our page setup runs.
  const chromium = !versionInfo?.Browser || /^(?:HeadlessChrome|Chrome|Chromium)\//.test(versionInfo.Browser);
  const chromeVersion = versionInfo?.Browser?.replace(/^.*\//, '') || DEFAULT_CHROME_VERSION;
  const userAgent = buildUserAgent(chromeVersion);

  // Try /json/new (single HTTP request, fastest); Chrome 111+ accepts PUT only
  let target = await fetchJson(`${baseUrl}/json/new?about:blank`, { method: 'PUT', signal });
  if (!target?.webSocketDebuggerUrl) {
    // Check /json/list for existing pages
    const targets = await fetchJson(`${baseUrl}/json/list`, {signal});
    target = targets?.find(t => t.type === 'page');
  }
  if (!target?.webSocketDebuggerUrl) {
    // Fallback: create page via browser CDP (headless-shell needs this)
    const browserClient = new CDPClient();
    try {
      await browserClient.connect(wsUrl, {signal});
      const { targetId } = await browserClient.send('Target.createTarget', { url: 'about:blank' });
      target = { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${targetId}` };
    } catch (error) {
      if (!isCDPTimeout(error)) throw error;
      // Creation might have happened. Discover its result instead of creating
      // unbounded extra tabs when the renderer is busy.
      while (!target?.webSocketDebuggerUrl) {
        await delay(1000, undefined, {signal});
        if (browserClient.diagnostics().state !== 'open') throw Error('Connection closed');
        const pages = await fetchJson(`${baseUrl}/json/list`, {signal});
        target = pages?.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
      }
    } finally { browserClient.close(); }
  }

  const client = new CDPClient();
  try {
  await client.connect(target.webSocketDebuggerUrl, {signal});
  client.versionInfo = versionInfo;

  const cssWidth = Math.round(width / zoom);
  const cssHeight = Math.round(height / zoom);

  // Run CDP commands in parallel (all must complete before navigation)
  await Promise.all([
    client.send('Page.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {
      width: cssWidth, height: cssHeight, deviceScaleFactor: zoom, mobile: false,
    }),
    ...(chromium ? [client.send('Network.setUserAgentOverride', {
      userAgent: userAgent, platform: PLATFORM.nav,
      acceptLanguage: buildAcceptLanguage(lang),
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: chromeVersion.split('.')[0] },
          { brand: 'Google Chrome', version: chromeVersion.split('.')[0] },
          { brand: 'Not-A.Brand', version: '99' },
        ],
        fullVersionList: [
          { brand: 'Chromium', version: chromeVersion },
          { brand: 'Google Chrome', version: chromeVersion },
          { brand: 'Not-A.Brand', version: '99.0.0.0' },
        ],
        platform: PLATFORM.uaPlatform,
        platformVersion: PLATFORM.uaPlatformVersion,
        architecture: process.arch === 'arm64' ? 'arm' : 'x86',
        bitness: '64',
        model: '',
        mobile: false,
        wow64: false,
      },
    })] : []),
    client.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStealthScript(lang, { media: config.media, mediaPort, mediaToken, chromium }) }).catch(error => {
      if (!isCDPTimeout(error)) throw error;
      // Registration may have succeeded; retrying would inject the script twice.
      console.error('casty: script registration timed out; continuing without repeating it');
    }),
    client.send('Browser.setDownloadBehavior', {
      behavior: 'allow', downloadPath: DOWNLOAD_DIR,
      eventsEnabled: true,
    }),
  ]);

  return { client, cssWidth, cssHeight };
  } catch (error) { client.close(); throw error; }
}

// Private startScreencast clip extension: cooperating engines crop without
// resizing. Chromium ignores clip and still honors the standard max limits.
export function screencastRegion(width, height) {
  const maxWidth=Math.max(1,Math.round(width/SCREENCAST_SCALE));
  const maxHeight=Math.max(1,Math.round(height/SCREENCAST_SCALE));
  return {maxWidth,maxHeight,clip:{x:0,y:0,width:maxWidth,height:maxHeight,scale:1}};
}

// Adaptive frame capture with quality refinement:
//
// Screencast at 1/4 resolution as change-detection trigger,
// then Page.captureScreenshot for full DPR-aware hi-res frame.
// CAPTURE_MIN_INTERVAL throttles to keep CPU usage low.
//
// Adaptive format (JPEG → PNG refinement):
//   During rapid updates: JPEG for speed (3-5x smaller than PNG)
//   After activity stops: PNG refinement for crisp text (lossless)
//   Only active when format='jpeg'; PNG mode is already lossless.
//
// format: 'jpeg' (file transfer, adaptive) or 'png' (inline, always lossless)
export async function startScreencast(client, { width, height, onFrame, format = 'png', quality = 85, capturePolicy, idleRefreshInterval = 0 }) {
  const minCaptureInterval = captureMinInterval();
  let capturing = false;
  let stopped = false;
  let lastCaptureTime = 0;
  let throttleTimer = null;
  let refineTimer = null;
  let idleRefreshTimer = null;
  let recoveryTimer = null;
  let captureFailed = false;
  // Attach may share a target whose screencast notifications are interrupted.
  // Rearm after completion, never queue periodic work behind a slow screenshot.
  function scheduleIdleRefresh() {
    clearTimeout(idleRefreshTimer);
    if (!stopped && idleRefreshInterval > 0) {
      idleRefreshTimer = setTimeout(() => {
        idleRefreshTimer = null;
        if (!capturing) void capture();
      }, idleRefreshInterval);
    }
  }
  // A navigation can request a final full-resolution frame while another
  // screenshot is still in flight. Coalesce such requests instead of dropping
  // them; the newest page state must be captured as soon as the current call
  // finishes.
  let forcePending = false;
  // Notification-only raw streams need one pending invalidation so captures
  // longer than a source frame do not halve the displayed rate. Encoded CDP
  // screenshots can trigger their own screencast events (including Chromium),
  // so keeping those events would create a capture loop on a static page.
  let capturePending = false;

  function beginCapture() {
    capturing = true;
    captureFailed = false;
    capturePending = false;
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }

  function finishCapture(refine = true) {
    capturing = false;
    // Negotiation may have retired raw during this capture. Its old pending
    // notification must not seed a loop in the replacement encoded stream.
    if (!isRaw(format)) capturePending = false;
    if (captureFailed) {
      clearTimeout(idleRefreshTimer);
      clearTimeout(refineTimer);
      // Ignore incoming invalidations until the completed failure has backed off.
      if (!stopped && !recoveryTimer) recoveryTimer = setTimeout(() => {
        recoveryTimer = null; forcePending = false; void forceCapture();
      }, 1000);
      return;
    }
    scheduleIdleRefresh();
    if (runPendingForce()) return;
    if (capturePending) void capture();
    else if (refine) scheduleRefine();
  }

  // Fast capture opts (configured format)
  const fastOpts = { format, optimizeForSpeed: true, captureBeyondViewport: false };
  if (format === 'jpeg') fastOpts.quality = quality;

  // PNG refinement opts (lossless, for crisp text after activity stops)
  const REFINE_DELAY = 500; // ms after last frame update
  let refineOpts = format === 'jpeg'
    ? { format: 'png', captureBeyondViewport: false }
    : null;

  async function captureFrame() {
    if(!capturePolicy)return client.send('Page.captureScreenshot',fastOpts,SCREENSHOT_TIMEOUT);
    try{
      const result=await capturePolicy.capture({quality},SCREENSHOT_TIMEOUT);
      if(stopped){throw Error('Screencast stopped');}
      return result;
    }
    finally{
      if(!stopped&&format!==capturePolicy.format){
        format=capturePolicy.format;
        refineOpts=format==='jpeg'?{format:'png',captureBeyondViewport:false}:null;
        await client.send('Page.startScreencast',{
          ...screencastOpts,format,...(isRaw(format)?{clip:{x:0,y:0,width:0,height:0,scale:1}}:{}),...(format==='jpeg'?{quality:30}:{})
        }).catch(()=>{});
      }
    }
  }

  // PNG refinement: capture one lossless frame after activity settles
  async function refineCapture() {
    if (stopped || capturing || recoveryTimer) return;
    beginCapture();
    try {
      const { data } = await client.send('Page.captureScreenshot', refineOpts, SCREENSHOT_TIMEOUT);
      if (!stopped && data) onFrame(data);
    } catch { captureFailed = true; }
    lastCaptureTime = Date.now();
    finishCapture(false);
  }

  function scheduleRefine() {
    if (stopped || !refineOpts) return;
    clearTimeout(refineTimer);
    refineTimer = setTimeout(refineCapture, REFINE_DELAY);
  }

  function runPendingForce() {
    if (!forcePending) return false;
    forcePending = false;
    void forceCapture();
    return true;
  }

  async function capture() {
    if (stopped || recoveryTimer) return;
    if (capturing) {
      if (isRaw(format)) capturePending = true;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastCaptureTime;
    if (elapsed < minCaptureInterval) {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          capture();
        }, minCaptureInterval - elapsed);
      }
      return;
    }

    beginCapture();
    lastCaptureTime = Date.now();
    try {
      const { data } = await captureFrame();
      if (!stopped && data) onFrame(data);
    } catch { captureFailed = true; }
    finishCapture();
  }

  function onScreencastFrame({ data, sessionId }) {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    capture();
  }
  client.on('Page.screencastFrame', onScreencastFrame);

  // Low-res change-detection screencast + hi-res captureScreenshot
  const screencastOpts = {
    format: isRaw(format) ? 'png' : format,
    ...screencastRegion(width, height),
    everyNthFrame: SCREENCAST_NTH_FRAME,
  };
  if (format === 'jpeg') screencastOpts.quality = 30;
  // Cooperating raw backends can emit update notifications without rendering
  // a throwaway preview. Other CDP servers may ignore this private option.
  try {
    await client.send('Page.startScreencast', {
      ...screencastOpts, ...(isRaw(format) ? {clip:{x:0,y:0,width:0,height:0,scale:1}} : {}),
    });
  } catch (error) { cleanup(); throw error; }

  // Capture first frame immediately
  capture();

  // Force capture (bypasses throttle, always uses captureScreenshot)
  async function forceCapture() {
    if (stopped || recoveryTimer) return;
    if (capturing) {
      forcePending = true;
      return;
    }
    beginCapture();
    try {
      const { data } = await captureFrame();
      if (!stopped && data) onFrame(data);
    } catch { captureFailed = true; }
    lastCaptureTime = Date.now();
    finishCapture();
  }

  function cleanup() {
    stopped = true;
    clearTimeout(throttleTimer);
    clearTimeout(refineTimer);
    clearTimeout(idleRefreshTimer);
    clearTimeout(recoveryTimer);
    forcePending = false;
    capturePending = false;
    client.removeListener('Page.screencastFrame', onScreencastFrame);
  }

  return { forceCapture, cleanup };
}

// Stop frame capture (cleanupFn from startScreencast return value)
export async function stopScreencast(client, cleanupFn) {
  try {
    if (cleanupFn) cleanupFn();
    await client.send('Page.stopScreencast');
  } catch {
    // Ignore if already closed
  }
}
