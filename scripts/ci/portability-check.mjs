import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const errors = [];
function scan(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) scan(p);
    else if (/\.[cm]?[jt]sx?$/.test(p)) {
      const s = readFileSync(p, 'utf8');
      if (/(?:from\s*|import\s*\()['"](?:cloudflare:|@cloudflare\/|wrangler|@cloudflare)/.test(s))
        errors.push(p);
    }
  }
}
scan('fabric-poc/src');
if (errors.length)
  throw Error('Platform runtime imports are forbidden in application code: ' + errors.join(', '));
console.log('Application has no Cloudflare runtime imports');
