import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCommit } from './verify-deployment.mjs';

const origin = new URL('https://worker.example');
const expected = 'a'.repeat(40);
const previous = 'b'.repeat(40);

test('waits for the approved commit after the Worker initially serves an older manifest', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ commit: previous }));
  fetch.mock.mockImplementationOnce(async () => Response.json({ commit: expected }), 1);
  await verifyCommit(origin, expected, 0);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(fetch.mock.calls[0].arguments[0].href, 'https://worker.example/release.json');
});

test('rejects a persistent commit mismatch after bounded retries', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ commit: previous }));
  await assert.rejects(verifyCommit(origin, expected, 0), /Hosted release does not match/);
  assert.equal(fetch.mock.callCount(), 8);
});
