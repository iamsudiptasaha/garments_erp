import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labRows, saveLabDip } from '../src/colours/domain.js';
import { initialFabric } from '../src/fabric/domain.js';
import {
  emptyLiveFabric,
  fabricChanges,
  fabricRoot,
  liveFabricCommands,
  assertLiveIdentifiers,
  liveFabricPage,
} from '../src/fabric/live.js';
test('live data starts empty and never imports browser sample business rows', () => {
  const empty = emptyLiveFabric(initialFabric());
  assert.ok(
    Object.values(empty)
      .filter(Array.isArray)
      .every((rows) => rows.length === 0),
  );
  assert.ok(liveFabricPage('labDips'));
  assert.ok(!liveFabricPage('productionJobs'));
});
test('live commands preserve bigint strings, omit generated numbers and keep a complete document transaction', async () => {
  const before = { yarn_purchase_order: [], yarn_purchase_order_item: [] },
    after = {
      yarn_purchase_order: [
        {
          id: 'new-parent',
          purchase_order_number: 'must-not-send',
          yarn_supplier_id: '9223372036854775806',
        },
      ],
      yarn_purchase_order_item: [
        {
          id: 'new-child',
          purchase_order_number_id: 'new-parent',
          yarn_type_id: '123',
          rate: 10,
          quantity: 100,
        },
      ],
    };
  const calls = [],
    client = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: after, error: null };
      },
    };
  const root = fabricRoot('orders', before, after, {});
  await liveFabricCommands(client).save({
    resource: 'orders',
    root,
    action: 'create',
    before,
    after,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'erp_save_fabric_document');
  assert.equal(calls[0].args.p_changes.length, 2);
  assert.equal(calls[0].args.p_changes[0].values.yarn_supplier_id, '9223372036854775806');
  assert.equal('purchase_order_number' in calls[0].args.p_changes[0].values, false);
});
test('live diff includes original rows for stale checks and bounded removed lines', () => {
  const row = { id: '51', invoice_number: 'B1', updated_at: 'timestamp' },
    line = { id: '52', yarn_bill_id: '51', billed_quantity: 5 };
  const before = { yarn_bill: [row], yarn_bill_item: [line] },
    after = { yarn_bill: [{ ...row, invoice_number: 'B2' }], yarn_bill_item: [] };
  const diff = fabricChanges(before, after, 'yarn');
  assert.deepEqual(diff[0].before, row);
  assert.equal(diff[1].values, null);
  assert.deepEqual(fabricRoot('yarn', before, after, { id: '51' }), {
    table: 'yarn_bill',
    id: '51',
    before: row,
  });
});
test('permission/network failures remain errors instead of saving locally', async () => {
  const commands = liveFabricCommands({
    rpc: async () => ({ data: null, error: { message: 'No permission' } }),
  });
  await assert.rejects(commands.load(), /No permission/);
  await assert.rejects(
    commands.save({
      resource: 'colours',
      before: { color_map: [] },
      after: { color_map: [{ id: 'new', name: 'Navy' }] },
      root: {},
      action: 'create',
    }),
    /No permission/,
  );
});
test('unsafe bigint JSON is rejected before it reaches selectors', () => {
  assert.throws(
    () => assertLiveIdentifiers({ lab_dip: [{ id: 9007199254740992 }] }),
    /Unsafe identifier/,
  );
  assert.equal(
    assertLiveIdentifiers({ lab_dip: [{ id: '9007199254740993' }] }).lab_dip[0].id,
    '9007199254740993',
  );
});
test('live migration keeps a closed write contract, permissions, stale checks and private attachment metadata', () => {
  const sql = readFileSync(
    new URL(
      '../../supabase/migrations/20261029194657_connect_live_fabric_colours.sql',
      import.meta.url,
    ),
    'utf8',
  );
  for (const text of [
    'has_screen_permission(p_resource,p_action)',
    'fabric_row_in_document',
    'for update',
    'pg_advisory_xact_lock',
    'Cannot move a row between documents',
    'set constraints all immediate',
  ]) {
    assert.ok(sql.includes(text), text);
  }
  assert.ok(!sql.includes('grant all on'));
  assert.ok(sql.includes('revoke all on function public.erp_fabric_snapshot() from public,anon'));
  assert.ok(!sql.includes("'storage_path'"));
});
test('editing an unchanged date control preserves the stored program timestamp', async () => {
  const { saveDocument, documentFor } = await import('../src/fabric/domain.js');
  const d = initialFabric();
  d._live = true;
  d.dyeing_program[0].date = '2026-10-23T09:30:00+00:00';
  const draft = documentFor(d, 'programs', d.dyeing_program[0].id);
  draft.header.date = '2026-10-23';
  const next = saveDocument(d, 'programs', draft);
  assert.equal(next.dyeing_program[0].date, '2026-10-23T09:30:00+00:00');
  draft.header.date = '2026-10-24';
  assert.equal(saveDocument(d, 'programs', draft).dyeing_program[0].date, '2026-10-24');
});

test('Lab Dip reads the latest item and maps edits to the guarded document RPC', () => {
  const before = initialFabric();
  const version = before.lab_dip_version[0];
  Object.assign(version, {
    date: '2026-10-29',
    comments: 'Old parent values',
    lab_dip_status_id: 'ld-failed',
  });
  const item = before.lab_dip_version_item.find((row) => row.lab_dip_version_id === version.id);
  Object.assign(item, {
    date: '2026-10-30',
    comments: 'Buyer response',
    lab_dip_status_id: 'ld-awaiting',
  });
  const row = labRows(before).find((entry) => entry.id === version.lab_dip_id);
  assert.equal(row.date, '2026-10-30');
  assert.equal(row.comments, 'Buyer response');
  assert.equal(row.status, 'Awaiting buyer comments');
  const after = saveLabDip(before, {
    id: version.lab_dip_id,
    mode: 'update',
    date: '2026-10-31',
    comments: 'Swatch received',
    attached_swatch: true,
  });
  const history = after.lab_dip_version_item.filter((row) => row.lab_dip_version_id === version.id);
  assert.equal(history.length, 2);
  assert.equal(history.find((row) => !row.latest).comments, 'Buyer response');
  const changes = fabricChanges(before, after, 'labDips');
  assert.equal(changes.length, 1);
  const [change] = changes;
  assert.equal(change.table, 'lab_dip_version');
  assert.equal(change.before, version);
  assert.equal(change.values.date, '2026-10-31');
  assert.equal(change.values.comments, 'Swatch received');
  assert.equal(change.values.lab_dip_status_id, 'ld-swatch');
});
