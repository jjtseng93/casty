// Browser installation and updates, kept in ~/.casty/browsers:
// Chrome for Testing's chrome-headless-shell, or Playwright's build on ARM64
// Linux (where Chrome for Testing has none). Checks for a newer version in the
// background once a day.

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, createReadStream, createWriteStream, existsSync, fstatSync, mkdirSync, mkdtempSync,
  openSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createInflateRaw } from 'node:zlib';
import { findBinInDir, findInPath, headlessBinaryName } from './chrome.js';

const CASTY_HOME = join(homedir(), '.casty');
export const BROWSERS_DIR = join(CASTY_HOME, 'browsers');
const STAMP = join(CASTY_HOME, '.update-check');
const VERSIONS_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SYSTEM_BROWSERS = ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome'];

// Chrome for Testing platform names.
export function detectPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (platform === 'win32') return arch === 'ia32' ? 'win32' : 'win64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'; // not offered by Chrome for Testing
  return 'linux64';
}

const isArm64Linux = () => detectPlatform() === 'linux-arm64';

// CASTY_BROWSER / BUN_CHROME_PATH name a browser: nothing to install or update.
export function explicitBrowser(env = process.env) {
  return Boolean(env.CASTY_BROWSER || env.BUN_CHROME_PATH);
}

function dirsByAge(prefix) {
  if (!existsSync(BROWSERS_DIR)) return [];
  return readdirSync(BROWSERS_DIR)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(BROWSERS_DIR, name))
    .filter((path) => statSync(path).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

// A headless shell managed by casty (or the Debian chromium-headless-shell).
export function hasManagedChrome() {
  if (!isArm64Linux()) {
    const binary = headlessBinaryName();
    if (dirsByAge('chrome-headless-shell-').some((dir) => existsSync(join(dir, binary)))) return true;
  }
  if (dirsByAge('chromium_headless_shell-').some((dir) => findBinInDir(dir))) return true;
  return Boolean(findInPath('chromium-headless-shell'));
}

export function hasSystemChrome() {
  return SYSTEM_BROWSERS.some((name) => findInPath(name));
}

function touchStamp() {
  mkdirSync(CASTY_HOME, { recursive: true });
  const now = new Date();
  if (existsSync(STAMP)) utimesSync(STAMP, now, now);
  else writeFileSync(STAMP, '');
}

export function needsUpdate(now = Date.now()) {
  try {
    return now - statSync(STAMP).mtimeMs > UPDATE_INTERVAL_MS;
  } catch {
    return true;
  }
}

// Keep the newest `keep` directories with the prefix; a running casty may
// still use the previous version.
function removeOld(prefix, keep) {
  for (const dir of dirsByAge(prefix).slice(keep)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // In use (Windows cannot delete a running executable): next time.
    }
  }
}

// Download to a file, with a progress line when stderr is a terminal.
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  const showProgress = process.stderr.isTTY && total > 0;
  let received = 0;
  let shown = -1;
  const body = Readable.fromWeb(response.body);
  if (showProgress) {
    body.on('data', (chunk) => {
      received += chunk.length;
      const percent = Math.floor((received / total) * 100);
      if (percent !== shown) process.stderr.write(`\rcasty: downloading ${(shown = percent)}%`);
    });
  }
  try {
    await pipeline(body, createWriteStream(file));
  } finally {
    if (showProgress) process.stderr.write('\n');
  }
}

// The system tool that extracts a .zip: unzip, else (Windows) the bsdtar
// shipped as System32\tar.exe, which reads ZIP archives. Null when neither
// is available; extractZip() below is used then.
export function unzipCommand(zip, destination, {
  env = process.env, platform = process.platform, exists = existsSync,
} = {}) {
  const unzip = findInPath('unzip', { env, platform });
  if (unzip) return { command: unzip, args: ['-q', '-o', zip, '-d', destination] };
  if (platform === 'win32') {
    // Prefer Windows' own tar: a GNU tar earlier in PATH (Git Bash) cannot read ZIP.
    const systemTar = win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'tar.exe');
    const tar = exists(systemTar) ? systemTar : findInPath('tar', { env, platform });
    if (tar) return { command: tar, args: ['-xf', zip, '-C', destination] };
  }
  return null;
}

// System tools first; the built-in extractor when there are none. A system
// tool that fails is reported, not retried, so real errors (a full disk)
// are not hidden.
async function extract(zip, destination) {
  const extractor = unzipCommand(zip, destination);
  if (!extractor) {
    await extractZip(zip, destination);
    return;
  }
  mkdirSync(destination, { recursive: true });
  const result = spawnSync(extractor.command, extractor.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  if (result.status !== 0) throw new Error(`Extraction failed (disk full?) ${String(result.stderr ?? '').trim()}`.trim());
}

// Chrome for Testing's latest stable chrome-headless-shell.
export async function installChromeForTesting() {
  const platform = detectPlatform();
  let versions;
  try {
    versions = await (await fetch(VERSIONS_URL)).json();
  } catch {
    throw new Error('Failed to fetch Chrome version info');
  }
  const version = versions?.channels?.Stable?.version;
  const url = versions?.channels?.Stable?.downloads?.['chrome-headless-shell']?.find((entry) => entry.platform === platform)?.url;
  if (!version || !url) throw new Error(`No chrome-headless-shell for ${platform}`);

  const binary = headlessBinaryName();
  const destination = join(BROWSERS_DIR, `chrome-headless-shell-${version}`);
  if (existsSync(join(destination, binary))) {
    touchStamp();
    return destination;
  }

  console.error(`casty: Installing Chrome Headless Shell ${version}...`);
  mkdirSync(BROWSERS_DIR, { recursive: true });
  // Work inside BROWSERS_DIR so the final rename stays on one file system.
  const work = mkdtempSync(join(BROWSERS_DIR, '.install-'));
  try {
    const zip = join(work, 'download.zip');
    await download(url, zip);
    const extracted = join(work, 'extracted');
    try {
      await extract(zip, extracted);
    } catch (err) {
      throw new Error(err.message.startsWith('Extraction failed') ? err.message : `Extraction failed (${err.message})`);
    }
    // The archive holds a single chrome-headless-shell-<platform>/ directory.
    const inner = readdirSync(extracted).find((name) => name.startsWith('chrome-headless-shell-'));
    if (!inner || !existsSync(join(extracted, inner, binary))) throw new Error('Extraction failed');
    rmSync(destination, { recursive: true, force: true });
    renameSync(join(extracted, inner), destination);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // A truncated or corrupt download fails here.
  const check = spawnSync(join(destination, binary), ['--version'], { stdio: 'ignore', timeout: 30_000 });
  if (check.status !== 0) {
    rmSync(destination, { recursive: true, force: true });
    throw new Error('Downloaded headless-shell is broken, removed it');
  }
  touchStamp();
  console.error(`casty: Installed Chrome Headless Shell ${version}`);
  return destination;
}

// ARM64 Linux: Playwright's chromium-headless-shell build.
export function installWithPlaywright() {
  console.error('casty: Installing Chrome Headless Shell via Playwright...');
  const result = spawnSync('npx', ['-y', 'playwright', 'install', 'chromium-headless-shell'], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR },
    stdio: ['ignore', 2, 2],
  });
  if (result.status !== 0) return false;
  touchStamp();
  // Only the newest build (and Playwright's ffmpeg) is kept.
  removeOld('chromium_headless_shell-', 1);
  removeOld('ffmpeg-', 1);
  return true;
}

async function update() {
  if (isArm64Linux()) {
    installWithPlaywright();
  } else {
    await installChromeForTesting();
    removeOld('chrome-headless-shell-', 2);
  }
}

// Make sure there is a browser before casty starts; exits if there is none.
export async function ensureChrome(env = process.env) {
  if (explicitBrowser(env)) return;
  if (!hasManagedChrome()) {
    try {
      if (isArm64Linux()) installWithPlaywright();
      else await installChromeForTesting();
    } catch (err) {
      console.error(`casty: ${err.message}`);
    }
    if (!hasManagedChrome() && !hasSystemChrome()) {
      console.error('casty: Chrome not found.');
      if (isArm64Linux()) console.error('casty: Install with: sudo apt install chromium-browser');
      process.exit(1);
    }
  }
  if (needsUpdate()) {
    // Detached so it can finish after casty exits.
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--background-update'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }
}

// --- Built-in ZIP extraction (when no system tool is available) -------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, position + done);
    if (count === 0) throw new Error('Unexpected end of archive');
    done += count;
  }
  return buffer;
}

// Extracts a ZIP archive (stored and deflated entries, Unix modes, symlinks)
// into `destination`, refusing entries that would land outside it. ZIP64 and
// encrypted archives are not supported.
export async function extractZip(file, destination) {
  mkdirSync(destination, { recursive: true });
  const root = realpathSync(destination);
  const inside = (path) => {
    const rel = relative(root, path);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  const fd = openSync(file, 'r');
  const links = [];
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = readAt(fd, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive');
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    const directory = readAt(fd, directoryOffset, directorySize);

    let offset = 0;
    for (let index = 0; index < entries; index++) {
      if (directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('Corrupt central directory');
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const size = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const mode = directory.readUInt32LE(offset + 38) >>> 16;
      const localOffset = directory.readUInt32LE(offset + 42);
      const name = directory.toString('utf8', offset + 46, offset + 46 + nameLength);
      offset += 46 + nameLength + extraLength + commentLength;

      if (flags & 1) throw new Error(`Encrypted entry: ${name}`);
      const target = resolve(root, name);
      if (!inside(target)) throw new Error(`Entry outside the destination: ${name}`);
      if (name.endsWith('/')) {
        mkdirSync(target, { recursive: true });
        continue;
      }
      if (method !== 0 && method !== 8) throw new Error(`Unsupported compression method ${method}: ${name}`);

      const local = readAt(fd, localOffset, 30);
      if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`Corrupt entry: ${name}`);
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      mkdirSync(dirname(target), { recursive: true });

      if ((mode & 0o170000) === 0o120000) {
        // Symlink: the data is the link target. Created last, and only if it
        // stays inside the destination.
        const data = compressedSize ? readAt(fd, start, compressedSize) : Buffer.alloc(0);
        const linkTarget = method === 8 ? await inflate(data) : data.toString('utf8');
        links.push({ target, linkTarget });
        continue;
      }

      // Each entry reads through its own descriptor: pipeline() closes it.
      const source = compressedSize
        ? createReadStream(file, { start, end: start + compressedSize - 1 })
        : Readable.from([]);
      const output = createWriteStream(target);
      await (method === 8 ? pipeline(source, createInflateRaw(), output) : pipeline(source, output));
      if (statSync(target).size !== size) throw new Error(`Size mismatch: ${name}`);
      // The archive's permission bits, as unzip restores them.
      if (mode & 0o777) chmodSync(target, mode & 0o777);
    }
  } finally {
    closeSync(fd);
  }
  for (const { target, linkTarget } of links) {
    if (!inside(resolve(dirname(target), linkTarget))) throw new Error(`Link outside the destination: ${target}`);
    rmSync(target, { force: true });
    symlinkSync(linkTarget, target);
  }
}

async function inflate(data) {
  const chunks = [];
  await pipeline(Readable.from([data]), createInflateRaw(), async function* (source) {
    for await (const chunk of source) chunks.push(chunk);
  });
  return Buffer.concat(chunks).toString('utf8');
}

// Background update entry: `node lib/install.js --background-update`.
if (process.argv[2] === '--background-update' && resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  update().catch(() => {});
}
