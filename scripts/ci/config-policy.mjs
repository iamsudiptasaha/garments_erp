import { readFileSync, readdirSync } from 'node:fs';
const errors = [];
for (const file of readdirSync('.github/workflows')) {
  const text = readFileSync('.github/workflows/' + file, 'utf8');
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const action = match[1];
    if (!action.startsWith('./') && !/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(action))
      errors.push(file + ': unpinned external action');
  }
  if (
    /pull_request_target|continue-on-error:\s*true|secrets:\s*inherit|--no-verify|--linked|supabase\s+db\s+push/.test(
      text,
    )
  )
    errors.push(file + ': forbidden bypass or production database command');
}
for (const file of [
  'fabric-poc/package.json',
  'deploy/cloudflare/package.json',
  'deploy/cloudflare-mailer/package.json',
]) {
  const app = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, version] of Object.entries({ ...app.dependencies, ...app.devDependencies }))
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
      errors.push(file + ': unpinned package ' + name);
}
if (errors.length) throw Error(errors.join('\n'));
console.log('Workflow pinning, forbidden bypass and dependency policies passed');
