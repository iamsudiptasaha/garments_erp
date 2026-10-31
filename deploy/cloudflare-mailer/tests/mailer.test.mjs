import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailHandler } from '../handler.mjs';
import { signMail, verifyMail, sendMailHttp } from '../../../server/mail/protocol.mjs';
const secret = 'synthetic-shared-key-only-for-unit-tests';
const env = {
  MAILER_SHARED_SECRET: secret,
  GMAIL_ADDRESS: 'sender@example.gmail.com',
  GMAIL_APP_PASSWORD: 'synthetic-placeholder',
};
// The actual sender validation accepts @gmail.com, never arbitrary header input.
env.GMAIL_ADDRESS = 'synthetic.sender@gmail.com';
async function request(payload, headers = {}) {
  const body = JSON.stringify(payload);
  return new Request('https://mailer.example.invalid/send', {
    method: 'POST',
    headers: { ...(await signMail(body, secret)), ...headers },
    body,
  });
}
const message = { type: 'account-recovery', employeeCode: 'SCE/90001', code: 'A'.repeat(32) };
test('valid signed recovery sends only the fixed administrator template', async () => {
  let sent;
  const handler = createMailHandler(async (_env, m) => {
    sent = m;
  });
  const result = await handler(await request(message), env);
  assert.equal(result.status, 200);
  assert.equal(sent.to, 'sahacreationsllp0int@gmail.com');
  assert.equal(sent.from, env.GMAIL_ADDRESS);
  assert.match(sent.text, /SCE\/90001/);
  assert.equal((await result.json()).sent, true);
});
test('unsigned or tampered requests never reach SMTP', async () => {
  let calls = 0;
  const handler = createMailHandler(async () => calls++);
  assert.equal(
    (
      await handler(
        new Request('https://mailer.example.invalid/send', {
          method: 'POST',
          body: JSON.stringify(message),
        }),
        env,
      )
    ).status,
    401,
  );
  const r = await request(message);
  const bad = new Request(r.url, {
    method: 'POST',
    headers: r.headers,
    body: JSON.stringify({ ...message, code: 'B'.repeat(32) }),
  });
  assert.equal((await handler(bad, env)).status, 401);
  assert.equal(calls, 0);
});
test('expired and future signatures are rejected', async () => {
  const body = JSON.stringify(message),
    now = Math.floor(Date.now() / 1000);
  assert.equal(
    await verifyMail(body, new Headers(await signMail(body, secret, now - 121)), secret, now),
    false,
  );
  assert.equal(
    await verifyMail(body, new Headers(await signMail(body, secret, now + 31)), secret, now),
    false,
  );
});
test('a signed caller cannot choose recipients or arbitrary email content', async () => {
  let calls = 0;
  const handler = createMailHandler(async () => calls++);
  assert.equal(
    (await handler(await request({ ...message, to: 'other@example.invalid' }), env)).status,
    400,
  );
  assert.equal(
    (await handler(await request({ type: 'arbitrary', text: 'spam' }), env)).status,
    400,
  );
  assert.equal(calls, 0);
});
test('body limit applies even without a Content-Length header', async () => {
  const handler = createMailHandler(async () => assert.fail('SMTP must not run'));
  const r = new Request('https://mailer.example.invalid/send', {
    method: 'POST',
    body: 'x'.repeat(1025),
  });
  assert.equal((await handler(r, env)).status, 413);
});
test('SMTP failures and missing configuration do not echo credentials or codes', async () => {
  const handler = createMailHandler(async () => {
    throw Error(env.GMAIL_APP_PASSWORD + message.code);
  });
  const r = await handler(await request(message), env);
  assert.equal(r.status, 502);
  const body = await r.text();
  assert.equal(body.includes(env.GMAIL_APP_PASSWORD), false);
  assert.equal(body.includes(message.code), false);
  assert.equal((await handler(await request(message), {})).status, 503);
});
test('HTTP adapter requires clean HTTPS, signs the request and refuses redirects', async () => {
  let called = false;
  await sendMailHttp({
    url: 'https://mailer.example.invalid/send',
    secret,
    message,
    fetcher: async (url, options) => {
      called = true;
      assert.equal(options.redirect, 'error');
      assert.equal(await verifyMail(options.body, new Headers(options.headers), secret), true);
      return Response.json({ sent: true });
    },
  });
  assert.equal(called, true);
  await assert.rejects(
    sendMailHttp({ url: 'http://mailer.example.invalid/send', secret, message }),
    /HTTPS/,
  );
});
test('connection test is authenticated and contains no recovery credential', async () => {
  let sent;
  const handler = createMailHandler(async (_e, m) => {
    sent = m;
  });
  assert.equal((await handler(await request({ type: 'connection-test' }), env)).status, 200);
  assert.equal(sent.to, 'sahacreationsllp0int@gmail.com');
  assert.match(sent.subject, /connection test/);
  assert.equal(sent.text.includes('AAAA'), false);
});
