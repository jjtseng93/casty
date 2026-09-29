// Chrome process launch and binary detection

import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, existsSync, rmSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { basename, extname, join, posix, win32 } from 'node:path';
import { homedir } from 'node:os';

const BROWSERS_DIR = join(homedir(), '.casty', 'browsers');
const IS_ARM_LINUX = process.platform === 'linux' && process.arch === 'arm64';

// Split command-line arguments at the first "--": casty's own arguments come
// before it, and everything after it is passed to the browser unchanged.
export function splitBrowserArgs(argv) {
  const index = argv.indexOf('--');
  return index < 0
    ? { args: argv, browserArgs: [] }
    : { args: argv.slice(0, index), browserArgs: argv.slice(index + 1) };
}

// Recursively search for headless shell binary in a Playwright-style directory
// Binary name varies by version: chrome-headless-shell or headless_shell
const HEADLESS_BINS = ['chrome-headless-shell', 'headless_shell'];
function findBinInDir(base) {
  try {
    for (const name of HEADLESS_BINS) {
      // Check directly under base
      const direct = join(base, name);
      if (existsSync(direct) && statSync(direct).isFile()) return direct;
    }
    // Search subdirectories
    for (const sub of readdirSync(base)) {
      for (const name of HEADLESS_BINS) {
        const bin = join(base, sub, name);
        if (existsSync(bin) && statSync(bin).isFile()) return bin;
      }
    }
  } catch {}
  return null;
}

// Detect Chrome binary
// Returns: { bin, headless } — headless=true means system Chrome (needs --headless=new)
// Browsers written in JavaScript/TypeScript are run with a JS runtime rather
// than executed directly (no reliance on shebang lines or execute bits).
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']);

// Find an executable in PATH. On Windows only .exe/.com count: .cmd/.bat
// cannot be spawned without a shell.
function isExecutableFile(candidate, windows) {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (!windows) accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findInPath(name, { env = process.env, platform = process.platform, isExecutable = isExecutableFile } = {}) {
  const windows = platform === 'win32';
  const path = windows ? win32 : posix;
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const names = windows ? ['.exe', '.com'].map((ext) => name + ext) : [name];
  for (const dir of dirs) {
    for (const file of names) {
      const candidate = path.join(dir, file);
      if (isExecutable(candidate, windows)) return candidate;
    }
  }
  return null;
}

// The command that starts `bin` with `args`: scripts go through Bun (found by
// Bun itself, else in PATH, else the runtime running casty), everything else
// is spawned directly.
export function launchCommand(bin, args = []) {
  if (!SCRIPT_EXTENSIONS.has(extname(bin).toLowerCase())) return { command: bin, args };
  const runtime = globalThis.Bun?.which?.('bun') || findInPath('bun') || process.argv0;
  return { command: runtime, args: [bin, ...args] };
}

// A browser named explicitly by CASTY_BROWSER or BUN_CHROME_PATH. Scripts and
// headless-shell builds get no --headless=new; full Chrome/Chromium does.
function browserFromEnv(env = process.env) {
  const bin = env.CASTY_BROWSER || env.BUN_CHROME_PATH;
  if (!bin) return null;
  const script = SCRIPT_EXTENSIONS.has(extname(bin).toLowerCase());
  return { bin, headless: !script && !/headless/i.test(basename(bin)) };
}

export function findChrome(env = process.env) {
  // Explicit choice first: CASTY_BROWSER, then BUN_CHROME_PATH.
  const explicit = browserFromEnv(env);
  if (explicit) return explicit;

  // 0. System chromium-headless-shell (Debian package) takes priority. It is
  // the standalone "old" headless-shell binary, so headless=false: appending
  // --headless=new would mix the new Chrome headless mode into it.
  try {
    const path = execFileSync('which', ['chromium-headless-shell'], { encoding: 'utf8' }).trim();
    if (path) return { bin: path, headless: false };
  } catch {}

  if (existsSync(BROWSERS_DIR)) {
    const entries = readdirSync(BROWSERS_DIR).sort().reverse();

    // 1. Chrome for Testing headless-shell (x86_64 only, skip ARM64 Linux)
    if (!IS_ARM_LINUX) {
      for (const dir of entries) {
        if (!dir.startsWith('chrome-headless-shell-')) continue;
        const bin = join(BROWSERS_DIR, dir, 'chrome-headless-shell');
        if (existsSync(bin)) return { bin, headless: false };
      }
    }

    // 2. Playwright format (all platforms)
    for (const dir of entries) {
      if (!dir.startsWith('chromium_headless_shell-')) continue;
      const bin = findBinInDir(join(BROWSERS_DIR, dir));
      if (bin) return { bin, headless: false };
    }
  }

  // 3. System Chrome/Chromium (fallback)
  const candidates = [
    { name: 'chromium-browser', headless: true },
    { name: 'chromium', headless: true },
    { name: 'google-chrome-stable', headless: true },
    { name: 'google-chrome', headless: true },
  ];
  for (const { name, headless } of candidates) {
    try {
      const path = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (path) return { bin: path, headless };
    } catch {}
  }

  return null;
}

// Prevent profile bloat (delete caches/DBs except cookies/localStorage)
// Chrome processes these on startup, so accumulation slows launch dramatically
function cleanProfile(userDataDir) {
  const def = join(userDataDir, 'Default');
  if (!existsSync(def)) return;
  const KEEP = new Set([
    'Cookies', 'Cookies-journal',
    'Local Storage',
    'Preferences', 'Secure Preferences',
  ]);
  try {
    for (const entry of readdirSync(def)) {
      if (KEEP.has(entry)) continue;
      rmSync(join(def, entry), { recursive: true, force: true });
    }
  } catch {}
}

// Launch Chrome, return DevTools WebSocket URL
export function launchChrome({ userDataDir, windowSize, args = [] } = {}) {
  cleanProfile(userDataDir);
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found. Install chromium-browser or run ./bin/casty to install.');

  const chromeArgs = [
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--auto-grant-permissions',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    // Media playback (autoplay without user gesture in headless)
    '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies',
    // Reduce startup overhead
    '--disable-breakpad',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    `--user-data-dir=${userDataDir}`,
  ];
  // System Chrome needs --headless=new (headless-shell doesn't)
  if (chrome.headless) {
    chromeArgs.push('--headless=new');
  }
  // Linux often lacks sandbox support (VMs, containers, etc.)
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
  }
  if (windowSize) {
    chromeArgs.push(`--window-size=${windowSize.width},${windowSize.height}`);
  }
  chromeArgs.push(...args);

  const { command, args: commandArgs } = launchCommand(chrome.bin, chromeArgs);
  const proc = spawn(command, commandArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Extract DevTools URL from stderr
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  let stderr = '';
  const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) {
      clearTimeout(timeout);
      const wsUrl = m[1];
      const portMatch = wsUrl.match(/:(\d+)\//);
      const port = portMatch ? parseInt(portMatch[1]) : 0;
      resolve({ proc, wsUrl, port });
    }
  });

  proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  proc.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited with code ${code}\n${stderr}`)); });

  return promise;
}
