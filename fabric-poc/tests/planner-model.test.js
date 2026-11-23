import test from 'node:test';
import assert from 'node:assert/strict';
import {
  plannerRequirements,
  plannerFabrics,
  plannerMatrix,
  plannerSheetRows,
  plannerTotal,
} from '../src/fabric/planner-model.js';
import { orderedRecords, buildSheet } from '../src/fortune-state.js';
const snapshot = {
  variants: [
    { id: '101', variant: 'Shared variant', style_code: 'STYLE-A', part: 'Top' },
    { id: '102', variant: 'Shared variant', style_code: 'STYLE-B', part: 'Pant' },
  ],
  lab_dips: [
    { id: '41', name: 'Red · Edition 1', colour: 'Red' },
    { id: '42', name: 'Blue · Edition 2', colour: 'Blue' },
  ],
  fabric_types: [
    { id: '7', name: 'Dynamic knit' },
    { id: '8', name: 'Dynamic rib' },
  ],
  sub_parts: [],
  statuses: [{ id: '1', type: 'Not ordered' }],
  requirements: [
    {
      id: '1',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Body',
      required_kg: 14,
    },
    {
      id: '2',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Sleeve',
      required_kg: 2,
    },
    {
      id: '3',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '8',
      lab_dip_id: '42',
      sub_part_name: 'Neck Rib',
      required_kg: 5.5,
    },
    {
      id: '4',
      variant_item_id: '102',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Body',
      required_kg: 3.25,
    },
  ],
};
test('canonical requirement identity, parent ownership and component lab dip are preserved', () => {
  const records = plannerRequirements({
    ...snapshot,
    requirements: [...snapshot.requirements, snapshot.requirements[0]],
  });
  assert.equal(records.length, 4);
  assert.equal(records[0].variantItemId, '101');
  assert.equal(records[0].variant, 'Shared variant');
  assert.equal(records[3].style, 'STYLE-B');
  assert.equal(records[2].colour, 'Blue');
  assert.equal(records[2].labId, '42');
  assert.equal(records[0].required, 14);
  assert.equal(records[1].id, '2');
});
test('fabric columns and aligned totals follow only filtered requirements', () => {
  const records = plannerRequirements(snapshot);
  const red = records.filter((r) => r.colour === 'Red');
  const fabrics = plannerFabrics(red);
  assert.equal(fabrics.length, 1);
  assert.equal(plannerTotal(red, 'fabric-7'), 19.25);
  const rows = plannerSheetRows(red, fabrics);
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-2)['fabric-7'], 19.25);
  assert.equal(rows.at(-1)['fabric-7'], 19.25);
  assert.equal(rows.at(-2).displayValues.colour[0], 'Red subtotal');
  assert.equal(plannerMatrix(records, plannerFabrics(records))[2]['fabric-7'], '');
});
test('worksheet sort keeps each subtotal with its colour and grand total last', () => {
  const records = plannerRequirements(snapshot),
    fabrics = plannerFabrics(records);
  const state = {
    records: plannerSheetRows(records, fabrics),
    columns: [{ key: 'colour', label: 'Colour' }],
    sort: { key: 'subpart', direction: 'desc' },
    grouping: { key: 'colour', summaryKey: 'summary' },
    layout: {},
    styles: {},
  };
  const rows = orderedRecords(state);
  assert.equal(rows[0].colour, 'Blue');
  assert.equal(rows[1].summary, 'subtotal');
  assert.equal(rows.at(-2).summary, 'subtotal');
  assert.equal(rows.at(-1).summary, 'grand');
  assert.equal(buildSheet(state).celldata.length, rows.length + 1);
  const descending = orderedRecords({ ...state, sort: { key: 'colour', direction: 'desc' } });
  assert.equal(descending[0].colour, 'Red');
  assert.equal(descending.at(-1).summary, 'grand');
  // Existing ordinary worksheets retain their normal global sorting.
  assert.deepEqual(
    orderedRecords({
      records: [
        { id: 'a', v: 3 },
        { id: 'b', v: 1 },
      ],
      sort: { key: 'v', direction: 'asc' },
    }).map((r) => r.id),
    ['b', 'a'],
  );
});

test('effective SQL statuses stay attached to requirement IDs and never populate summary rows', () => {
  const statuses = ['Not ordered', 'Ordered', 'Received', 'On hold', 'Reused in-house fabric'].map(
    (type, i) => ({ id: String(i + 1), type }),
  );
  const records = plannerRequirements({
    ...snapshot,
    statuses,
    requirements: statuses.map((status) => ({
      ...snapshot.requirements[0],
      id: 'req-' + status.id,
      item_part_fabric_status_id: status.id,
      manual_status_id: null,
    })),
  });
  assert.deepEqual(
    records.map((r) => [r.id, r.status]),
    statuses.map((s) => ['req-' + s.id, s.type]),
  );
  const rows = plannerSheetRows(records, plannerFabrics(records));
  assert.equal(rows.filter((r) => r.summary).length, 2);
  assert.ok(rows.filter((r) => r.summary).every((r) => r.status === ''));
  const sorted = orderedRecords({
    records: rows,
    sort: { key: 'status', direction: 'asc' },
    grouping: { key: 'colour', summaryKey: 'summary' },
  });
  assert.deepEqual(
    sorted.filter((r) => !r.summary).map((r) => r.status),
    [...statuses.map((s) => s.type)].sort(),
  );
});
