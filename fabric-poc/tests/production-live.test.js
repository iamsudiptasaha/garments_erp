import test from 'node:test';
import assert from 'node:assert/strict';
import {
  productionCommands,
  productionTasks,
  productionChanges,
  mergeProductionSnapshot,
} from '../src/production-task-board/live.js';
import { liveProductionPage } from '../src/production-task-board/live-contract.js';
import { productionFixture } from './fixtures/production-live.js';
test('live projection uses production ownership, safe IDs, current status and exact quantity IDs', () => {
  const task = productionTasks(productionFixture())[0];
  assert.equal(task.id, '31');
  assert.equal(task.itemId, '9007199254740993');
  assert.equal(task.status, 'In process');
  assert.equal(task.pieces, 100);
  assert.equal(task.visitId, '0');
  assert.equal(task.pieceSchema.length, 2);
  assert.equal(task.pieceSchema[0].variantItemId, '111');
  assert.equal(task.pieceSchema[0].itemSizeId, '91');
  assert.equal(task.pieceSchema[0].incoming, 50);
  assert.equal(new Set(task.employeeNames).size, 2);
  assert.equal(task.stageTypes.Cutting, 'Work in progress');
  assert.equal(productionTasks({}).length, 0);
  assert.ok(liveProductionPage('productionTaskBoard'));
  assert.ok(!liveProductionPage('productionJobs'));
});
test('task edits are one atomic RPC with revision and item checklist identity', async () => {
  const data = productionFixture(),
    old = productionTasks(data)[0],
    calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data };
    },
  };
  await productionCommands(client).saveTask(data, old, {
    ...old,
    assignees: [old.employeeNames[1]],
    flags: ['Rush'],
    checklist: { 'FPT / GPT': 'Complete' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'erp_edit_production_task');
  assert.equal(calls[0].args.p_expected, 'revision-1');
  assert.deepEqual(calls[0].args.p_assignees, ['72']);
  assert.deepEqual(calls[0].args.p_flags, ['81']);
  assert.equal(calls[0].args.p_checklist.fpt_gpt_status_id, '62');
  assert.equal(calls[0].args.p_expected_checklist, null);
});
test('handover sends exact variant and size IDs including zero, skips stages and then reloads', async () => {
  const data = productionFixture(),
    old = productionTasks(data)[0],
    calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data };
    },
  };
  await productionCommands(client).saveTask(data, old, {
    ...old,
    stage: 'Stitching',
    handovers: [
      {
        visit: '0',
        employee: old.employeeNames[0],
        destination: 'Stitching',
        pieces: old.pieceSchema.map((p, i) => ({ ...p, output: String(i ? 19 : 0) })),
      },
    ],
  });
  assert.deepEqual(
    calls.map((c) => c.name),
    ['erp_move_production', 'erp_production_workspace'],
  );
  const p = calls[0].args.p_payload;
  assert.equal(p.to_stage_id, '3');
  assert.equal(p.expected_transition_id, '0');
  assert.equal(p.verified_by, '71');
  assert.equal(calls[0].args.p_proof, null);
  assert.deepEqual(
    p.pieces.map((p) => p.pieces_stock_out),
    [0, 19],
  );
});
test('server rejection propagates and never falls back to local saving', async () => {
  const data = productionFixture(),
    old = productionTasks(data)[0];
  let calls = 0;
  const commands = productionCommands({
    rpc: async () => {
      calls++;
      return { error: { message: 'Task changed. Reload.' } };
    },
  });
  await assert.rejects(commands.saveTask(data, old, { ...old, due: '2026-12-01' }), /Task changed/);
  assert.equal(calls, 1);
  await assert.rejects(commands.saveTask(data, old, { ...old, priority: 'High' }), /unavailable/);
});
test('Items contract excludes shared variants and attachments from setup writes', () => {
  const before = productionFixture(),
    after = structuredClone(before);
  after.item[0].image_attachment = '999';
  after.variant[0].variant_name = 'Renamed';
  after.item[0].batch_number = '000456';
  const changes = productionChanges(before, after, 'productionItems');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'item');
  assert.equal(changes[0].values.batch_number, '000456');
  assert.ok(!Object.hasOwn(changes[0].values, 'image_attachment'));
});

test('Production refresh preserves authorised Fabric contact labels and attachment metadata', () => {
  const merged = mergeProductionSnapshot(
    {
      contacts: [
        { id: '1', company_name: 'Yarn supplier' },
        { id: '2', company_name: 'Shared', updated_at: 'stamp' },
      ],
      attachments: [{ id: '3', filename: 'bill.pdf' }],
    },
    {
      contacts: [{ id: '2', company_name: 'Worker' }],
      attachments: [{ id: '4', filename: 'item.png' }],
      item: [],
    },
  );
  assert.equal(merged.contacts.length, 2);
  assert.equal(merged.contacts[1].updated_at, 'stamp');
  assert.deepEqual(
    merged.attachments.map((a) => a.id),
    ['3', '4'],
  );
  assert.deepEqual(merged.item, []);
});
