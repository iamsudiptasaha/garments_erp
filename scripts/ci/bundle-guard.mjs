import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(process.argv[2] || 'fabric-poc/dist');
const patterns = [
  /sb_secret_[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:postgres(?:ql)?):\/\/[^\s"'<>]+:[^\s"'<>]+@/g,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g,
];
const errors = [];
function visit(dir) {
  for (const name of readdirSync(dir)) {
    const file = resolve(dir, name);
    if (statSync(file).isDirectory()) {
      visit(file);
      continue;
    }
    if (/(?:^\.env|\.sql$|\.map$|\.pem$|\.key$|\.dump$|\.csv$)/i.test(name))
      errors.push(relative(root, file) + ': forbidden release file');
    if (!/\.(?:js|html|css|json|txt)$/.test(name)) continue;
    const content = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content))
        errors.push(relative(root, file) + ': privileged material detected');
    }
    for (const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
      try {
        const claim = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url'));
        if (claim.role && claim.role !== 'anon')
          errors.push(relative(root, file) + ': non-public JWT detected');
      } catch {
        /* Gitleaks also scans unrecognised tokens. */
      }
    }
  }
}
visit(root);
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Release bundle contains no detected privileged credentials or forbidden data files.',
  );
