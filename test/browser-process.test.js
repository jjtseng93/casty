import {test, expect} from 'bun:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {stopBrowserProcess} from '../lib/browser-process.js';

test('attach and already exited browsers are not terminated', () => {
  stopBrowserProcess(null);
  let killed = false;
  stopBrowserProcess({exitCode: 0, kill() { killed = true; }});
  stopBrowserProcess({exitCode: null, signalCode: 'SIGTERM', kill() { killed = true; }});
  expect(killed).toBe(false);
});

test.skipIf(process.platform !== 'win32')('Windows browser shutdown also terminates descendants', async () => {
  const child = spawn(process.execPath, ['-e', `
    const child = Bun.spawn([process.execPath, '-e', 'setInterval(()=>{},1000)'], {stdout:'ignore',stderr:'ignore'});
    console.log(child.pid);
    setInterval(()=>{},1000);
  `], {stdio: ['ignore','pipe','ignore']});
  let descendant;
  try {
    const [chunk] = await once(child.stdout, 'data');
    descendant = Number(String(chunk).trim());
    expect(descendant).toBeGreaterThan(0);
    const exited = once(child, 'exit');
    stopBrowserProcess(child);
    await exited;
    await Bun.sleep(200);
    expect(() => process.kill(descendant, 0)).toThrow();
  } finally {
    stopBrowserProcess(child);
    if (descendant) { try { process.kill(descendant); } catch {} }
  }
}, 10000);
