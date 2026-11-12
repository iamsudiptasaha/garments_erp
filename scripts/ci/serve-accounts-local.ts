// Test adapter only. Never deploy this harness or use it with production credentials.
const settings = JSON.parse(await Deno.readTextFile('/tmp/erp-test-runtime.json'));
if (settings.API_URL !== 'http://127.0.0.1:55421') throw Error('Only the isolated API is allowed');
Deno.env.set('SUPABASE_URL', settings.API_URL);
Deno.env.set('SUPABASE_ANON_KEY', settings.ANON_KEY);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', settings.SERVICE_ROLE_KEY);
const serve = Deno.serve;
Deno.serve = ((handler: Deno.ServeHandler) =>
  serve({ hostname: '127.0.0.1', port: 55425 }, handler)) as typeof Deno.serve;
await import('../../supabase/functions/erp-accounts/index.ts');
