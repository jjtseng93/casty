import { expect, test } from 'bun:test';
import { splitBrowserArgs } from '../lib/chrome.js';

test('--win32 remains a casty option and browser flags stay after --', () => {
  const own = new Set(['--win32']);
  expect(splitBrowserArgs(['--win32', 'example.com', '--', '--mobile'], own))
    .toEqual({ args: ['--win32', 'example.com'], browserArgs: ['--mobile'] });
});

test('--win32 reports a platform error without loading Windows DLLs elsewhere', async () => {
  if (process.platform === 'win32') return;
  const { runWin32 } = await import('../lib/win32.js');
  expect(await runWin32([], [])).toBe(2);
});
