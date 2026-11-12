import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { totp } from './billing-totp.mjs';

const { BILLING_AUTH_HOST, BILLING_TEST_HOST, BILLING_AUTH_PASSWORD } = process.env;
for (const host of [BILLING_AUTH_HOST, BILLING_TEST_HOST]) assert.match(host, /^127\.0\.0\.1:\d+$/);

async function post(host, path, payload, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch('http://' + host + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json() };
}

async function auth(path, payload, token) {
  const result = await post(BILLING_AUTH_HOST, path, payload, token);
  assert.ok(result.status >= 200 && result.status < 300, path + ' returned ' + result.status);
  return result.data;
}

async function invoiceList(token) {
  return post(BILLING_TEST_HOST, '/rpc/erp_portal_invoice_list', {}, token);
}

async function signIn(account, expectedStatus) {
  const { access_token: aal1 } = await auth('/token?grant_type=password', {
    email: account + '@example.invalid',
    password: BILLING_AUTH_PASSWORD,
  });
  assert.equal((await invoiceList(aal1)).status, 403);
  const factor = await auth(
    '/factors',
    { factor_type: 'totp', friendly_name: 'Billing release' },
    aal1,
  );
  const challenge = await auth('/factors/' + factor.id + '/challenge', {}, aal1);
  const step = Math.floor(Date.now() / 30000);
  const { access_token: aal2 } = await auth(
    '/factors/' + factor.id + '/verify',
    { challenge_id: challenge.id, code: totp(factor.totp.secret, step) },
    aal1,
  );
  assert.equal((await invoiceList(aal2)).status, expectedStatus);
  console.log('PASS real Auth password, TOTP and invoice permission for ' + account);
  if (account === 'admin' && process.env.BILLING_AUTH_BROWSER_FIXTURE) {
    writeFileSync(
      process.env.BILLING_AUTH_BROWSER_FIXTURE,
      JSON.stringify({
        email: account + '@example.invalid',
        password: BILLING_AUTH_PASSWORD,
        secret: factor.totp.secret,
        step,
      }),
      { mode: 0o600 },
    );
  }
  return aal2;
}

const admin = await signIn('admin', 200);
for (const [account, token, code] of [['administrator', admin, 'SCE/90001']]) {
  const profile = await post(BILLING_TEST_HOST, '/rpc/erp_portal_return_workspace', {}, token);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.employee, code);
  console.log('PASS real Auth employee identity for ' + account);
}
const viewer = await signIn('viewer', 403);
const packing = await post(BILLING_TEST_HOST, '/rpc/erp_portal_packing_lists', {}, viewer);
assert.equal(packing.status, 200);
console.log('PASS real Auth viewer permitted on Packing Lists and denied on Invoices');
