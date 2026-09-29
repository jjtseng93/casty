import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Create a fake chrome-headless-shell binary
function createFakeBin(dir, version, { corrupt = false } = {}) {
  const versionDir = join(dir, `chrome-headless-shell-${version}`);
  mkdirSync(versionDir, { recursive: true });
  const binPath = join(versionDir, 'chrome-headless-shell');
  if (corrupt) {
    writeFileSync(binPath, 'CORRUPT_BINARY_DATA');
    chmodSync(binPath, 0o755);
  } else {
    writeFileSync(binPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "HeadlessChrome/${version}"
  exit 0
fi
exit 0
`);
    chmodSync(binPath, 0o755);
  }
  return binPath;
}

// The fake browsers are shell scripts: POSIX only.
const POSIX = { skip: process.platform === 'win32' && 'shell-script fake browsers' };

test('corrupt binary fails --version check', POSIX, () => {
  const dir = join(tmpdir(), `casty-test-${Date.now()}-corrupt`);
  mkdirSync(dir, { recursive: true });
  try {
    createFakeBin(dir, '146.0.7680.80', { corrupt: true });
    const binPath = join(dir, 'chrome-headless-shell-146.0.7680.80', 'chrome-headless-shell');

    let threw = false;
    try {
      execFileSync(binPath, ['--version'], { stdio: 'pipe', timeout: 5000 });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'corrupt binary should fail --version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid binary passes --version check', POSIX, () => {
  const dir = join(tmpdir(), `casty-test-${Date.now()}-valid`);
  mkdirSync(dir, { recursive: true });
  try {
    const binPath = createFakeBin(dir, '146.0.7680.80');
    const output = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
    assert.ok(output.includes('146.0.7680.80'), 'should output version string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('splitBrowserArgs passes everything after -- to the browser', async () => {
  const { splitBrowserArgs } = await import('../lib/chrome.js');
  assert.deepEqual(splitBrowserArgs(['example.com']), { args: ['example.com'], browserArgs: [] });
  assert.deepEqual(splitBrowserArgs(['example.com', '--', '--lang=ja', '--foo']),
    { args: ['example.com'], browserArgs: ['--lang=ja', '--foo'] });
  // No URL: the home page opens, flags still go to the browser.
  assert.deepEqual(splitBrowserArgs(['--', '--foo']), { args: [], browserArgs: ['--foo'] });
  // Only the first -- separates; later ones are browser arguments.
  assert.deepEqual(splitBrowserArgs(['a', '--', 'b', '--', 'c']), { args: ['a'], browserArgs: ['b', '--', 'c'] });
});

test('CASTY_BROWSER, then BUN_CHROME_PATH, choose the browser before any search', async () => {
  const { findChrome } = await import('../lib/chrome.js');
  assert.deepEqual(findChrome({ CASTY_BROWSER: '/opt/buninu/buninu-browser.js', BUN_CHROME_PATH: '/usr/bin/chromium' }),
    { bin: '/opt/buninu/buninu-browser.js', headless: false });
  assert.deepEqual(findChrome({ BUN_CHROME_PATH: '/usr/bin/chromium' }), { bin: '/usr/bin/chromium', headless: true });
  assert.deepEqual(findChrome({ BUN_CHROME_PATH: '/opt/chrome-headless-shell' }),
    { bin: '/opt/chrome-headless-shell', headless: false });
});

test('launchCommand runs scripts with a JS runtime and spawns anything else directly', async () => {
  const { launchCommand } = await import('../lib/chrome.js');
  const { findInPath } = await import('../lib/chrome.js');
  const runtime = globalThis.Bun?.which?.('bun') || findInPath('bun') || process.argv0;
  for (const bin of ['/b/browser.js', '/b/browser.MJS', '/b/browser.ts', '/b/browser.tsx', '/b/browser.cjs']) {
    assert.deepEqual(launchCommand(bin, ['--x']), { command: runtime, args: [bin, '--x'] });
  }
  for (const bin of ['/usr/bin/chromium', 'C:\\Chrome\\chrome.exe', '/b/headless_shell']) {
    assert.deepEqual(launchCommand(bin, ['--x']), { command: bin, args: ['--x'] });
  }
});

test('findInPath finds executables on POSIX and only .exe/.com on Windows', async () => {
  const { findInPath } = await import('../lib/chrome.js');
  const root = join(tmpdir(), `casty-path-${process.pid}`);
  const [plain, noExec] = ['plain', 'noexec'].map((dir) => join(root, dir));
  // Execute bits and ":"-separated PATH: POSIX only.
  if (process.platform !== 'win32') try {
    for (const dir of [plain, noExec]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(noExec, 'bun'), '');
    chmodSync(join(noExec, 'bun'), 0o644);
    writeFileSync(join(plain, 'bun'), '');
    chmodSync(join(plain, 'bun'), 0o755);
    // A file without the execute bit is skipped.
    assert.equal(findInPath('bun', { env: { PATH: [noExec, plain].join(':') }, platform: 'linux' }), join(plain, 'bun'));
    assert.equal(findInPath('bun', { env: { PATH: noExec }, platform: 'linux' }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // Windows (simulated file system): "Path" with ";" and quotes; bun.cmd cannot
  // be spawned without a shell, bun.exe can.
  const files = new Set(['C:\\npm\\bun.cmd', 'C:\\Program Files\\Bun\\bun.exe']);
  const isExecutable = (candidate) => files.has(candidate);
  assert.equal(findInPath('bun', { env: { Path: 'C:\\npm;"C:\\Program Files\\Bun"' }, platform: 'win32', isExecutable }),
    'C:\\Program Files\\Bun\\bun.exe');
  assert.equal(findInPath('bun', { env: { Path: 'C:\\npm' }, platform: 'win32', isExecutable }), null);
  assert.equal(findInPath('bun', { env: { path: 'C:\\Program Files\\Bun' }, platform: 'win32', isExecutable }),
    'C:\\Program Files\\Bun\\bun.exe');
});
