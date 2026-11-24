import {join} from 'node:path';

// Windows termination bypasses JavaScript cleanup. Discover and terminate
// descendants while their controller still exists. Attach peers pass no proc.
export function stopBrowserProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode != null) return;
  if (process.platform === 'win32') {
    const result = Bun.spawnSync([
      join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'),
      '/PID', String(proc.pid), '/T', '/F',
    ], {stdout: 'ignore', stderr: 'ignore', windowsHide: true});
    if (result.exitCode === 0) return;
  }
  proc.kill();
}
