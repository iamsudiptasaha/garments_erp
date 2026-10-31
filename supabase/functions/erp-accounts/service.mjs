// Portable account lifecycle logic. Adapters own Auth, database and SMTP connections.
export const RECOVERY_MESSAGE =
  'If the request is valid, contact your Administrator for the recovery code.';
export function strongPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw Error('Use a password between 12 and 128 characters.');
  return value;
}
export function phoneNumber(value) {
  if (!/^[6-9]\d{9}$/.test(String(value || '')))
    throw Error('Enter a valid 10-digit mobile number.');
  return '+91' + value;
}
export async function credentialDigest(code, pepper) {
  if (!pepper || pepper.length < 32) throw Error('Recovery is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export function recoveryCode() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
export async function accountAction(input, io) {
  if (input.action === 'recover') {
    const phone = phoneNumber(input.phone);
    strongPassword(input.password);
    if (!/^[A-F0-9]{32}$/.test(input.code || ''))
      throw Error('Recovery code is invalid or expired.');
    const target = await io.consume(phone, await credentialDigest(input.code, io.pepper));
    if (!target) throw Error('Recovery code is invalid or expired.');
    // Consume first: concurrent requests cannot change the password twice. Failure requires a new code.
    await io.setPassword(target, input.password);
    await io.passwordComplete(target);
    return { message: 'Password updated. Sign in and verify Google Authenticator.' };
  }
  const actor = await io.actor(); // Validated Auth identity, never user_metadata.
  if (input.action === 'changePassword') {
    strongPassword(input.password);
    await io.requireReady(actor);
    await io.verifyPassword(actor, input.currentPassword);
    await io.setPassword(actor.id, input.password);
    await io.passwordComplete(actor.id);
    return { message: 'Password updated. Sign in again.' };
  }
  await io.requireAdmin(actor);
  if (input.action === 'create') {
    if (!/^\d+$/.test(String(input.employeeId))) throw Error('Choose an employee.');
    const phone = phoneNumber(input.phone);
    await io.employeeAvailable(String(input.employeeId));
    const account = await io.createUser(phone, recoveryCode());
    try {
      await io.link(account.id, String(input.employeeId), input.roleIds, input.enabled === true);
    } catch {
      await io.removeUnlinked(account.id);
      throw Error('Account could not be linked. Refresh and retry.');
    }
    // No password is returned, displayed, logged or stored outside Auth.
    return { message: 'Account created. Send a setup code to the Administrator next.' };
  }
  if (input.action === 'issueRecovery') {
    const target = await io.linkedAccount(input.userId);
    const code = recoveryCode();
    const ticket = await io.reserve(
      target.user_id,
      await credentialDigest(code, io.pepper),
      actor.id,
    );
    try {
      await io.sendCode(target, code);
    } catch {
      await io.cancel(ticket);
      throw Error('Recovery email could not be sent. No usable code was issued.');
    }
    return { message: RECOVERY_MESSAGE };
  }
  throw Error('Unknown account operation.');
}
