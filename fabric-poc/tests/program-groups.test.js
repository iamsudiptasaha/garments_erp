import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFabric } from '../src/fabric/domain.js';
import {
  programDraft,
  addPlannerRequirements,
  reconcileProgramLinks,
  saveProgram,
} from '../src/fabric/program-model.js';
import { fabricChanges } from '../src/fabric/live.js';
const rows = [
  { id: '1', lab_dip_id: 'seed-navy', fabric_type_id: 'ft1', required_kg: 14.125 },
  { id: '2', lab_dip_id: 'seed-navy', fabric_type_id: 'ft1', required_kg: 2 },
  { id: '3', lab_dip_id: 'seed-navy', fabric_type_id: 'ft2', required_kg: 5.5 },
];
function fixture() {
  const data = initialFabric(),
    lab = data.lab_dip_version.find((v) => v.id === 'seed-navy-v1').lab_dip_id;
  return { data, rows: rows.map((r) => ({ ...r, lab_dip_id: lab })), lab };
}
test('adding requirements merges the complete linked set, preserves IDs and later manual quantity', () => {
  const { data, rows, lab } = fixture(),
    draft = programDraft(data);
  draft.header.dyer_id = 'dy1';
  let next = addPlannerRequirements(draft, lab, 'seed-navy-v1', ['1'], rows);
  const item = next.items[0];
  item.quantity = 100;
  next = addPlannerRequirements(next, lab, 'seed-navy-v1', ['2', '3'], rows);
  assert.equal(next.items[0].id, item.id);
  assert.equal(next.items[0].quantity, 16.125);
  assert.equal(next.links.length, 3);
  assert.equal(next.groups.length, 1);
  next.items[0].quantity = 20;
  const saved = saveProgram(data, next),
    changes = fabricChanges(data, saved, 'programs');
  assert.equal(saved.dyeing_program_item.at(-2).quantity, 20);
  assert.equal(
    changes.find((c) => c.table === 'fabric_plan_dyeing_link').reviewed_required_kg,
    16.125,
  );
  assert.equal(changes.filter((c) => c.table === 'dyeing_program_lab_dip').length, 1);
  assert.ok(
    changes
      .filter((c) => c.table === 'dyeing_program_item')
      .every((c) => !('lab_dip_version_id' in c.values)),
  );
});
test('link removal leaves quantity, unrelated items and manual rows intact', () => {
  const { data, rows, lab } = fixture(),
    draft = programDraft(data);
  draft.header.dyer_id = 'dy1';
  const next = addPlannerRequirements(draft, lab, 'seed-navy-v1', ['1', '2', '3'], rows),
    id = next.items[0].id;
  next.items[0].quantity = 99;
  const removed = reconcileProgramLinks(next, id, ['2'], rows);
  assert.equal(removed.items[0].quantity, 99);
  assert.equal(removed.items.length, 2);
  assert.equal(removed.links.length, 2);
  assert.throws(() => reconcileProgramLinks(next, id, ['3'], rows), /exact edition and fabric/);
});
test('edition identity is independent of approval and same colour editions stay separate', () => {
  const { data, rows, lab } = fixture(),
    draft = programDraft(data);
  draft.header.dyer_id = 'dy1';
  const original = data.lab_dip.find((l) => l.id === lab);
  data.lab_dip.push({ ...original, id: 'edition-2', edition: 2 });
  data.lab_dip_version.push({ id: 'unapproved', lab_dip_id: 'edition-2', version: 1 });
  let next = addPlannerRequirements(draft, lab, 'seed-navy-v1', ['1'], rows);
  const other = { ...rows[0], id: '4', lab_dip_id: 'edition-2' };
  next = addPlannerRequirements(next, 'edition-2', 'unapproved', ['4'], [...rows, other]);
  assert.equal(next.groups.length, 2);
  assert.equal(saveProgram(data, next).lab_dip.length, data.lab_dip.length);
  assert.equal(programDraft(data).groups.length, 0);
  assert.throws(() => addPlannerRequirements(draft, lab, '', ['1'], rows), /Explicitly/);
});
test('receipt provenance and existing program identities cannot be moved', () => {
  const { data } = fixture(),
    draft = programDraft(data, 'dp1');
  const group = draft.groups[0],
    old = data.lab_dip_version.find((v) => v.id === group.lab_dip_version_id);
  data.lab_dip_version.push({ ...old, id: 'new-version', version: 2 });
  group.lab_dip_version_id = 'new-version';
  assert.throws(() => saveProgram(data, draft), /receipt provenance/);
});
