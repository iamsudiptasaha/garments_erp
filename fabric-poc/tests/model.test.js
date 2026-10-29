import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, clone, project, applyChanges } from '../src/model.js';
test('greige balances sum gross consumption and group by bill + fabric', () => {
  const rows = project(seed, 'greige');
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.fabricName === '30S Sinker').left, 85);
  assert.equal(rows.find((r) => r.fabricName === '30S Rib').left, 17);
});
test('editing consumption updates yarn balance without mutating original', () => {
  const next = applyChanges(seed, 'knitting', [{ id: 'k1', key: 'consumption', value: 550 }]);
  assert.equal(project(next, 'yarn')[0].left, 330);
  assert.equal(project(seed, 'yarn')[0].left, 380);
});
test('editing gross updates greige balance, wastage and final price', () => {
  const next = applyChanges(seed, 'dyed', [{ id: 'd1', key: 'gross', value: 320 }]);
  assert.equal(project(next, 'greige')[0].left, 65);
  const dyed = project(next, 'dyed')[0];
  assert.equal(dyed.wastage, 10);
  assert.ok(Math.abs(dyed.finalPrice - 315.7) < 1e-8);
});
test('bulk update validates the whole batch and rejects invalid stock', () => {
  assert.throws(
    () => applyChanges(seed, 'dyed', [{ id: 'd1', key: 'gross', value: 500 }]),
    /exceeds knitted/,
  );
  assert.throws(
    () => applyChanges(seed, 'dyed', [{ id: 'd1', key: 'billed', value: 301 }]),
    /exceeds gross/,
  );
  assert.throws(
    () => applyChanges(seed, 'knitting', [{ id: 'k1', key: 'rate', value: NaN }]),
    /non-negative/,
  );
  assert.deepEqual(seed, clone(seed));
});
