import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import nodemailer from 'npm:nodemailer@10.3.1';
import { accountAction } from './service.mjs';
import { sendMailHttp } from '../../../server/mail/protocol.mjs';
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
      key = Deno.env.get('SUPABASE_ANON_KEY')!,
      authorization = req.headers.get('Authorization') || '';
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
    const io = {
      pepper: Deno.env.get('RECOVERY_PEPPER') || '',
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
      employeeAvailable: async (id: string) => {
        const s = await checked(user.rpc('erp_admin_snapshot'));
        if (
          !s.employees.some((e: any) => String(e.id) === id) ||
          s.accounts.some((a: any) => String(a.employee_id) === id)
        )
          throw Error('Employee already linked or unavailable.');
      },
      createUser: async (phone: string, password: string) => {
        const d = await checked(
          service.auth.admin.createUser({ phone, password, phone_confirm: true }),
        );
        return d.user;
      },
      link: async (id: string, employee: string, roles: string[], enabled: boolean) => {
        await checked(
          user.rpc('erp_save_account_access', {
            p_user_id: id,
            p_employee_id: employee,
            p_role_ids: roles,
            p_enabled: enabled,
            p_expected_version: null,
          }),
        );
        await checked(service.rpc('erp_account_internal', { p_action: 'force', p_user_id: id }));
      },
      removeUnlinked: async (id: string) => {
        const unlinked = await checked(
          service.rpc('erp_account_internal', { p_action: 'unlinked', p_user_id: id }),
        );
        if (unlinked) await checked(service.auth.admin.deleteUser(id));
      },
      linkedAccount: async (id: string) => {
        const s = await checked(user.rpc('erp_admin_snapshot'));
        const a = s.accounts.find((a: any) => a.user_id === id && a.is_active);
        if (!a) throw Error('Choose an enabled employee account.');
        return a;
      },
      reserve: async (id: string, digest: string, actor: string) =>
        await checked(
          service.rpc('erp_issue_recovery', { p_user_id: id, p_digest: digest, p_actor: actor }),
        ),
      cancel: async (id: string) => {
        await checked(service.rpc('erp_account_internal', { p_action: 'cancel', p_ticket: id }));
      },
      consume: async (phone: string, digest: string) =>
        await checked(service.rpc('erp_consume_recovery', { p_phone: phone, p_digest: digest })),
      sendCode: async (target: any, code: string) => {
        const endpoint = Deno.env.get('MAILER_URL');
        if (endpoint) {
          await sendMailHttp({
            url: endpoint,
            secret: Deno.env.get('MAILER_SHARED_SECRET') || '',
            message: { type: 'account-recovery', employeeCode: target.employee_code, code },
          });
          return;
        }
        const host = Deno.env.get('SMTP_HOST'),
          username = Deno.env.get('SMTP_USER'),
          password = Deno.env.get('SMTP_PASSWORD'),
          from = Deno.env.get('SMTP_FROM');
        if (!host || !username || !password || !from)
          throw Error('Recovery email is not configured.');
        const transport = nodemailer.createTransport({
          host,
          port: 465,
          secure: true,
          auth: { user: username, pass: password },
          tls: { rejectUnauthorized: true },
          logger: false,
          debug: false,
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });
        try {
          await transport.sendMail({
            from,
            to: 'sahacreationsllp0int@gmail.com',
            subject: 'ERP employee password setup / recovery',
            text: `Employee: ${target.employee_code}\nSingle-use code: ${code}\nExpires in 15 minutes. Give it only to this employee after verifying their identity. This code resets the password; it does not bypass Google Authenticator.`,
          });
        } finally {
          transport.close();
        }
      },
      verifyPassword: async (actor: any, password: string) => {
        const fresh = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const credentials = actor.phone
          ? { phone: actor.phone, password }
          : { email: actor.email, password };
        const { data, error } = await fresh.auth.signInWithPassword(credentials);
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
