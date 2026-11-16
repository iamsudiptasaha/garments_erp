import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { accountAction } from './service.mjs';
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control': 'no-store',
};
Deno.serve(async (req) => {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'POST required' }, 405);
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sign in required' }, 401);
  if (Number(req.headers.get('Content-Length')) > 8192)
    return reply({ error: 'Request too large' }, 413);
  try {
    // Read a bounded stream even when Content-Length is absent or false.
    const reader = req.body?.getReader();
    let size = 0;
    const parts = [];
    if (reader)
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return reply({ error: 'Request too large' }, 413);
        }
        parts.push(r.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.byteLength;
    }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    const url = Deno.env.get('SUPABASE_URL')!,
      key = Deno.env.get('SUPABASE_ANON_KEY')!;
    const user = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    async function checked(result: PromiseLike<{ data: unknown; error: unknown }>) {
      const { data, error } = await result;
      if (error) throw Error('Account operation failed. Refresh and retry.');
      return data as any;
    }
    async function access() {
      return await checked(user.rpc('erp_access_snapshot'));
    }
    const redirectTo =
      new URL(url).hostname === '127.0.0.1'
        ? 'http://127.0.0.1:18687/access.html'
        : 'https://garments-erp.sahacreationsllp0int.workers.dev/access';
    const io = {
      actor: async () => {
        const { data, error } = await user.auth.getUser();
        if (error || !data.user) throw Error('Sign in required.');
        return data.user;
      },
      requireReady: async () => {
        const s = await checked(user.rpc('erp_account_security'));
        if (!s?.ready) throw Error('Verify Google Authenticator first.');
      },
      requireAdmin: async () => {
        const s = await access();
        const security = await checked(user.rpc('erp_account_security'));
        if (!s.administrator || !s.enabled || !security.ready)
          throw Error('Administrator verification required.');
      },
      invitation: async (
        action: string,
        employee: string,
        email: string | null,
        roles: string[] | null,
        revision: string | null,
      ) =>
        await checked(
          user.rpc('erp_employee_invitation', {
            p_action: action,
            p_employee_id: employee,
            p_email: email,
            p_role_ids: roles,
            p_revision: revision,
          }),
        ),
      invite: async (email: string, nonce: string | null) => {
        await checked(
          service.auth.admin.inviteUserByEmail(email, {
            redirectTo,
            data: nonce ? { erp_invitation: nonce } : undefined,
          }),
        );
      },
      sendSetupRecovery: async (email: string) => {
        await checked(service.auth.resetPasswordForEmail(email, { redirectTo }));
      },
      verifyPassword: async (actor: any, password: string) => {
        const fresh = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await fresh.auth.signInWithPassword({
          email: actor.email,
          password,
        });
        if (error || data.user?.id !== actor.id) throw Error('Current password is incorrect.');
        await fresh.auth.signOut({ scope: 'local' });
      },
      setPassword: async (id: string, password: string) => {
        await checked(service.auth.admin.updateUserById(id, { password }));
      },
      passwordComplete: async (id: string) => {
        await checked(service.rpc('erp_account_internal', { p_action: 'complete', p_user_id: id }));
      },
    };
    return reply(await accountAction(input, io));
  } catch {
    return reply(
      { error: 'Account operation failed. Check your details or contact the Administrator.' },
      400,
    );
  }
});
