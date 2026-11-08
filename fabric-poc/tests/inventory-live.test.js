import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryCommands } from '../src/fabric/inventory-live.js';

test('Inventory loads physical receipt fields and saves exact PO line and revision', async () => {
  const stored = {
    id: '9007199254740993',
    updated_at: '2026-11-08T00:00:00Z',
    inward_date: '2026-11-08',
    billed_quantity: 10,
    billed_price: 2,
    raw_material_purchase_order_item_id: '12',
    raw_material_item_id: '7',
  };
  const client = {
    async rpc(name, args) {
      if (name === 'erp_raw_material_transaction_snapshot')
        return {
          data: {
            raw_material_check_in: [stored],
            raw_material_purchase_order: [{ id: '4', raw_material_supplier_list_id: '8' }],
            raw_material_purchase_order_item: [{ id: '12', raw_material_purchase_order_id: '4' }],
          },
        };
      assert.equal(name, 'erp_save_raw_material_transaction');
      assert.equal(args.p_id, stored.id);
      assert.equal(args.p_updated_at, stored.updated_at);
      assert.equal(args.p_values.raw_material_purchase_order_item_id, '12');
      assert.equal(args.p_values.billed_quantity, 11);
      assert.equal(args.p_values.inward_date, '2026-11-08');
      assert.equal('purchase_order_id' in args.p_values, false);
      return { data: { ...stored, billed_quantity: 11 } };
    },
  };
  const commands = inventoryCommands(client);
  const before = await commands.load();
  const [receipt] = before.raw_material_check_in;
  assert.equal(receipt.purchase_order_id, '4');
  assert.equal(receipt.raw_material_supplier_list_id, '8');
  assert.equal(receipt.quantity, 10);
  const updated = await commands.save({
    resource: 'materialReceipts',
    table: 'raw_material_check_in',
    before,
    after: { raw_material_check_in: [{ ...receipt, quantity: 11 }] },
    id: stored.id,
  });
  assert.equal(updated.row.quantity, 11);
});
