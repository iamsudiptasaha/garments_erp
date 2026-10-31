const encoder = new TextEncoder();
export function validateMail(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message))
    throw Error('Invalid mail');
  if (message.type === 'connection-test' && Object.keys(message).every((k) => k === 'type'))
    return message;
  if (
    message.type !== 'account-recovery' ||
    !/^SCE\/\d{5}$/.test(message.employeeCode || '') ||
    !/^[A-F0-9]{32}$/.test(message.code || '') ||
    Object.keys(message).some((k) => !['type', 'employeeCode', 'code'].includes(k))
  )
    throw Error('Invalid mail');
  return message;
}
async function key(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Mailer not configured');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}
export async function signMail(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = await crypto.subtle.sign(
    'HMAC',
    await key(secret, 'sign'),
    encoder.encode(`${timestamp}.${body}`),
  );
  return {
    'X-ERP-Timestamp': String(timestamp),
    'X-ERP-Signature': [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  };
}
export async function verifyMail(body, headers, secret, now = Math.floor(Date.now() / 1000)) {
  const stamp = headers.get('X-ERP-Timestamp') || '',
    signature = headers.get('X-ERP-Signature') || '';
  if (
    !/^\d{10}$/.test(stamp) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    now - Number(stamp) > 120 ||
    Number(stamp) - now > 30
  )
    return false;
  const bytes = Uint8Array.from(signature.match(/../g), (h) => parseInt(h, 16));
  return crypto.subtle.verify(
    'HMAC',
    await key(secret, 'verify'),
    bytes,
    encoder.encode(`${stamp}.${body}`),
  );
}
export async function sendMailHttp({ url, secret, message, fetcher = fetch }) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/send'
  )
    throw Error('Mailer must be a clean HTTPS /send endpoint');
  validateMail(message);
  const body = JSON.stringify(message);
  const response = await fetcher(target.href, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(await signMail(body, secret)) },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('Email delivery failed');
  const result = await response.json();
  if (result.sent !== true) throw Error('Email delivery failed');
}
