import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFabric } from '../src/fabric/domain.js';
import { overviewMetrics } from '../src/overview/model.js';
test('overview counts parent documents once and sums weight without enforcing equality', () => {
  const d = initialFabric(),
    m = overviewMetrics(d, () => true);
  assert.equal(m.documents.find((r) => r.key === 'knitting').value, d.knitting_bill.length);
  assert.equal(
    m.weights.find((r) => r.key === 'yarn').value,
    d.yarn_bill_item.reduce((n, r) => n + r.billed_quantity, 0),
  );
  assert.equal(
    m.statuses.reduce((n, r) => n + r.value, 0),
    d.lab_dip.length,
  );
});
test('overview never includes metrics from a section the user cannot view', () => {
  const m = overviewMetrics(initialFabric(), (key) => key === 'orders');
  assert.deepEqual(
    m.documents.map((r) => r.key),
    ['orders'],
  );
  assert.deepEqual(m.weights, []);
  assert.deepEqual(m.statuses, []);
});
test('a user with no permitted sections gets an empty overview without leaking counts', () => {
  assert.deepEqual(
    overviewMetrics(initialFabric(), () => false),
    { documents: [], weights: [], statuses: [] },
  );
});
