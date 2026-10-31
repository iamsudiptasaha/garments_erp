import { createMailHandler } from '../../deploy/cloudflare-mailer/handler.mjs';
// Test adapter only. Never deploy this harness or use it with production credentials.
const settings = JSON.parse(await Deno.readTextFile('/tmp/erp-test-runtime.json'));
if (settings.API_URL !== 'http://127.0.0.1:55421') throw Error('Only the isolated API is allowed');
Deno.env.set('SUPABASE_URL', settings.API_URL);
Deno.env.set('SUPABASE_ANON_KEY', settings.ANON_KEY);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', settings.SERVICE_ROLE_KEY);
Deno.env.set('RECOVERY_PEPPER', 'synthetic-integration-pepper-never-for-production');
for (const key of [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'MAILER_URL',
  'MAILER_SHARED_SECRET',
])
  Deno.env.delete(key);
let delivered: unknown = null;
const secret = 'synthetic-mailer-key-for-isolated-tests-only';
const mailer = createMailHandler(async (_env: unknown, message: unknown) => {
  delivered = message;
});
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://mailer.example.invalid/send')
    return mailer(new Request(url, init), {
      MAILER_SHARED_SECRET: secret,
      GMAIL_APP_PASSWORD: 'synthetic-only',
      GMAIL_ADDRESS: 'synthetic@gmail.com',
    });
  return originalFetch(input, init);
}) as typeof fetch;
const serve = Deno.serve;
Deno.serve = ((handler: Deno.ServeHandler) =>
  serve({ hostname: '127.0.0.1', port: 55425 }, (req, info) => {
    const path = new URL(req.url).pathname;
    if (path === '/__test-enable-mailer' && req.method === 'POST') {
      Deno.env.set('MAILER_URL', 'https://mailer.example.invalid/send');
      Deno.env.set('MAILER_SHARED_SECRET', secret);
      return new Response(null, { status: 204 });
    }
    if (path === '/__test-mailbox') return Response.json(delivered);
    return handler(req, info);
  })) as typeof Deno.serve;
await import('../../supabase/functions/erp-accounts/index.ts');
