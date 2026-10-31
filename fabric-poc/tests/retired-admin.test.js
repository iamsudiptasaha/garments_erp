import test from 'node:test';
import assert from 'node:assert/strict';
import { retiredAdminRequest } from '../../supabase/functions/_shared/retired-admin.mjs';

test('retired administrator endpoint refuses every operation without echoing credentials', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = retiredAdminRequest(
      new Request('https://example.invalid/admin-delete-user', {
        method,
        headers: { Authorization: 'Bearer synthetic-private-credential' },
      }),
    );
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.match(result.error, /retired/);
    assert.equal(JSON.stringify(result).includes('synthetic-private-credential'), false);
  }
});
