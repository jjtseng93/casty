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
// Chromium with --headless=new consumes CSS pixels as the CDP spec says, and
// the behaviour can change across navigations. So every click probes: move
// the mouse to the CSS target and see which space the page received it in.
const lastScale = new WeakMap(); // client -> { zoom, scale }

async function probeInputScale(client, zoom, x, y) {
  await client.send('Runtime.evaluate', {
    expression: `window.__castyProbe = new Promise(resolve => {
      const t = setTimeout(() => { removeEventListener('mousemove', on, true); resolve(null); }, 150);
      function on(e) {
        removeEventListener('mousemove', on, true);
        clearTimeout(t);
        resolve([e.clientX, e.clientY]);
      }
      addEventListener('mousemove', on, true);
    })`,
  });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const { result } = await client.send('Runtime.evaluate', {
    expression: 'window.__castyProbe', awaitPromise: true, returnByValue: true,
  });
  const got = result?.value;
  if (!got) return null; // pointer did not move, or target is in a cross-origin frame
  const dist = (px, py) => Math.hypot(got[0] - px, got[1] - py);
  if (dist(x, y) === dist(x / zoom, y / zoom)) return null; // indistinguishable near origin
  return dist(x, y) < dist(x / zoom, y / zoom) ? 1 : zoom;
}

// Last probed factor from page CSS pixels to Input coordinates, for
// high-frequency events (drag, wheel, hover) that must not probe each time.
export function getInputScale(client, zoom = 1) {
  if (zoom === 1) return 1;
  const last = lastScale.get(client);
  return last && last.zoom === zoom ? last.scale : zoom;
}

async function resolveInputScale(client, zoom, x, y) {
  if (zoom === 1) return 1;
  const probed = await probeInputScale(client, zoom, x, y).catch(() => null);
  if (probed === null) return getInputScale(client, zoom);
  lastScale.set(client, { zoom, scale: probed });
  return probed;
}

export async function dispatchClick(client, x, y, { clickCount = 1, coordinateScale = 1, source = '?' } = {}) {
  const before = DEBUG_CLICK ? await debugBefore(client, x, y).catch(e => ({ error: e.message })) : null;
  await showClickMarker(client, x, y);
  // Keep the marker in page CSS pixels and scale only the input event.
  const scale = await resolveInputScale(client, coordinateScale, x, y);
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
