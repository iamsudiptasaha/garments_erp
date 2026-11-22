import test from 'node:test';
import assert from 'node:assert/strict';
import { transferableHeads, receiptQuantity } from '../src/inventory/transferable-records.js';
import { inventoryCommands } from '../src/fabric/inventory-live.js';
import { inventoryPages } from '../src/inventory/catalog.js';
import { receiptFields } from '../src/inventory/receipts.js';

test('transferable projection preserves receipt identity and uses database state and actions', () => {
  const data = {
    raw_material_check_in: [
      { id: '9007199254740999', is_transferable: true, quantity: 12, raw_material_item_id: '3' },
      { id: '2', is_transferable: false },
    ],
    raw_material_item: [{ id: '3', name: 'Frame set', unit_of_measure_id: '4' }],
    unit_of_measure: [{ id: '4', unit: 'pieces' }],
    transferable_receipt_state: [
      {
        id: '9007199254740999',
        status: 'Discarded',
        allowed_actions: ['Restore'],
        last_movement_id: '9007199254741000',
      },
    ],
    transferable_item_movement: [
      { id: '9007199254741000', raw_material_check_in_id: '9007199254740999', type: 'Discard' },
    ],
  };
  const [head] = transferableHeads(data);
  assert.equal(head.id, '9007199254740999');
  assert.equal(head.quantity, 12);
  assert.equal(head.status, 'Discarded');
  assert.deepEqual(head.allowed_actions, ['Restore']);
  assert.equal(head.events.length, 1);
  assert.equal(receiptQuantity({ quantity: 1, unit: 'pieces' }), '1 piece');
  assert.equal(receiptQuantity({ quantity: 12, unit: 'pieces' }), '12 pieces');
  assert.equal(receiptQuantity({ quantity: 12, unit: 'piece' }), '12 pieces');
  assert.equal(receiptQuantity({ quantity: 2.5, unit: 'kg' }), '2.5 kg');
});

test('movement adapter sends exact reviewed revision and preserves server validation errors', async () => {
  const reviewed = {
    p_receipt_id: '99',
    p_expected_movement_id: '8',
    p_receipt_updated_at: '2026-11-22T10:01:00.123456Z',
    p_type_id: '2',
    p_job_worker_id: null,
    p_item_id: null,
    p_employee_id: '3',
    p_remarks: 'Returned',
  };
  let calls = 0;
  const commands = inventoryCommands({
    rpc: async (name, payload) => {
      calls++;
      assert.equal(name, 'erp_record_transferable_movement');
      assert.deepEqual(payload, reviewed);
      return { error: { message: 'Receipt changed. Reload and review again.' } };
    },
  });
  await assert.rejects(commands.recordMovement(reviewed), /Receipt changed/);
  assert.equal(calls, 1);
});

test('Stock In consumes authoritative lock reasons and identity restrictions', () => {
  const data = {
    raw_material_purchase_order: [],
    raw_material_supplier_list: [],
    raw_material_purchase_order_item: [],
    transferable_receipt_state: [
      { id: '7', identity_locked: true, transferability_lock_reason: 'Movement history' },
    ],
  };
  const spec = receiptFields(inventoryPages.materialReceipts, data, 'order', {
    id: '7',
    raw_material_purchase_order_item_id: '9',
  });
  assert.equal(spec.header.find((f) => f.key === 'is_transferable').disabled, true);
  assert.equal(spec.header.find((f) => f.key === 'quantity').readOnly, true);
  assert.equal(spec.header.find((f) => f.key === 'material_category_id').disabled, true);
});

test('database race harness refuses remote database targets', async () => {
  const { verifyTransferableConcurrency } =
    await import('../integration/transferable-materials.mjs');
  await assert.rejects(
    verifyTransferableConcurrency('postgresql://test:dummy@example.invalid/postgres'),
    /Local tests only/,
  );
});
