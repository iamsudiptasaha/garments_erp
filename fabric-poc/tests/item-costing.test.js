import assert from 'node:assert/strict';
import test from 'node:test';

import { approvedAmount, costingTotals } from '../src/finished-goods/item-costing.js';

test('approved amount derives from pieces and rate and preserves missing inputs', () => {
  assert.equal(approvedAmount({ approved_quantity: '20', approved_rate: '55' }), 1100);
  assert.equal(approvedAmount({ approved_quantity: '', approved_rate: 55 }), null);
  assert.equal(approvedAmount({ approved_quantity: 0, approved_rate: 55 }), 0);
});

test('discount precedes profit while both stay outside manufacturing cost', () => {
  const lines = [
    { section: 'Fabrics', approved_quantity: 1, approved_rate: 100 },
    { section: 'Peripherals', peripheral_type: 'discount', approved_rate: 5 },
    { section: 'Peripherals', peripheral_type: 'profit', approved_rate: 5 },
  ];
  assert.deepEqual(costingTotals(lines), {
    base: 100,
    manufacturing: 100,
    amounts: { overhead: 0, rejection: 0, discount: -5, profit: 5 },
  });
});
