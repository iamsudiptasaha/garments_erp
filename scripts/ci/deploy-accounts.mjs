import { execFileSync } from 'node:child_process';

if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_REF !== 'refs/heads/main' ||
  process.env.GITHUB_REPOSITORY !== 'iamsudiptasaha/garments_erp' ||
  !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)
) {
  throw Error('ERP account deployment requires the protected GitHub main release workflow.');
}

const { SUPABASE_PROJECT_REF, VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN } = process.env;
if (
  !/^[a-z]{20}$/.test(SUPABASE_PROJECT_REF || '') ||
  !SUPABASE_ACCESS_TOKEN ||
  new URL(VITE_SUPABASE_URL).origin !== `https://${SUPABASE_PROJECT_REF}.supabase.co`
) {
  throw Error('The protected environment must identify the same Supabase project as the portal.');
}

execFileSync(
  'npx',
  [
    '--yes',
    'supabase@2.122.0',
    'functions',
    'deploy',
    'erp-accounts',
    '--project-ref',
    SUPABASE_PROJECT_REF,
    '--use-api',
    '--no-verify-jwt',
  ],
  { stdio: 'inherit' },
);
const gateway = await fetch(new URL('/functions/v1/erp-accounts', VITE_SUPABASE_URL), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(15000),
});
if (gateway.status !== 401)
  throw Error('ERP account function did not reject an anonymous request.');
