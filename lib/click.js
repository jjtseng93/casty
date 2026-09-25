// Shared trusted-click synthesis for Chrome DevTools Protocol.
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// CASTY_DEBUG_CLICK=1 logs each click to ~/.casty/click.log
const DEBUG_CLICK = !!process.env.CASTY_DEBUG_CLICK;
const DEBUG_LOG = join(homedir(), '.casty', 'click.log');

const DESCRIBE = `const d = el => !el ? null : el.tagName.toLowerCase()
  + (el.id ? '#' + el.id : '')
  + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
  + ' "' + (el.innerText || el.value || '').trim().slice(0, 30).replace(/\\s+/g, ' ') + '"';`;

async function debugBefore(client, x, y) {
  const expression = `(() => { ${DESCRIBE}
    window.__castyClickLog = null;
    document.addEventListener('click', e => {
      window.__castyClickLog = { target: d(e.target), clientX: e.clientX, clientY: e.clientY };
    }, { capture: true, once: true });
    return { atPoint: d(document.elementFromPoint(${x}, ${y})), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, sx: scrollX, sy: scrollY };
  })()`;
  const { result } = await client.send('Runtime.evaluate', { expression, returnByValue: true });
  return result?.value;
}

async function debugAfter(client) {
  const { result } = await client.send('Runtime.evaluate', {
    expression: 'window.__castyClickLog', returnByValue: true,
  });
  return result?.value ?? null;
}

export async function showClickMarker(client, x, y, duration = 800) {
  const expression = `(async () => {
    const old = document.getElementById('__casty_click_marker');
    if (old) old.remove();
    const marker = document.createElement('div');
    marker.id = '__casty_click_marker';
    marker.style.cssText = [
      'position:fixed',
      'left:${x}px',
      'top:${y}px',
      'width:14px',
      'height:14px',
      'margin-left:-7px',
      'margin-top:-7px',
      'box-sizing:border-box',
      'border:2px solid white',
      'border-radius:50%',
      'background:#f00',
      'box-shadow:0 0 0 2px rgba(255,0,0,.45)',
      'pointer-events:none',
      'z-index:2147483647',
    ].join(';');
    document.documentElement.appendChild(marker);
    setTimeout(() => marker.remove(), ${duration});
    await new Promise(resolve => requestAnimationFrame(resolve));
  })()`;
  await client.send('Runtime.evaluate', { expression, awaitPromise: true });
}

// Chrome builds disagree on the Input coordinate space under a
// deviceScaleFactor override: headless-shell consumes device pixels, while
// Chromium with --headless=new consumes CSS pixels as the CDP spec says.
// Probe once per zoom by moving the mouse and reading back clientX.
const scaleCache = new WeakMap(); // client -> Map(zoom -> Promise<scale>)

async function probeInputScale(client, zoom) {
  const P = 97;
  await client.send('Runtime.evaluate', {
    expression: `window.__castyProbe = new Promise(resolve => {
      const t = setTimeout(() => resolve(null), 500);
      addEventListener('mousemove', function on(e) {
        if (e.clientX < 10) return; // skip the reset move
        removeEventListener('mousemove', on, true);
        clearTimeout(t);
        resolve(e.clientX);
      }, true);
    })`,
  });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P, y: P });
  const { result } = await client.send('Runtime.evaluate', {
    expression: 'window.__castyProbe', awaitPromise: true, returnByValue: true,
  });
  const cx = result?.value;
  if (!Number.isFinite(cx)) throw new Error('input scale probe got no mousemove');
  return Math.abs(cx - P) <= Math.abs(cx - P / zoom) ? 1 : zoom;
}

// Resolve the factor that converts page CSS pixels to Input coordinates.
export function getInputScale(client, zoom = 1) {
  if (zoom === 1) return Promise.resolve(1);
  let byZoom = scaleCache.get(client);
  if (!byZoom) scaleCache.set(client, byZoom = new Map());
  let scale = byZoom.get(zoom);
  if (!scale) {
    scale = probeInputScale(client, zoom).catch(() => {
      byZoom.delete(zoom); // retry on next click (e.g. page was not ready)
      return zoom;
    });
    byZoom.set(zoom, scale);
  }
  return scale;
}

export async function dispatchClick(client, x, y, { clickCount = 1, coordinateScale = 1, source = '?' } = {}) {
  const before = DEBUG_CLICK ? await debugBefore(client, x, y).catch(e => ({ error: e.message })) : null;
  await showClickMarker(client, x, y);
  // Keep the marker in page CSS pixels and scale only the input event.
  const scale = await getInputScale(client, coordinateScale);
  const common = {
    x: x * scale,
    y: y * scale,
    button: 'left',
    clickCount,
  };
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...common, buttons: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...common, buttons: 0,
  });
  if (DEBUG_CLICK) {
    const after = await debugAfter(client).catch(e => ({ error: e.message }));
    const line = JSON.stringify({
      t: new Date().toISOString(), source, css: [x, y], zoom: coordinateScale, scale,
      sent: [x * scale, y * scale], clickCount, before, clicked: after,
    });
    try { appendFileSync(DEBUG_LOG, line + '\n'); } catch {}
  }
}
