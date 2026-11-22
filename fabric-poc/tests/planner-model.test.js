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
