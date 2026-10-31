import { validateMail, verifyMail } from '../../server/mail/protocol.mjs';
const ADMIN = 'sahacreationsllp0int@gmail.com';
export function createMailHandler(send) {
  return async function handle(request, env) {
    const reply = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    if (new URL(request.url).pathname !== '/send') return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'POST required' }, 405);
    if (
      !env.MAILER_SHARED_SECRET ||
      env.MAILER_SHARED_SECRET.length < 32 ||
      !env.GMAIL_APP_PASSWORD ||
      !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(env.GMAIL_ADDRESS || '')
    )
      return reply({ error: 'Mailer unavailable' }, 503);
    if (Number(request.headers.get('Content-Length')) > 1024)
      return reply({ error: 'Request too large' }, 413);
    const reader = request.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader)
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return reply({ error: 'Request too large' }, 413);
        }
        chunks.push(r.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const body = new TextDecoder().decode(bytes);
    if (!(await verifyMail(body, request.headers, env.MAILER_SHARED_SECRET)))
      return reply({ error: 'Unauthorized' }, 401);
    let message;
    try {
      message = validateMail(JSON.parse(body));
    } catch {
      return reply({ error: 'Invalid mail' }, 400);
    }
    const subject =
      message.type === 'connection-test'
        ? 'ERP email connection test'
        : 'ERP employee password setup / recovery';
    const text =
      message.type === 'connection-test'
        ? 'The ERP Gmail sender accepted this test message.'
        : `Employee: ${message.employeeCode}\nSingle-use recovery code: ${message.code}\nExpires in 15 minutes. Give this code only to the named employee after verifying their identity. Never share your own login password.`;
    try {
      await send(env, { from: env.GMAIL_ADDRESS, to: ADMIN, subject, text });
      return reply({ sent: true });
    } catch {
      return reply({ error: 'Email delivery failed' }, 502);
    }
  };
}
