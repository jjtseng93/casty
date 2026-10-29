#!/usr/bin/env node
import { pixelGeometry, imageGeometry } from '../lib/terminal-geometry.js';
// casty - TTY web browser using raw CDP and Kitty graphics protocol

// Handle stdout/stderr write errors (SSH disconnect, terminal close, etc.)
process.stdout.on('error', (err) => {
  if (err.code === 'EIO' || err.code === 'EPIPE') process.exit(0);
});
process.stderr.on('error', () => {});

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitBrowserArgs } from '../lib/chrome.js';
import { createResizeHandler } from '../lib/resize.js';
import { ensureChrome } from '../lib/install.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const readmeOptions = {
  '--readme-tui': ['--tui', 'README.md'],
  '--readme-tui-zh': ['--tui', 'README.zh-TW.md'],
  '--readme-tui-ja': ['--tui', 'README.ja.md'],
  '--readme-wui': ['--wui', 'README.md'],
  '--readme-wui-zh': ['--wui', 'README.zh-TW.md'],
  '--readme-wui-ja': ['--wui', 'README.ja.md'],
};
// casty's own options; any other leading option goes to the browser.
const ownOptions = new Set(['--no-shortcuts', '--readonly', '--attach', '--help', '-h', '--version', '-v', '-V', ...Object.keys(readmeOptions)]);

// Arguments after "--" are passed to the browser.
const { args: frontendArgs, browserArgs } = splitBrowserArgs(process.argv.slice(2), ownOptions);
const noShortcuts = frontendArgs.includes('--no-shortcuts');
const readonly = frontendArgs.includes('--readonly');
const attachIndex = frontendArgs.indexOf('--attach');
const attachEndpoint = attachIndex < 0 ? null : frontendArgs[attachIndex+1];
if (attachIndex >= 0 && (!attachEndpoint || attachEndpoint.startsWith('-'))) {
  console.error('casty: --attach requires a port or CDP endpoint');process.exit(1);
}
const cliArgs = frontendArgs.filter((arg,i) => !['--no-shortcuts','--readonly'].includes(arg) && i!==attachIndex && (attachIndex<0 || i!==attachIndex+1));
if (attachEndpoint && (browserArgs.length || cliArgs.some(arg=>!['--help','-h'].includes(arg)))) {
  console.error('casty: --attach does not accept a navigation URL or browser flags');process.exit(1);
}
if (Object.hasOwn(readmeOptions, cliArgs[0])) {
  const [mode, readme] = readmeOptions[cliArgs[0]];
  const child = spawnSync('bun',
    ['x', 'jsmdcui', mode, readme, '--kitty'], { cwd: packageDir, stdio: 'inherit' });
  if (child.error) console.error(`casty: failed to start jsmdcui: ${child.error.message}`);
  process.exit(child.status ?? 1);
}

const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

// --version / -v / -V
if (['--version', '-v', '-V'].includes(cliArgs[0])) {
  console.log(`casty ${pkg.version}`);
  process.exit(0);
}

// --help / -h
if (cliArgs[0] === '--help' || cliArgs[0] === '-h') {
  console.log(`casty - A real Chrome browser in your terminal

Usage: casty [url] [options] [-- browser-flags...]

Options:
  --help, -h       Show this help
  --version, -v, -V
                   Show version
  --readme-tui[-zh|-ja]
                   Open the English, Chinese, or Japanese README in a terminal UI
  --readme-wui[-zh|-ja]
                   Open the English, Chinese, or Japanese README in a web UI
  --attach <endpoint>
                   Existing CDP: port, HTTP(S), or page WebSocket URL
                   Preserve viewport and page; disconnect only on exit
  --readonly      Start viewing only; cmd> readonly on|off toggles
  --no-shortcuts   Forward all page keys; click @ to open cmd> (q quits)
  -- <flags>       Pass the remaining arguments to the browser
                   (e.g. casty example.com -- --lang=ja)

Key bindings:
  Alt+L            Address bar
  Ctrl+E           Command line (cmd>): open, back, forward, reload, home,
                   bookmark, links, copy, copyurl, paste, pasteurl,
                   download, find, eruda, zoom, help, quit
  Alt+F / Ctrl+L   Hint mode (Vimium-style link navigation)
  Alt+C            Copy selected text
  Ctrl+V           Paste from clipboard
  Alt+Left/Right   Back / Forward
  Ctrl+U / Ctrl+K  Back / Forward
  Ctrl+C           Send to page / copy while editing
  Ctrl+Q           Quit

Address bar and command line:
  Up / Down        History (kept per mode in ~/.casty/history.json)
  Tab / click prompt
                   Switch between address and command, keeping the text
  Double-click     Left third: next entry; middle: previous; right: Enter
  Drag / Shift+arrows
                   Select text; Alt+C / Ctrl+C copies selection (else all)
  Ctrl+V           Replace selection, or insert at the cursor
  Home / End       Start / end of the text (long text scrolls with the cursor)
  Ctrl+U / Ctrl+K  Toggle text before / after the cursor
  Type a URL or search query, then Enter
  /b [query]       Search bookmarks

Environment:
  CASTY_BROWSER    Browser to launch (checked first)
  BUN_CHROME_PATH  Browser to launch if CASTY_BROWSER is not set
                   .js/.ts (and similar) browsers run with Bun,
                   or with the runtime running casty if Bun is not found
  CASTY_ZOOM       Zoom factor on top of the automatic one (e.g. 1.5);
                   the zoom command changes it while running

Config: ~/.casty/config.json
Keys:   ~/.casty/keys.json

https://github.com/jjtseng93/casty`);
  process.exit(0);
}

const CONTROLS_HELP = `casty controls / casty 操作 / casty 操作方法

[English]
  Alt+L             Address bar
  Ctrl+E            Command line (cmd>)
  Alt+F / Ctrl+L    Link hints
  Alt+C             Copy selected text
  Ctrl+V            Paste
  Alt+Left / Right  Back / Forward
  Ctrl+U / Ctrl+K   Back / Forward
  Ctrl+C             Send to page / copy while editing
  Ctrl+Q             Quit
  Address bar: Ctrl+U / Ctrl+K toggles text before / after the cursor.

[中文]
  Alt+L             地址欄
  Ctrl+E            指令列（cmd>）
  Alt+F / Ctrl+L    連結提示
  Alt+C             複製選取文字
  Ctrl+V            貼上
  Alt+左 / 右        上一頁 / 下一頁
  Ctrl+U / Ctrl+K   上一頁 / 下一頁
  Ctrl+C             傳給頁面／編輯時複製
  Ctrl+Q             離開
  地址欄：Ctrl+U / Ctrl+K 可切下或恢復游標前方 / 後方的文字。

[日本語]
  Alt+L             アドレスバー
  Ctrl+E            コマンドライン（cmd>）
  Alt+F / Ctrl+L    リンクヒント
  Alt+C             選択した文字をコピー
  Ctrl+V            貼り付け
  Alt+左 / 右        戻る / 進む
  Ctrl+U / Ctrl+K   戻る / 進む
  Ctrl+C             ページへ送信／編集中はコピー
  Ctrl+Q             終了
  アドレスバー：Ctrl+U / Ctrl+K でカーソル前後の文字列を切り取り／復元します。
`;

function printControlsHelp() {
  console.log(CONTROLS_HELP);
}

// Explicit exit must wait for queued output, especially over a PTY or pipe.
async function flushOutput() {
  await Promise.all([process.stdout, process.stderr].map(stream =>
    new Promise(resolve => stream.write('', resolve))));
}

// Ensure a browser is installed (downloads Chrome Headless Shell on first run).
if (!attachEndpoint) await ensureChrome();

import { attachPage, readAttachViewport, attachDisplay } from '../lib/attach.js';
import {transientRawCaptureError,createCapturePolicy,isRaw,viewportClip} from '../lib/capture-format.js';
import { startBrowser, setupPage, startScreencast, stopScreencast, screencastRegion } from '../lib/browser.js';
import { queryRawPreference, sendFrame, resetFrameCache, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp, initializeTransport, detectTransport, setDisplaySize, disableDedup } from '../lib/kitty.js';
import { enableMouse, disableMouse, startInputHandling, stopInputHandling } from '../lib/input.js';
import { loadKeyBindings } from '../lib/keys.js';
import { loadConfig } from '../lib/config.js';
import { startMedia } from '../lib/media.js';
import { toURL } from '../lib/urlbar.js';

const config = loadConfig();
const bindings = loadKeyBindings();
const url = toURL(cliArgs[0] || config.homeUrl);

const TERM_QUERY_TIMEOUT = 1000;  // CSI 14t response timeout (ms)

// Delayed capture timings after page navigation (ms)
const DELAYED_CAPTURE_MS = [0, 300, 1000];

// Reference cell size (96 DPI, standard terminal font)
// Larger cells → zoom in, smaller cells → zoom out
const REF_CELL_WIDTH = 8;

// The zoom factor multiplies the automatic zoom: 2 shows pages twice as large
// (half as many CSS pixels across), 0.8 smaller. CASTY_ZOOM sets it at
// start-up; the "zoom" command (Ctrl+E) changes it.
let zoomFactor = Number(process.env.CASTY_ZOOM) > 0 ? Number(process.env.CASTY_ZOOM) : 1;

// Auto-calculate zoom from cell size
function calcZoom(cellWidth) {
  return cellWidth / REF_CELL_WIDTH * zoomFactor;
}

const terminalQueries = new Set();
let terminalClosing = false;

// Query terminal pixel size via CSI 14t
// keepAlive: true when called during operation (SIGWINCH) — don't touch stdin state
function queryTermPixelSize({ keepAlive = false } = {}) {
  if (terminalClosing || !process.stdin.isTTY) return Promise.resolve(null);

  let resolve;
  const promise = new Promise(r => { resolve = r; });
  terminalQueries.add(promise);
  promise.finally(() => terminalQueries.delete(promise));
  const wasRaw = process.stdin.isRaw;
  const timeout = setTimeout(() => {
    process.stdin.removeListener('data', onData);
    if (!keepAlive) {
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    }
    resolve(null);
  }, TERM_QUERY_TIMEOUT);

  if (!keepAlive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  let buf = '';
  const onData = (data) => {
    buf += data.toString();
    const match = buf.match(/\x1b\[4;(\d+);(\d+)t/);
    if (match) {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      if (!keepAlive) process.stdin.setRawMode(wasRaw);
      resolve({ height: parseInt(match[1]), width: parseInt(match[2]) });
    }
  };
  process.stdin.on('data', onData);

  process.stdout.write('\x1b[14t');
  return promise;
}

// Get terminal info
// keepAlive: true during operation (SIGWINCH) to avoid killing stdin
async function getTermInfo({ keepAlive = false } = {}) {
  const pixelSize = await queryTermPixelSize({ keepAlive });
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const geometry = pixelGeometry(pixelSize, cols, rows);
  if (geometry) {
    return imageGeometry({...geometry, zoom:calcZoom(geometry.cellWidth)});
  }

  const cellWidth = parseInt(process.env.CASTY_CELL_WIDTH) || 10;
  const cellHeight = parseInt(process.env.CASTY_CELL_HEIGHT) || 20;
  const zoom = calcZoom(cellWidth);
  return imageGeometry({
    cols, rows,
    width: cols * cellWidth,
    height: rows * cellHeight,
    cellWidth, cellHeight, zoom, pixelGeometryKnown: false,
  });
}

async function main() {
  // Phase 1: Get terminal info, then launch Chrome at the matching device
  // scale factor; media starts in parallel.
  // getTermInfo() must complete fully (prevent CSI 14t response leak)
  const mediaP = !attachEndpoint && config.media ? startMedia(config) : null;
  const term = await getTermInfo();
  const browser = attachEndpoint ? null : await startBrowser(term.zoom, browserArgs);
  const media = mediaP ? await mediaP : null;

  // Reserve line 1 for URL bar, use the rest for browser display
  const barHeight = term.cellHeight;
  const viewHeight = term.height - barHeight;
  setDisplaySize(term.cols, term.rows - 1);

  // Phase 2: CDP connection + page setup
  const { client, cssWidth, cssHeight } = attachEndpoint ? await attachPage(attachEndpoint) : await setupPage(browser, { ...term, height: viewHeight, mediaPort: media?.port || 0, mediaToken: media?.token || '' });
  const chromeProcess = browser?.proc;
  // Initial navigation belongs to a browser we launched, even in viewing-only mode.
  const navigateInitialPage = client.send.bind(client, 'Page.navigate', { url });
  let attachedTerm = term;
  let attachedViewport = {width:cssWidth,height:cssHeight};
  let attachedDisplay = attachEndpoint ? attachDisplay(term, attachedViewport) : null;
  if (attachedDisplay) setDisplaySize(attachedDisplay.cols, attachedDisplay.rows);

  // Log WebSocket errors to stderr (prevent unhandled crash)
  client.on('error', (err) => { console.error('casty: CDP error:', err.message); });


  hideCursor();
  clearScreen();

  // Terminal cells are measured in device pixels; input.js converts them to
  // the CSS pixels that CDP Input and page overlays both use.
  const cssCellW = term.cellWidth;
  const cssCellH = term.cellHeight;
  // Install reply handling before probing, then choose the initial capture
  // format once. Switching away from file transport retires a raw codec.
  let forceCapture = () => {}, screencastCleanup, capturePolicy;
  let urlBar = null;
  let dismissTimeoutStatus = null;
  let captureReady = false;
  // Shutdown can run as soon as input/signals are installed, even while a
  // slow backend is still negotiating its first capture.
  let resizeTimer = null;
  let delayedTimers = [];
  const zoomControl = attachEndpoint ? null : {
    get: () => zoomFactor,
    // Re-run the resize path: it recomputes the zoom and the viewport
    set: (factor) => { if (!captureReady) return; zoomFactor = factor; return handleResize(); },
  };
  let shuttingDown = false;
  let disconnected = false;
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  urlBar = startInputHandling(client, cssCellW, cssCellH, term.zoom, bindings, () => forceCapture(), zoomControl, { width: term.mouseCellWidth, height: term.mouseCellHeight, known: term.pixelGeometryKnown }, { noShortcuts, readonly, mapPointer: attachEndpoint ? (col,row)=>attachedDisplay.map(col,row) : null, getCaptureFormat: () => capturePolicy?.format });
  enableMouse();
  await initializeTransport(() => { forceCapture(); });
  if (shuttingDown) return;
  urlBar.render();

  // Negotiate terminal file/preference and CDP support before selecting raw.
  const transport = detectTransport();
  let captureGeometry=attachEndpoint ? {...attachedViewport,zoom:1} : {width:term.width,height:viewHeight,zoom:term.zoom};
  capturePolicy = await createCapturePolicy(client, {
    configured: config.format || 'auto', getTransport: detectTransport,
    queryPreference: queryRawPreference,
    getClip: () => viewportClip(client,captureGeometry).catch(()=>undefined),
  });

  if (shuttingDown) { capturePolicy.close(); return; }

  if (attachEndpoint) {
    // Another controller may resize the target without emitting frameResized.
    // Refresh the fit before every capture, including idle fallback captures.
    const capture = capturePolicy.capture.bind(capturePolicy);
    capturePolicy.capture = async (...args) => {
      const viewport = await readAttachViewport(client);
      if (shuttingDown || disconnected) throw Error('Connection closed');
      if (viewport.width !== attachedViewport.width || viewport.height !== attachedViewport.height) {
        attachedViewport = viewport;
        captureGeometry = {...viewport,zoom:1};
        attachedDisplay = attachDisplay(attachedTerm,viewport);
        setDisplaySize(attachedDisplay.cols,attachedDisplay.rows);
        clearScreen();resetFrameCache();urlBar.render();
      }
      return capture(...args);
    };
  }

  console.error(`casty: ${term.width}x${term.height} cell=${term.cellWidth.toFixed(0)}x${term.cellHeight.toFixed(0)} zoom=${term.zoom.toFixed(2)} transport=${transport} format=${capturePolicy.format}${capturePolicy.format === 'jpeg' ? ' (adaptive)' : ''}`);

  // Frame callback for screencast / captureScreenshot
  // sendFrame includes cursor positioning (single write)
  function onFrame(data) {
    if (shuttingDown || disconnected) return;
    try { sendFrame(data); }
    catch(error) {
      if(!isRaw(capturePolicy?.format))throw error;
      if (!transientRawCaptureError(error)) capturePolicy.retireRaw();
      return;
    }
    dismissTimeoutStatus?.();
    dismissTimeoutStatus = null;
    if (urlBar) urlBar.renderIfDirty();
  }

  const firstFrame=capturePolicy.takeFirstFrame();
  if(firstFrame)onFrame(firstFrame);

  // Phase 3: Start screencast
  ({ forceCapture, cleanup: screencastCleanup } = await startScreencast(client, {
    width: cssWidth,
    height: cssHeight,
    format: capturePolicy.format,
    capturePolicy,
    idleRefreshInterval: attachEndpoint ? 1000 : 0,
    onFrame,
  }).catch(error => {
    // A backend can exit under its own watchdog before the first screenshot.
    // Keep the terminal UI alive; the close handler below marks it disconnected.
    if (client.diagnostics().state !== 'closed') throw error;
    return {forceCapture:()=>{}, cleanup:()=>{}};
  }));

  if (shuttingDown) { screencastCleanup?.(); return; }

  // Force capture on page load events (debounced — multiple events fire close together)
  function delayedCapture() {
    for (const t of delayedTimers) clearTimeout(t);
    delayedTimers = [];
    for (const ms of DELAYED_CAPTURE_MS) {
      if (ms === 0) forceCapture();
      else delayedTimers.push(setTimeout(() => forceCapture(), ms));
    }
  }
  client.on('Page.domContentEventFired', delayedCapture);
  client.on('Page.loadEventFired', delayedCapture);
  client.on('Page.frameNavigated', ({ frame }) => {
    if (!frame.parentId) {
      delayedCapture();
    }
  });
  client.on('Page.navigatedWithinDocument', () => {
    delayedCapture();
  });

  // Install loading, capture, and input listeners before navigating. A local
  // server can otherwise finish before they exist, leaving the spinner stuck
  // and the displayed frame out of sync with subsequent pointer input.
  if (!attachEndpoint) navigateInitialPage().catch(e => console.error('casty: navigate error:', e.message));

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    dismissTimeoutStatus?.();
    dismissTimeoutStatus = null;
    terminalClosing = true;
    clearTimeout(resizeTimer);
    process.removeListener('SIGWINCH', onResize);
    process.stdout.removeListener('resize', onResize);
    client.removeListener('Page.frameResized', onResize);
    for (const timer of delayedTimers) clearTimeout(timer);
    console.error('casty: shutting down...');
    // Keep stdin raw and consumed while outstanding terminal queries finish.
    // Otherwise a late CSI 14t reply becomes input to the parent shell.
    const drainInput = () => {};
    process.stdin.on('data', drainInput);
    stopInputHandling();
    disableMouse();
    // A stalled browser must not hold up quitting; it is killed below anyway.
    await Promise.race([
      (async () => {
        await stopScreencast(client, screencastCleanup);  // Stop screencast (disables pending captures)
        if (!attachEndpoint) await client.send('Browser.close').catch(() => {});
      })().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    client.close();
    chromeProcess?.kill();
    await media?.cleanup();
    await Promise.allSettled([...terminalQueries]);
    // Allow fragmented late replies already in transit to finish before
    // returning the PTY to the shell. No new queries or modes may start now.
    await new Promise(resolve => setTimeout(resolve, 150));
    process.stdin.removeListener('data', drainInput);
    showCursor();
    try { process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
    clearScreen();                 // Clear after everything is stopped — no re-render risk
    capturePolicy?.close();
    cleanupTmp();
    printControlsHelp();
    // Last line on screen, so it is clear which casty ran (and whether to update).
    console.log(`casty ${pkg.version}\n`);
    await flushOutput();
    process.exit(0);
  }

  // SIGWINCH: Follow resize + font size changes
  // Debounced (150ms) + guarded with pending flag to catch late resizes
  function onResize() {
    if (shuttingDown) return;
    if (disconnected) { urlBar.render();return; }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  }
  process.on('SIGWINCH', onResize);
  // Windows has no reliable SIGWINCH; the TTY's resize event works everywhere
  // (both firing together is coalesced by the debounce).
  process.stdout.on('resize', onResize);
  // Direct screenshot — bypasses screencast's capturing flag
  captureReady = true;
  if (attachEndpoint) client.on('Page.frameResized', onResize);
  async function directCapture() {
    try {
      const { data } = await capturePolicy.capture({quality:85});
      if (data) onFrame(data);
    } catch {}
  }

  const handleResize = createResizeHandler({
    async update() {
      if (shuttingDown || disconnected) return;
      // Stop old screencast FIRST to prevent stale frames
      await stopScreencast(client, screencastCleanup);

      const t = await getTermInfo({ keepAlive: true });
      if (shuttingDown || disconnected) return;
      const vh = t.height - t.cellHeight;
      if (attachEndpoint) {
        attachedTerm = t;
        attachedViewport = await readAttachViewport(client);
        if (shuttingDown || disconnected) return;
        attachedDisplay = attachDisplay(t,attachedViewport);
        captureGeometry={...attachedViewport,zoom:1};
        setDisplaySize(attachedDisplay.cols,attachedDisplay.rows);
        urlBar.updateCellSize(t.cellWidth,t.cellHeight,1,{width:t.mouseCellWidth,height:t.mouseCellHeight,known:t.pixelGeometryKnown});
        clearScreen();resetFrameCache();await directCapture();urlBar.render();return;
      }
      captureGeometry={width:t.width,height:vh,zoom:t.zoom};
      const cw = Math.round(t.width / t.zoom);
      const ch = Math.round(vh / t.zoom);
      setDisplaySize(t.cols, t.rows - 1);
      console.error(`casty: resize ${cw}x${ch} (dev:${t.width}x${vh}) zoom:${t.zoom.toFixed(2)}`);

      urlBar.updateCellSize(t.cellWidth, t.cellHeight, t.zoom, { width: t.mouseCellWidth, height: t.mouseCellHeight, known: t.pixelGeometryKnown });
      clearScreen();
      resetFrameCache();
      disableDedup(3000); // Force re-send for 3s (bcon may not display first frame)

      await client.send('Emulation.setDeviceMetricsOverride', {
        width: cw, height: ch, deviceScaleFactor: t.zoom, mobile: false,
      }, 30_000); // Loading pages can occupy the renderer longer than the default 10s.

      // Wait for Chrome to finish re-rendering by watching for a screencast frame
      await new Promise(resolve => {
        const onFirstFrame = ({ sessionId }) => {
          client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
          client.removeListener('Page.screencastFrame', onFirstFrame);
          resolve();
        };
        client.on('Page.screencastFrame', onFirstFrame);
        client.send('Page.startScreencast', {
          format: 'jpeg', quality: 10,
          ...screencastRegion(cw, ch),
          everyNthFrame: 1,
        }).catch(() => resolve());
        setTimeout(() => {
          client.removeListener('Page.screencastFrame', onFirstFrame);
          resolve();
        }, 2000);
      });
      await client.send('Page.stopScreencast').catch(() => {});

      // Capture hi-res frame (Chrome has finished rendering)
      await directCapture();
      urlBar.render();

    },
    async resume() {
      if (shuttingDown || disconnected) return;
      // Also resume after a metrics timeout: CDP timeout does not cancel the
      // remote resize, and the browser may finish it after we stop waiting.
      const cw = Math.round(captureGeometry.width / captureGeometry.zoom);
      const ch = Math.round(captureGeometry.height / captureGeometry.zoom);
      ({ forceCapture, cleanup: screencastCleanup } = await startScreencast(client, {
        width: cw,
        height: ch,
        format: capturePolicy.format,
        capturePolicy,
        idleRefreshInterval: attachEndpoint ? 1000 : 0,
        onFrame,
      }));
    },
    onError(err) { if (!shuttingDown) console.error('casty: resize error:', err.message); },
  });
  function onRemoteClose() {
    if (shuttingDown || disconnected) return;
    // A backend exit (including its own watchdog) must not discard the view.
    dismissTimeoutStatus?.();
    dismissTimeoutStatus = null;
    disconnected = true;
    terminalClosing = true;
    clearTimeout(resizeTimer);
    for (const timer of delayedTimers) clearTimeout(timer);
    screencastCleanup?.();
    capturePolicy?.close();
    forceCapture = () => {};
    urlBar.markDisconnected();
  }
  client.on('timeout', ({method, retry}) => {
    if (shuttingDown || disconnected) return;
    dismissTimeoutStatus?.();
    dismissTimeoutStatus = urlBar.showTemporaryStatus(`CDP timeout: ${method}${retry ? ' — retrying' : ' — refreshing; action may have completed'}`, 5000);
    if (!retry) forceCapture?.();
  });
  client.once('close', onRemoteClose);
  if (client.diagnostics().state === 'closed') onRemoteClose();
}

try {
  await main();
} catch (err) {
  stopInputHandling();
  // Restore stdin from raw mode (prevent CSI 14t response leak)
  try { process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
  console.error('casty: error:', err.message);
  disableMouse();
  showCursor();
  cleanupTmp();
  printControlsHelp();
  await flushOutput();
  process.exit(1);
}
