import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findInPath } from '../lib/chrome.js';
import { detectPlatform, explicitBrowser, extractZip, unzipCommand } from '../lib/install.js';

// A minimal ZIP writer for the tests: entries are { name, data, mode, deflate }.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), mode = 0o100644, deflate = false } of entries) {
    const nameBytes = Buffer.from(name);
    const content = deflate ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, content);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + content.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'casty-install-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('detectPlatform maps to Chrome for Testing platform names', () => {
  assert.equal(detectPlatform('linux', 'x64'), 'linux64');
  assert.equal(detectPlatform('linux', 'arm64'), 'linux-arm64');
  assert.equal(detectPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(detectPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(detectPlatform('win32', 'x64'), 'win64');
  assert.equal(detectPlatform('win32', 'ia32'), 'win32');
});

test('an explicit browser skips installation', () => {
  assert.equal(explicitBrowser({ CASTY_BROWSER: '/b.js' }), true);
  assert.equal(explicitBrowser({ BUN_CHROME_PATH: '/chrome' }), true);
  assert.equal(explicitBrowser({}), false);
});

test('extractZip restores stored and deflated files, directories, modes and symlinks', async () => {
  await withTemp(async (dir) => {
    const big = Buffer.from('chrome '.repeat(10_000));
    const zip = join(dir, 'a.zip');
    writeFileSync(zip, makeZip([
      { name: 'shell/', mode: 0o040755 },
      { name: 'shell/chrome-headless-shell', data: big, mode: 0o100755, deflate: true },
      { name: 'shell/lib/data.txt', data: Buffer.from('plain'), mode: 0o100644 },
      { name: 'shell/empty', mode: 0o100644 },
      // Creating symlinks needs extra rights on Windows.
      ...(process.platform === 'win32' ? [] : [{ name: 'shell/link', data: Buffer.from('lib/data.txt'), mode: 0o120777 }]),
    ]));
    const out = join(dir, 'out');
    await extractZip(zip, out);
    assert.deepEqual(readFileSync(join(out, 'shell/chrome-headless-shell')), big);
    assert.equal(readFileSync(join(out, 'shell/lib/data.txt'), 'utf8'), 'plain');
    assert.equal(statSync(join(out, 'shell/empty')).size, 0);
    if (process.platform !== 'win32') {
      assert.ok(statSync(join(out, 'shell/chrome-headless-shell')).mode & 0o100, 'executable bit kept');
      assert.ok(lstatSync(join(out, 'shell/link')).isSymbolicLink());
      assert.equal(readlinkSync(join(out, 'shell/link')), 'lib/data.txt');
    }
  });
});

test('extractZip refuses entries and links that escape the destination, and non-ZIP files', async () => {
  await withTemp(async (dir) => {
    for (const [label, entries] of [
      ['path traversal', [{ name: '../evil.txt', data: Buffer.from('x') }]],
      ['absolute path', [{ name: '/tmp/evil.txt', data: Buffer.from('x') }]],
      ['symlink outside', [{ name: 'link', data: Buffer.from('../../etc/passwd'), mode: 0o120777 }]],
    ]) {
      const zip = join(dir, `${label}.zip`);
      writeFileSync(zip, makeZip(entries));
      await assert.rejects(extractZip(zip, join(dir, label)), /outside the destination/, label);
    }
    assert.equal(existsSync(join(dir, 'evil.txt')), false);
    writeFileSync(join(dir, 'broken.zip'), 'not a zip at all');
    await assert.rejects(extractZip(join(dir, 'broken.zip'), join(dir, 'broken')), /Not a ZIP archive/);
  });
});

test('unzipCommand prefers unzip, then Windows tar.exe; null means the built-in extractor', () => {
  // No system tool: extractZip() is used.
  assert.equal(unzipCommand('a.zip', 'out', { env: { PATH: '/nonexistent-casty-dir' }, platform: 'linux' }), null);
  // Windows (simulated): System32\tar.exe even if a GNU tar (Git Bash) is in Path.
  const env = { Path: 'C:\\Git\\usr\\bin', SystemRoot: 'C:\\Windows' };
  const exists = (path) => path === 'C:\\Windows\\System32\\tar.exe';
  assert.deepEqual(unzipCommand('a.zip', 'out', { env, platform: 'win32', exists }),
    { command: 'C:\\Windows\\System32\\tar.exe', args: ['-xf', 'a.zip', '-C', 'out'] });
  assert.equal(unzipCommand('a.zip', 'out', { env, platform: 'win32', exists: () => false }), null);
});

test('unzipCommand uses the system unzip when it is installed', { skip: !findInPath('unzip') }, () => {
  assert.deepEqual(unzipCommand('a.zip', 'out'), { command: findInPath('unzip'), args: ['-q', '-o', 'a.zip', '-d', 'out'] });
});

