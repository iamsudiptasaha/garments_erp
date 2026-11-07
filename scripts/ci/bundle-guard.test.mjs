import { spawnSync } from 'node:child_process';
import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

test('release asset guard accepts 25 MiB and rejects one byte more', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'erp-bundle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guard = fileURLToPath(new URL('./bundle-guard.mjs', import.meta.url));
  const asset = join(root, 'asset.bin');
  const limit = 25 * 1024 * 1024;
  for (const size of [limit, limit + 1]) {
    const fd = openSync(asset, 'w');
    ftruncateSync(fd, size);
    closeSync(fd);
    const result = spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });
    assert.equal(result.status, size === limit ? 0 : 1, result.stderr);
    if (size > limit) assert.match(result.stderr, /asset\.bin: .*25 MiB static asset limit/);
  }
});
