import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMainRelease, productionProject } from './migrate-production.mjs';
import { productionOrigin } from './workers-deploy.mjs';

export function accountAuthChanges(current, templates) {
  if (current.uri_allow_list !== null && typeof current.uri_allow_list !== 'string')
    throw Error('Unexpected production Auth redirect allowlist.');
  const redirects = new Set(
    (current.uri_allow_list || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  redirects.add(productionOrigin + '/access');
  redirects.add(productionOrigin + '/access.html');

  const desired = {
    site_url: productionOrigin,
    uri_allow_list: [...redirects].join(','),
    mailer_templates_invite_content: templates.invite,
    mailer_templates_recovery_content: templates.recovery,
  };
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => current[key] !== value),
  );
}

async function configure() {
  assertMainRelease(process.env);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw Error('Configure SUPABASE_ACCESS_TOKEN for Auth settings.');

  async function request(method, changes) {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${productionProject}/config/auth`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: changes ? JSON.stringify(changes) : undefined,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw Error(`Production Auth config ${method} failed (HTTP ${response.status}).`);
    if (method === 'GET') return response.json();
  }

  const templates = Object.fromEntries(
    ['invite', 'recovery'].map((type) => [
      type,
      readFileSync(
        new URL(`../../supabase/templates/employee-${type}.html`, import.meta.url),
        'utf8',
      ),
    ]),
  );
  const changes = accountAuthChanges(await request('GET'), templates);
  if (Object.keys(changes).length) await request('PATCH', changes);
  const remaining = accountAuthChanges(await request('GET'), templates);
  if (Object.keys(remaining).length)
    throw Error('Production Auth callback configuration did not persist.');
  console.log('Production Auth Site URL, redirects and account email templates verified.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await configure();
