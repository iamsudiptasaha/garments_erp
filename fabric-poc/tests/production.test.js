import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialFabric,
  validateFabric,
  saveDocument,
  fabricRows,
  upgradeFabric,
} from '../src/fabric/domain.js';
import { saveJobPieces, previousPieces } from '../src/production/domain.js';
import { allocatePieces } from '../src/production/item-model.js';
const vi = (data) =>
  data.variant_item.find((v) => v.item_part_id === 'prod-ip-1' && v.variant_id === 'prod-design-1')
    .id;
test('Production seed links item parts, stage jobs and final size counts without changing Fabric balances', () => {
  const data = initialFabric();
  assert.equal(validateFabric(data), true);
  assert.equal(fabricRows(data, 'productionItems')[0].parts, 2);
  assert.equal(
    fabricRows(data, 'productionJobs').find((j) => j.id === 'prod-job-cut').received,
    300,
  );
  assert.equal(
    previousPieces(
      data,
      data.job.find((j) => j.id === 'prod-job-print'),
      vi(data),
      'prod-is-m',
    ),
    120,
  );
});
test('final size entry updates one stored count rather than incrementing or duplicating it', () => {
  const data = initialFabric();
  const draft = [
    { variant_item_id: vi(data), pieces: { 'prod-is-s': 90, 'prod-is-m': 110, 'prod-is-l': 75 } },
  ];
  const saved = saveJobPieces(data, 'prod-job-print', draft),
    again = saveJobPieces(saved, 'prod-job-print', draft);
  assert.equal(again.variant_item_per_job.filter((d) => d.job_id === 'prod-job-print').length, 1);
  assert.equal(
    again.stage_pieces.filter((p) => p.variant_item_per_job_id === 'prod-dpj-print').length,
    3,
  );
  assert.equal(
    fabricRows(again, 'productionJobs').find((j) => j.id === 'prod-job-print').received,
    275,
  );
  assert.equal(data.stage_pieces.length, 3);
});
test('pieces reject fractional counts, duplicate designs and sizes from another item', () => {
  const data = initialFabric();
  assert.throws(
    () =>
      saveJobPieces(data, 'prod-job-print', [
        { variant_item_id: vi(data), pieces: { 'prod-is-s': 1.5 } },
      ]),
    /whole non-negative/,
  );
  assert.throws(
    () =>
      saveJobPieces(data, 'prod-job-print', [
        { variant_item_id: vi(data), pieces: {} },
        { variant_item_id: vi(data), pieces: {} },
      ]),
    /only once/,
  );
  data.item.push({ ...data.item[0], id: 'other', style_code: 'OTHER' });
  data.item_size_list.push({ id: 'other-size', item_id: 'other', size_list_id: 'prod-size-s' });
  assert.throws(
    () =>
      saveJobPieces(data, 'prod-job-print', [
        { variant_item_id: vi(data), pieces: { 'other-size': 1 } },
      ]),
    /does not belong/,
  );
});
test('production master forms preserve links and reject duplicate relationships', () => {
  const data = initialFabric();
  const next = saveDocument(data, 'productionItems', {
    header: { ...data.item[0], style_code: 'SC-UPDATED' },
  });
  assert.equal(fabricRows(next, 'productionJobs')[0].name, 'SC-UPDATED');
  assert.throws(
    () =>
      saveDocument(data, 'productionParts', {
        header: { item_id: 'prod-item-1', part_list_id: 'prod-part-body' },
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      saveDocument(data, 'productionItemSizes', {
        header: { item_id: 'prod-item-1', size_list_id: 'prod-size-s' },
      }),
    /already exists/,
  );
});
test('older local workspaces gain Production without overwriting existing Fabric or Inventory records', () => {
  const data = initialFabric();
  for (const key of [
    'job',
    'variant_item_per_job',
    'stage_pieces',
    'item_size_list',
    'size_list',
    'stage',
    'stage_type',
    'variant',
    'variant_item',
    'job_worker',
    'part_list',
    'product_type_list',
    'gender',
    'item_status_list',
  ])
    delete data[key];
  data.item = [];
  data.item_part = [];
  const next = upgradeFabric(data);
  assert.equal(next.item[0].style_code, 'SC-101');
  assert.equal(next.knitting_bill_item[0].id, 'ki1');
  assert.equal(next.raw_material_check_in[0].id, 'mi1');
  assert.equal(validateFabric(next), true);
});

test('complete item setup stores cutting pieces and maps each variant to existing parts and colours', async () => {
  const { saveItemSetup, itemSetup } = await import('../src/production/item-model.js');
  const data = initialFabric();
  const setup = {
    sizes: [{ size_list_id: 'prod-size-s', pieces: 120 }],
    variants: [
      {
        name: 'Blue sleeveless',
        share_weight: 1,
        parts: [{ part_list_id: 'prod-part-body', lab_dip_id: data.lab_dip[0].id }],
      },
      {
        name: 'Red tee',
        share_weight: 1,
        parts: [{ part_list_id: 'prod-part-body', lab_dip_id: '' }],
      },
    ],
  };
  const saved = saveItemSetup(data, 'prod-item-1', setup);
  assert.equal(saved.variant_item.length, 3);
  assert.equal(saved.variant_item[1].item_part_id, saved.variant_item[2].item_part_id);
  assert.equal(saved.item_cut_ratio[0].pieces, 120);
  assert.equal(itemSetup(saved, 'prod-item-1').variants.length, 3);
  assert.equal(data.variant_item.length, 1);
  const loaded = itemSetup(saved, 'prod-item-1');
  loaded.sizes = loaded.sizes.filter((s) => s.pieces !== '');
  const again = saveItemSetup(saved, 'prod-item-1', loaded);
  assert.equal(again.variant_item.length, 3);
  assert.equal(again.item_cut_ratio.length, 1);
  assert.throws(
    () =>
      saveItemSetup(data, 'prod-item-1', {
        ...setup,
        sizes: [{ size_list_id: 'prod-size-s', pieces: 1.5 }],
      }),
    /whole/,
  );
  assert.throws(
    () =>
      saveItemSetup(data, 'prod-item-1', {
        ...setup,
        variants: [{ name: 'Bad', share_weight: 1, parts: [{ part_list_id: 'missing' }] }],
      }),
    /Select each part/,
  );
});

test('share weights allocate whole pieces without multiplying or losing size totals', () => {
  assert.deepEqual(allocatePieces(100, [1, 1]), [50, 50]);
  assert.deepEqual(allocatePieces(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocatePieces(100, [2, 1]), [67, 33]);
  assert.deepEqual(allocatePieces(0, [1, 1]), [0, 0]);
  assert.deepEqual(allocatePieces(5, [1, 2, 1]), [1, 3, 1]);
  assert.throws(() => allocatePieces(10, [0, 1]), /positive share/);
  assert.throws(() => allocatePieces(10, [-1, 1]), /positive share/);
  assert.throws(() => allocatePieces(1.5, [1, 1]), /whole/);
});
test('item checklist is saved once per item with independent production statuses', async () => {
  const { itemSetup, saveItemSetup } = await import('../src/production/item-model.js');
  const d = initialFabric(),
    setup = itemSetup(d, 'prod-item-1');
  setup.sizes = setup.sizes.map((s) => ({ ...s, pieces: 100 }));
  setup.checklist = { fpt_gpt_status_id: 'prod-status-3' };
  const next = saveItemSetup(d, 'prod-item-1', setup);
  assert.equal(next.production_checklist.length, 1);
  assert.equal(next.production_checklist[0].fpt_gpt_status_id, 'prod-status-3');
  assert.equal(saveItemSetup(next, 'prod-item-1', setup).production_checklist.length, 1);
  setup.variants[0].share_weight = 10;
  assert.ok(saveItemSetup(d, 'prod-item-1', setup).variant.every((v) => v.share_weight === 1));
});
test('jobs require a verifier on save and stage changes create another job row', () => {
  const d = initialFabric(),
    header = { ...d.job[0] };
  assert.throws(
    () => saveDocument(d, 'productionJobs', { header: { ...header, verify_employee_id: '' } }),
    /Verified by employee/,
  );
  assert.throws(
    () =>
      saveDocument(d, 'productionJobs', { header: { ...header, stage_id: 'prod-stage-print' } }),
    /new job row/,
  );
});

test('checklist documents and Disputed status follow the revised field names', async () => {
  const { itemSetup, saveItemSetup } = await import('../src/production/item-model.js');
  const d = initialFabric();
  assert.ok(d.item_status_list.some((s) => s.status === 'Disputed'));
  const setup = itemSetup(d, 'prod-item-1');
  setup.sizes = setup.sizes.map((s) => ({ ...s, pieces: 100 }));
  setup.checklist = {
    techpack_aqcuired_status_id: 'prod-status-3',
    ordersheet_acquired_status_id: 'prod-status-disputed',
  };
  const next = saveItemSetup(d, 'prod-item-1', setup);
  assert.equal(next.production_checklist[0].techpack_aqcuired_status_id, 'prod-status-3');
  assert.equal(next.production_checklist[0].ordersheet_acquired_status_id, 'prod-status-disputed');
  assert.equal(next.production_checklist[0].tna_acquired_status_id, undefined);
});
