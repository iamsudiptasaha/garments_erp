import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFabric, documentFor, saveDocument, fabricRows } from '../src/fabric/domain.js';
import { batchesForVersion } from '../src/fabric/relationships.js';
import { labOptions, programOptions } from '../src/fabric/record-select.js';
import { saveVerifiedDyedBill } from '../src/fabric/bill-verification.js';

test('previous batch stores mapping identity while grid and options show its label', () => {
  const data = initialFabric(),
    draft = documentFor(data, 'programs', 'dp1');
  draft.lines[1].batch_no = 'seed-batch-1';
  const saved = saveDocument(data, 'programs', draft);
  assert.equal(
    saved.dyeing_program_item.find((r) => r.id === draft.lines[1].id).batch_no,
    'seed-batch-1',
  );
  assert.equal(
    fabricRows(saved, 'programs').find((r) => r.id === draft.lines[1].id).batch,
    'B-104',
  );
  assert.ok(
    batchesForVersion(saved, draft.lines[1].lab_dip_version_id).some(
      (b) => b.id === 'seed-batch-1' && b.batch_no === 'B-104',
    ),
  );
});
test('Lab Dip search labels follow latest child review and retain exact version identity', () => {
  const data = initialFabric(),
    version = data.lab_dip_version[0],
    lab = data.lab_dip.find((l) => l.id === version.lab_dip_id);
  const old = data.lab_dip_version_item.find(
    (r) => r.lab_dip_version_id === version.id && r.latest,
  );
  old.latest = false;
  data.lab_dip_version_item.push({
    id: 'new-review',
    lab_dip_version_id: version.id,
    latest: true,
    date: '2026-11-05',
    lab_dip_status_id: 'ld-approved',
  });
  const option = labOptions(data, lab.color_map_by_brand_id, lab.dyer_id).find(
    (o) => o.value === version.id,
  );
  assert.match(option.label, /Edition 1 · Version 1 · Approved · 2026-11-05/);
  const program = programOptions(data).find(
    (o) => o.value === data.dyeing_program_item.find((p) => p.lab_dip_version_id === version.id).id,
  );
  assert.match(program.label, /Approved/);
  assert.match(program.label, /Previous batch/);
});
test('incorrect verifier password stops before attestation/save and cleans up isolated auth', async () => {
  let cleanup = 0;
  const verifier = {
    auth: {
      signInWithPassword: async () => ({ error: { message: 'bad password' } }),
      signOut: async () => {
        cleanup++;
      },
    },
    rpc: () => assert.fail('No attestation on failed password'),
  };
  await assert.rejects(
    saveVerifiedDyedBill(
      { rpc: () => assert.fail('No bill save') },
      () => verifier,
      {},
      { employee: '7', password: 'wrong' },
      [{ id: '7', email: 'test@example.invalid' }],
    ),
    /password verification failed/,
  );
  assert.equal(cleanup, 1);
});
test('failed bill save keeps the error and cleans up verifier session', async () => {
  let cleanup = 0;
  const verifier = {
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => {
        cleanup++;
      },
    },
    rpc: async () => ({ data: 'proof' }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: async () => ({ error: { message: 'Document changed' } }),
  };
  await assert.rejects(
    saveVerifiedDyedBill(client, () => verifier, {}, { employee: '7', password: 'test' }, [
      { id: '7', email: 'test@example.invalid' },
    ]),
    /Document changed/,
  );
  assert.equal(cleanup, 1);
});

test('verification session cleanup failures explicitly distinguish a committed bill', async () => {
  const verifier = {
    auth: {
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({ error: { message: 'network' } }),
    },
    rpc: async () => ({ data: 'proof' }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: async () => ({ data: {} }),
  };
  await assert.rejects(
    saveVerifiedDyedBill(client, () => verifier, {}, { employee: '7', password: 'test' }, [
      { id: '7', email: 'test@example.invalid' },
    ]),
    /Bill saved, but/,
  );
});
