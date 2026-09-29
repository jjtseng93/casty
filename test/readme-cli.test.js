import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('README TUI and WUI options run jsmdcui beside the source and its images',
  { skip: process.platform === 'win32' && 'POSIX bun stub' }, () => {
    const bun = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim();
    const fakeBin = mkdtempSync(join(tmpdir(), 'casty-bun-test-'));
    try {
      const fakeBun = join(fakeBin, 'bun');
      writeFileSync(fakeBun, `#!/bin/sh
printf '%s\n' "$PWD" "$@"
test -f README.md && test -f README.zh-TW.md && test -f README.ja.md && test -f docs/screenshot-ghostty.png
exit 7
`);
      chmodSync(fakeBun, 0o755);
      for (const mode of ['tui', 'wui']) {
        for (const [suffix, readme] of [['', 'README.md'], ['-zh', 'README.zh-TW.md'], ['-ja', 'README.ja.md']]) {
          const run = spawnSync(bun, [join(root, 'index.js'), `--readme-${mode}${suffix}`], {
            cwd: fakeBin,
            env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
            encoding: 'utf8',
          });
          assert.equal(run.status, 7, run.stderr);
          const [workDir, x, command, actualMode, actualReadme, kitty] = run.stdout.trim().split('\n');
          assert.equal(workDir, root);
          assert.equal(x, 'x');
          assert.equal(command, 'jsmdcui');
          assert.equal(actualMode, `--${mode}`);
          assert.equal(actualReadme, readme);
          assert.equal(kitty, '--kitty');
        }
      }
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
