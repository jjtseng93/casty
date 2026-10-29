import {cdpJson} from './cdp-http.js';
import { CDPClient } from './cdp.js';

export function parseAttachEndpoint(value) {
  if (/^\d+$/.test(value)) {
    const port = Number(value);
    if (port < 1 || port > 65535) throw Error('Attach port must be 1–65535');
    return new URL(`http://127.0.0.1:${port}`);
  }
  const url = new URL(value);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw Error('Attach requires a port, HTTP(S) endpoint or page WebSocket URL');
  if (['ws:', 'wss:'].includes(url.protocol) && !url.pathname.startsWith('/devtools/page/'))
    throw Error('Use a /devtools/page/... WebSocket URL, or an HTTP endpoint to select a page');
  return url;
}

export async function readAttachViewport(client) {
  const metrics = await client.send('Page.getLayoutMetrics');
  const viewport = metrics.cssVisualViewport || metrics.cssLayoutViewport || metrics.visualViewport || metrics.layoutViewport;
  const width = viewport?.clientWidth, height = viewport?.clientHeight;
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw Error('CDP did not report a valid viewport');
  return { width, height };
}

export async function attachPage(endpoint) {
  const url = parseAttachEndpoint(endpoint);
  let wsUrl = url.href, versionInfo;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const get = path => cdpJson(new URL(path, url));
    const targets = await get('/json/list');
    const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (pages.length !== 1) throw Error(pages.length
      ? `Multiple pages: choose a page WebSocket URL:\n${pages.map(t => `${t.title || t.url || t.id}\n  ${t.webSocketDebuggerUrl}`).join('\n')}`
      : 'No existing CDP page; attach never creates a page');
    wsUrl = pages[0].webSocketDebuggerUrl;
    versionInfo = await get('/json/version').catch(() => undefined);
  }
  const client = new CDPClient();
  try {
    await client.connect(wsUrl);
    client.versionInfo = versionInfo;
    await client.send('Page.enable');
    const viewport = await readAttachViewport(client);
    return {client, cssWidth:viewport.width, cssHeight:viewport.height};
  } catch(error) { client.close(); throw error; }
}

// Fit the existing viewport into terminal cells without changing the target.
export function attachDisplay(term, viewport) {
  // Kitty placements use actual terminal cells, not the rounded capture pixels.
  const cellWidth = term.mouseCellWidth || term.cellWidth;
  const cellHeight = term.mouseCellHeight || term.cellHeight;
  const scale = Math.min(term.cols*cellWidth / viewport.width, (term.rows-1)*cellHeight / viewport.height);
  // The caller already reserved the rightmost column. Round the fitted cell
  // counts instead of flooring again: CDP viewport rounding (or floating-point
  // error) can otherwise turn e.g. 43.99 usable columns into just 43.
  // Clamp to the available grid; substantial aspect-ratio gaps remain intact.
  const cols = Math.max(1, Math.min(term.cols, Math.round(viewport.width*scale/cellWidth)));
  const rows = Math.max(1, Math.min(term.rows-1, Math.round(viewport.height*scale/cellHeight)));
  return {cols, rows, map(col,row) {
    if(col<=0 || col>cols || row<2 || row>rows+1) return null;
    return {x:(col-.5)*viewport.width/cols, y:(row-1.5)*viewport.height/rows};
  }};
}
