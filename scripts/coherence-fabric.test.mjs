import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fabricBatchReleaseSchema, inspectFabricBatch } from './fabric-batch-contract.mjs';
const snapshot = JSON.parse(readFileSync(new URL('../database/schema/live-schema.json', import.meta.url)));
test('batch coherence rejects text identity contracts and incorrect FK destinations', () => {
  const schema = fabricBatchReleaseSchema(snapshot);
  assert.deepEqual(inspectFabricBatch(schema), []);
  assert.ok(inspectFabricBatch(schema, { dyeing_program_item: { batch_no: 'text' } }).length);
  schema.foreign_keys = schema.foreign_keys.filter((f) => f.table !== 'dyeing_program_item');
  assert.ok(inspectFabricBatch(schema).length);
});
