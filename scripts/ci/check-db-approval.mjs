import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
const hash = createHash('sha256');
hash.update(readFileSync('database/ci/baseline.sql'));
for (const file of readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  hash.update(file);
  hash.update(readFileSync('supabase/migrations/' + file));
}
const digest = hash.digest('hex');
if (process.argv.includes('--print')) console.log(digest);
else if (process.env.APPLIED_DATABASE_MANIFEST_SHA256 !== digest)
  throw Error(
    'Reviewed production DB manifest is missing or stale. A database owner must separately review/apply migrations and update the production environment attestation. CI never writes production SQL.',
  );
else console.log('Production database-owner attestation matches the reviewed SQL manifest');
