import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState,
  buildSheet,
  orderedRecords,
  capturePresentation,
  hasDataChanges,
  saveRecord,
  csvFor,
} from '../src/fortune-state.js';
test('whole record sort preserves identity and record formatting', () => {
  const state = defaultState();
  state.styles.k1 = { consumption: { bg: '#ffdd00', bl: 1 } };
  state.sort = { key: 'consumption', direction: 'asc' };
  assert.deepEqual(
    orderedRecords(state).map((r) => [r.id, r.consumption, r.quantity]),
    [
      ['k2', 120, 117],
      ['k3', 300, 294],
      ['k1', 500, 485],
    ],
  );
  const cell = buildSheet(state).celldata.find((c) => c.r === 3 && c.c === 5);
  assert.equal(cell.v.bg, '#ffdd00');
  assert.equal(cell.v.v, 500);
});
test('presentation capture cannot persist changed data or formulas as styles', () => {
  const state = defaultState(),
    sheet = buildSheet(state);
  assert.equal(hasDataChanges(sheet, state), false);
  sheet.celldata.find((c) => c.r === 1 && c.c === 5).v.v = 999;
  assert.equal(hasDataChanges(sheet, state), true);
  sheet.celldata.find((c) => c.r === 1 && c.c === 5).v.v = 500;
  sheet.celldata.find((c) => c.r === 1 && c.c === 5).v.f = '=1+1';
  assert.equal(hasDataChanges(sheet, state), true);
  const presentation = capturePresentation(sheet, state);
  assert.equal(presentation.data.knitting[0].consumption, 500);
  assert.equal(presentation.styles.k1.consumption.v, undefined);
});
test('record form validates linked stock and changes only the chosen record', () => {
  const state = defaultState(),
    row = structuredClone(state.data.knitting[0]);
  row.consumption = 550;
  const next = saveRecord(state, row, row.id);
  assert.equal(next.data.knitting[0].consumption, 550);
  assert.equal(state.data.knitting[0].consumption, 500);
  assert.throws(
    () => saveRecord(state, { ...row, consumption: 950 }, row.id),
    /exceeds available yarn/,
  );
  assert.throws(
    () => saveRecord(state, { ...row, quantity: 200 }, row.id),
    /dyeing consumption exceeds/,
  );
});
test('new records and formatting persist as versioned serializable state', () => {
  const state = defaultState();
  const next = saveRecord(state, {
    bill: 'KB-100',
    date: '2026-10-27',
    knitter: 'Knitter',
    yarnId: 'y2',
    fabric: 'Rib',
    gsm: 200,
    consumption: 50,
    quantity: 48,
    rolls: 3,
    rate: 12,
  });
  assert.equal(next.data.knitting.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
  assert.equal(hasDataChanges(buildSheet(next), next), false);
});
test('CSV follows full record order, quotes fields and neutralizes spreadsheet formulas', () => {
  const state = defaultState();
  state.data.knitting[0].knitter = '=HYPERLINK("bad")';
  const csv = csvFor(state);
  assert.match(csv, /'=HYPERLINK/);
  assert.equal(csv.split('\r\n').length, 4);
});

test('only the active column heading shows its persisted sort direction', () => {
  const state = defaultState();
  state.sort = { key: 'consumption', direction: 'asc' };
  let headings = buildSheet(state)
    .celldata.filter((c) => c.r === 0)
    .map((c) => c.v.v);
  assert.equal(headings[5], '↑ Yarn consumed · kg');
  assert.equal(headings.filter((v) => /[↑↓]/.test(v)).length, 1);
  state.sort = { key: 'quantity', direction: 'desc' };
  headings = buildSheet(state)
    .celldata.filter((c) => c.r === 0)
    .map((c) => c.v.v);
  assert.equal(headings[5], 'Yarn consumed · kg');
  assert.equal(headings[6], '↓ Knitted output · kg');
  assert.equal(hasDataChanges(buildSheet(state), state), false);
});
