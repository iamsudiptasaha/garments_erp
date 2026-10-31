import { batchesForVersion, programContext, defaultVersion } from '../src/fabric/relationships.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialFabric,
  validateFabric,
  fabricRows,
  fabricTotals,
  documentFor,
  saveDocument,
  saveSupplier,
  upgradeFabric,
  optionsFor,
} from '../src/fabric/domain.js';
import { buildSheet, capturePresentation, hasDataChanges } from '../src/fortune-state.js';
import { pages } from '../src/fabric/catalog.js';
test('fabric seed satisfies schema-shaped relationships and reconciles balances', () => {
  const data = initialFabric();
  assert.equal(validateFabric(data), true);
  assert.deepEqual(fabricTotals(data), { yarnLeft: 880, greigeLeft: 196, dyed: 663, batches: 4 });
  assert.equal(fabricRows(data, 'knitting').filter((r) => r.documentId === 'kb1').length, 2);
});
test('one header is saved with many lines atomically and edits retain line identities', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'knitting', 'kb1');
  draft.header.invoice_number = 'KB-026-EDIT';
  draft.header.knitter_id = 'kn2';
  draft.lines[0].consumption = 520;
  const next = saveDocument(data, 'knitting', draft),
    rows = fabricRows(next, 'knitting').filter((r) => r.documentId === 'kb1');
  assert.equal(next.knitting_bill.length, 2);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.bill === 'KB-026-EDIT' && r.supplier === 'Metro Knitting'));
  assert.deepEqual(
    draft.lines.map((l) => l.id),
    ['ki1', 'ki2'],
  );
  assert.equal(fabricTotals(next).yarnLeft, 860);
  assert.equal(data.knitting_bill[0].invoice_number, 'KB-026');
  const failed = structuredClone(draft);
  failed.lines[1].consumption = 600;
  assert.equal(
    saveDocument(data, 'knitting', failed).knitting_bill_item.find(
      (r) => r.id === failed.lines[1].id,
    ).consumption,
    600,
  );
  assert.equal(data.knitting_bill_item[0].consumption, 500);
});
test('new multi-line knitting bill creates one parent and prevents duplicate invoice parents', () => {
  const data = initialFabric(),
    line = {
      yarn_bill_item_id: 'ybi2',
      fabric_type_id: 'ft1',
      greige_gsm: 180,
      billed_rate: 12,
      consumption: 50,
      billed_quantity: 48,
      billed_rolls: 2,
    };
  const draft = {
    header: { invoice_number: 'KB-030', invoice_date: '2026-10-27', knitter_id: 'kn1' },
    lines: [line, { ...line, fabric_type_id: 'ft2', consumption: 20, billed_quantity: 19 }],
  };
  const next = saveDocument(data, 'knitting', draft),
    parent = next.knitting_bill.find((b) => b.invoice_number === 'KB-030');
  assert.equal(next.knitting_bill.length, 3);
  assert.equal(next.knitting_bill_item.filter((l) => l.knitting_bill_id === parent.id).length, 2);
  assert.equal(fabricTotals(next).yarnLeft, 810);
  assert.throws(() => saveDocument(next, 'knitting', draft), /already exists/);
});
test('removing a consumed source or stealing line identities fails without partial writes', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'knitting', 'kb1');
  draft.lines = draft.lines.slice(1);
  assert.throws(
    () => saveDocument(data, 'knitting', draft),
    /linked knitting bill item is missing/,
  );
  draft.lines[0].id = 'ki3';
  assert.throws(() => saveDocument(data, 'knitting', draft), /moved from another document/);
});
test('colour sections preserve comments per line and one program header', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'programs', 'dp1');
  draft.lines
    .filter((l) => l.color_map_by_brand_id === 'co1')
    .forEach((l) => (l.comments = 'Revised navy instructions'));
  const next = saveDocument(data, 'programs', draft);
  assert.equal(next.dyeing_program.length, 2);
  assert.equal(
    next.dyeing_program_item.filter((l) => l.comments === 'Revised navy instructions').length,
    2,
  );
});
test('batch trace joins the full chain and bill view excludes final-price column', () => {
  const data = initialFabric(),
    row = fabricRows(data, 'batches').find((r) => r.batch === 'B-104');
  assert.deepEqual(
    [row.yarnBill, row.knitBill, row.program, row.bill, row.color],
    ['YB-014', 'KB-026', 'DP-031', 'DF-031', 'Navy'],
  );
  assert.equal(row.wastage, 4);
  assert.equal(fabricRows(data, 'dyed').find((r) => r.batch === 'B-104').price, 298.48);
  assert.equal(
    pages.dyeBills.columns.some((c) => c.key === 'price'),
    false,
  );
});
test('greige report has one row per bill and fabric and comma-separated dyers', () => {
  const rows = fabricRows(initialFabric(), 'greige');
  assert.equal(rows.length, 3);
  const sinker = rows.find((r) => r.bill === 'KB-026' && r.name === '30S Sinker');
  assert.equal(sinker.left, 85);
  assert.equal(sinker.dyers, 'River Dyeing, City Processors');
});
test('shared sheet adapter protects new page values and preserves hidden-row styles', () => {
  const data = initialFabric(),
    rows = fabricRows(data, 'yarnLeft'),
    state = {
      records: rows,
      columns: pages.yarnLeft.columns,
      styles: { hidden: { name: { bl: 1 } } },
      layout: {},
      page: 'yarnLeft',
      title: 'Yarn left',
      sort: { key: 'left', direction: 'desc' },
    };
  const sheet = buildSheet(state);
  assert.equal(hasDataChanges(sheet, state), false);
  const next = capturePresentation(sheet, state);
  assert.equal(next.styles.hidden.name.bl, 1);
  sheet.celldata.find((c) => c.r === 1 && c.c === 6).v.v = 100000;
  assert.equal(hasDataChanges(sheet, state), true);
});
test('suppliers add to the correct role and contact collection', () => {
  const data = initialFabric(),
    next = saveSupplier(data, {
      name: 'New Knitter',
      kind: 'knitter',
      contactMode: 'new',
      contact_purpose_id: 'purpose-knitter',
    });
  assert.equal(next.knitter.length, 3);
  assert.equal(data.knitter.length, 2);
  assert.ok(
    fabricRows(next, 'suppliers').some((s) => s.name === 'New Knitter' && s.kind === 'Knitter'),
  );
});
test('supplier editing keeps its role identity and duplicate creation is rejected', () => {
  const data = initialFabric();
  const next = saveSupplier(data, {
    id: 'knitter:kn1',
    kind: 'knitter',
    name: 'Sri Knits Updated',
    contacts_id: 's3',
    contact_purpose_id: 'purpose-knitter',
  });
  assert.equal(next.knitter.length, 2);
  assert.equal(
    fabricRows(next, 'knitting').find((r) => r.id === 'ki1').supplier,
    'Sri Knits Updated',
  );
  assert.throws(
    () =>
      saveSupplier(data, {
        kind: 'knitter',
        name: 'Sri Knits',
        contacts_id: 's3',
        contact_purpose_id: 'purpose-knitter',
      }),
    /already has/,
  );
});

test('colour library and brand mappings keep approval metadata on lab dips', () => {
  const data = initialFabric();
  const colour = saveDocument(data, 'colours', {
    header: { name: 'Coral', pantone_code: '16-1546' },
    lines: [],
  });
  const coral = colour.color_map.find((c) => c.name === 'Coral');
  const mapped = saveDocument(colour, 'colourMappings', {
    header: { color_map_id: coral.id, brand_list_id: 'br1' },
    lines: [],
  });
  const mapping = mapped.color_map_by_brand.find((m) => m.color_map_id === coral.id);
  assert.equal(mapping.dyer_id, undefined);
  assert.ok(optionsFor(mapped, 'colors', 'dy1').some(([id]) => id === mapping.id));
  assert.equal(fabricRows(mapped, 'colours').find((c) => c.id === coral.id).mappings, 1);
  assert.throws(
    () =>
      saveDocument(mapped, 'colourMappings', {
        header: { color_map_id: coral.id, brand_list_id: 'br1' },
      }),
    /already exists/,
  );
});
test('colour rename propagates to programs and batch trace without changing mapping identity', () => {
  const data = initialFabric();
  const next = saveDocument(data, 'colours', {
    header: { ...data.color_map[0], name: 'Deep Navy' },
    lines: [],
  });
  assert.equal(fabricRows(next, 'batches').find((r) => r.batch === 'B-104').color, 'Deep Navy');
  assert.equal(programContext(next, next.dyeing_program_item[0]).mappingId, 'co1');
  assert.throws(
    () =>
      saveDocument(data, 'colourMappings', {
        header: { color_map_id: 'missing', brand_list_id: 'br1' },
        lines: [],
      }),
    /linked color map is missing/,
  );
});
test('legacy local colours upgrade preserves all existing document and mapping IDs', () => {
  const data = initialFabric();
  delete data.color_map;
  delete data.brand_list;
  data.color_map_by_brand = [
    { id: 'co1', name: 'Navy', brand: 'Core' },
    { id: 'co2', name: 'Sage', brand: 'Core' },
  ];
  const next = upgradeFabric(data);
  assert.deepEqual(next.dyeing_program_item, data.dyeing_program_item);
  assert.deepEqual(next.knitting_bill, data.knitting_bill);
  assert.equal(validateFabric(next), true);
  assert.equal(fabricRows(next, 'batches')[0].color, 'Navy');
  assert.equal(next.brand_list.length, 1);
  assert.equal(next.color_map.length, 2);
});

test('batch choices follow exact lab-dip versions, even for the same colour', () => {
  const data = initialFabric(),
    v = data.dyeing_program_item.find((r) => r.id === 'di1').lab_dip_version_id;
  assert.deepEqual(batchesForVersion(data, v), ['B-104', 'B-106']);
  assert.deepEqual(batchesForVersion(data, ''), []);
  const old = data.lab_dip_version.find((r) => r.id === v);
  data.lab_dip_version.push({ ...old, id: 'redo-v2', version: 2 });
  assert.deepEqual(batchesForVersion(data, 'redo-v2'), []);
  assert.deepEqual(batchesForVersion(data, v, 'di1'), ['B-106']);
});
test('program requires a version, permits null previous batch and rejects wrong-version or own output', () => {
  const data = initialFabric(),
    version = data.dyeing_program_item[0].lab_dip_version_id,
    draft = {
      header: { program_number: 'DP-NEW', date: '2026-10-30', dyer_id: 'dy1' },
      lines: [
        {
          fabric_type_id: 'ft1',
          quantity: 1,
          lab_dip_version_id: version,
          batch_no: 'B-104',
          comments: '',
        },
      ],
    };
  const saved = saveDocument(data, 'programs', draft);
  assert.equal(saved.dyeing_program_item.at(-1).lab_dip_version_id, version);
  assert.equal(saved.dyeing_program_item.at(-1).color_map_by_brand_id, undefined);
  draft.lines[0].batch_no = 'B-105';
  assert.throws(() => saveDocument(data, 'programs', draft), /exact selected lab-dip version/);
  draft.lines[0].batch_no = null;
  assert.equal(saveDocument(data, 'programs', draft).dyeing_program_item.at(-1).batch_no, null);
  draft.lines[0].lab_dip_version_id = '';
  assert.throws(() => saveDocument(data, 'programs', draft), /Lab-dip version is required/);
  const own = documentFor(data, 'programs', 'dp1');
  own.lines[0].batch_no = 'B-104';
  assert.throws(() => saveDocument(data, 'programs', own), /own output/);
});
test('colour master and mapping forms do not expose obsolete swatch or shade fields', () => {
  assert.deepEqual(
    pages.colourMappings.header.map((f) => f.key),
    ['color_map_id', 'brand_list_id'],
  );
  assert.ok(!pages.colours.header.some((f) => f.key === 'attached_swatch'));
  assert.ok(!pages.colourMappings.columns.some((c) => c.key === 'swatch'));
});

test('colour mapping labels display colour before brand consistently', () => {
  const data = initialFabric();
  assert.equal(optionsFor(data, 'colors').find(([id]) => id === 'co1')[1], 'Navy / Core');
  assert.equal(fabricRows(data, 'programs').find((row) => row.id === 'di1').mapping, 'Navy / Core');
});

test('reference edits preserve IDs and propagate to linked choices and derived fabrics', () => {
  const data = initialFabric();
  const next = saveDocument(data, 'yarnTypes', {
    header: { id: 'yt1', name: '32S Shivam CCH', yarn_count: '32S' },
  });
  assert.equal(fabricRows(next, 'knitting').find((r) => r.id === 'ki1').name, '32S Sinker');
  assert.equal(optionsFor(next, 'yarnTypes').find(([id]) => id === 'yt1')[1], '32S Shivam CCH');
  assert.equal(data.yarn_type[0].yarn_count, '30S');
  const renamed = saveDocument(next, 'brands', {
    header: { ...next.brand_list[0], brand: 'Essential' },
  });
  assert.match(optionsFor(renamed, 'colors')[0][1], /Navy \/ Essential/);
  assert.equal(fabricRows(renamed, 'brands')[0].mappings, 2);
  const fabric = saveDocument(renamed, 'fabricTypes', {
    header: { id: 'ft1', name: 'Single jersey' },
  });
  assert.equal(fabricRows(fabric, 'batches')[0].name, '32S Single jersey');
  assert.equal(fabricRows(fabric, 'fabricTypes').find((r) => r.id === 'ft1').knitting, 2);
});
test('reference masters reject duplicate names, missing counts and stale edit identities', () => {
  const data = initialFabric();
  assert.throws(
    () => saveDocument(data, 'fabricTypes', { header: { name: ' sinker ' } }),
    /already exists/,
  );
  assert.throws(
    () => saveDocument(data, 'yarnTypes', { header: { name: 'New yarn', yarn_count: '' } }),
    /Yarn count is required/,
  );
  assert.throws(
    () =>
      saveDocument(data, 'brands', {
        header: { ...data.brand_list[0], id: 'deleted', brand: 'New' },
      }),
    /no longer exists/,
  );
  const next = saveDocument(data, 'brands', {
    header: { brand: 'Summer', contacts_id: 's1', contact_purpose_id: 'purpose-brand' },
  });
  assert.equal(next.brand_list.length, 2);
  assert.equal(data.brand_list.length, 1);
  assert.ok(optionsFor(next, 'brands').some(([, name]) => name === 'Summer'));
});

test('brands and suppliers require existing contact relationships', () => {
  const data = initialFabric();
  assert.throws(
    () => saveDocument(data, 'brands', { header: { brand: 'Missing links' } }),
    /Company \/ contact is required/,
  );
  assert.throws(
    () => saveSupplier(data, { kind: 'knitter', contacts_id: 's3' }),
    /contact purpose/,
  );
  assert.throws(
    () =>
      saveSupplier(data, {
        kind: 'knitter',
        contacts_id: 'missing',
        contact_purpose_id: 'purpose-knitter',
      }),
    /company\/contact/,
  );
  const saved = saveSupplier(data, {
    kind: 'knitter',
    contacts_id: 's2',
    contact_purpose_id: 'purpose-knitter',
  });
  assert.equal(saved.knitter.at(-1).contacts_id, 's2');
  assert.equal(saved.knitter.at(-1).contact_purpose_id, 'purpose-knitter');
  assert.equal(saved.contacts.length, data.contacts.length);
});
test('dyed bill edits store batch in its mapping and preserve mapping identity atomically', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'dyeBills', 'db1'),
    mapId = data.batch_no_lab_dip_version_map.find((b) => b.dyed_fabric_item_id === 'df1').id;
  draft.lines[0].batch_no = 'B-104-EDIT';
  const saved = saveDocument(data, 'dyeBills', draft);
  assert.equal(saved.dyed_fabric_item.find((d) => d.id === 'df1').batch_no, undefined);
  assert.equal(
    saved.batch_no_lab_dip_version_map.find((b) => b.dyed_fabric_item_id === 'df1').id,
    mapId,
  );
  assert.equal(fabricRows(saved, 'batches').find((r) => r.id === 'df1').batch, 'B-104-EDIT');
  draft.lines[0].batch_no = 'B-105';
  assert.throws(() => saveDocument(data, 'dyeBills', draft), /unique/);
  assert.equal(data.batch_no_lab_dip_version_map.find((b) => b.id === mapId).batch_no, 'B-104');
});
test('default version selects latest accepted, while unapproved versions remain selectable explicitly', () => {
  const d = initialFabric(),
    lab = d.lab_dip.find((l) => l.color_map_by_brand_id === 'co1' && l.dyer_id === 'dy1');
  d.lab_dip_version = d.lab_dip_version.filter((v) => v.lab_dip_id !== lab.id);
  d.lab_dip_version.push({
    id: 'approved',
    lab_dip_id: lab.id,
    version: 1,
    date: '2026-10-29',
    lab_dip_status_id: 'ld-approved',
  });
  const newer = { ...lab, id: 'edition-new', edition: 2 };
  d.lab_dip.push(newer);
  d.lab_dip_version.push({
    id: 'awaiting',
    lab_dip_id: newer.id,
    version: 1,
    date: '2026-10-30',
    lab_dip_status_id: 'ld-awaiting',
  });
  assert.equal(defaultVersion(d, 'co1', 'dy1'), 'approved');
  d.lab_dip_version.find((v) => v.id === 'awaiting').lab_dip_status_id = 'ld-comments';
  assert.equal(defaultVersion(d, 'co1', 'dy1'), 'awaiting');
});
test('older local relationships upgrade without guessing contact links or changing counts', () => {
  const data = initialFabric(),
    legacy = structuredClone(data);
  for (const p of legacy.dyeing_program_item) {
    p.color_map_by_brand_id = programContext(data, p).mappingId;
    delete p.lab_dip_version_id;
  }
  for (const d of legacy.dyed_fabric_item)
    d.batch_no = data.batch_no_lab_dip_version_map.find(
      (b) => b.dyed_fabric_item_id === d.id,
    ).batch_no;
  delete legacy.batch_no_lab_dip_version_map;
  delete legacy.brand_list[0].contacts_id;
  delete legacy.brand_list[0].contact_purpose_id;
  const next = upgradeFabric(legacy);
  assert.equal(validateFabric(next), true);
  assert.equal(next.brand_list[0].contacts_id, null);
  assert.equal(next.brand_list[0]._needsContactLinks, true);
  assert.equal(next.dyed_fabric_item[0].batch_no, undefined);
  assert.equal(next.batch_no_lab_dip_version_map.length, 4);
  assert.deepEqual(fabricTotals(next), fabricTotals(data));
  assert.deepEqual(upgradeFabric(next), next);
});
test('database-generated document numbers cannot be entered or overwritten in local forms', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'programs', 'dp1');
  draft.header.program_number = 'FORGED';
  assert.equal(
    saveDocument(data, 'programs', draft).dyeing_program.find((p) => p.id === 'dp1').program_number,
    'DP-031',
  );
  const order = documentFor(data, 'orders', 'po1');
  order.header.purchase_order_number = 'FORGED';
  assert.equal(
    saveDocument(data, 'orders', order).yarn_purchase_order.find((p) => p.id === 'po1')
      .purchase_order_number,
    'YPO-014',
  );
  delete draft.header.id;
  draft.lines = draft.lines.map(({ id: _id, ...line }) => line);
  assert.equal(saveDocument(data, 'programs', draft).dyeing_program.at(-1).program_number, null);
  for (const [page, key] of [
    ['orders', 'purchase_order_number'],
    ['programs', 'program_number'],
  ]) {
    const f = pages[page].header.find((f) => f.key === key);
    assert.equal(f.generated, true);
    assert.equal(f.readOnly, true);
    assert.equal(f.required, false);
  }
});
test('lab-dip record picker exposes separate metadata columns and swatch blanks', async () => {
  const { labRecordRows } = await import('../src/fabric/lab-record-select.js'),
    data = initialFabric(),
    v = data.lab_dip_version[0];
  v.lab_dip_status_id = 'ld-swatch';
  v.attached_swatch = true;
  v.date = '2026-10-30';
  v.shade_card_no = 'unused';
  v.shade_card_option = 'unused';
  const row = labRecordRows(data, 'co1', 'dy1').find((r) => r.id === v.id);
  assert.equal(row.status, 'Attached Swatch');
  assert.equal(row.date, '2026-10-30');
  assert.equal(row.shade, null);
  assert.equal(row.option, null);
  assert.equal(row.edition, 1);
  assert.equal(row.version, 1);
});

test('Fabric permits weight gain, shortage and negative remaining balance without altering inputs', () => {
  const d = initialFabric();
  d.knitting_bill_item[0].consumption = 2000;
  d.knitting_bill_item[0].billed_quantity = 2200;
  d.dyed_fabric_item[0].gross_quantity = 3000;
  d.dyed_fabric_item[0].billed_quantity = 3100;
  d.dyed_fabric_item[0].final_quantity = 3200;
  assert.equal(validateFabric(d), true);
  assert.ok(fabricRows(d, 'yarnLeft').some((r) => r.left < 0));
  assert.ok(fabricRows(d, 'greige').some((r) => r.left < 0));
});
