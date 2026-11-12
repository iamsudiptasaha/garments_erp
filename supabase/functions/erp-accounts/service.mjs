export function strongPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw Error('Use a password between 12 and 128 characters.');
  return value;
}

function emailAddress(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error('Enter the employee login email.');
  return email;
}

export async function accountAction(input, io) {
  const actor = await io.actor();
  if (input.action === 'changePassword') {
    strongPassword(input.password);
    await io.requireReady();
    await io.verifyPassword(actor, input.currentPassword);
    await io.setPassword(actor.id, input.password);
    await io.passwordComplete(actor.id);
    return { message: 'Password updated. Sign in again.' };
  }
  await io.requireAdmin();
  const { action } = input;
  if (!['invite', 'retry', 'resend', 'cancel', 'correct'].includes(action))
    throw Error('Unknown account operation.');
  const employee = String(input.employeeId);
  if (!/^\d+$/.test(employee)) throw Error('Choose an employee.');
  const email = ['invite', 'correct'].includes(action) ? emailAddress(input.email) : null;
  const revision = input.revision ?? null;
  const roles = action === 'invite' ? input.roleIds : null;
  if (action === 'invite' && (!Array.isArray(roles) || !roles.length))
    throw Error('Choose at least one role.');
  const request = await io.invitation(action, employee, email, roles, revision);
  if (request.state === 'cancelled') return { message: 'Invitation cancelled.' };
  if (request.state === 'linked') return { message: 'Employee access linked.' };
  await io.invite(request.email, request.nonce);
  if (action !== 'resend') await io.invitation('finish', employee, null, null, request.revision);
  return {
    message:
      { resend: 'Invitation resent.', correct: 'Invitation sent to the corrected email.' }[
        action
      ] || 'Invitation sent.',
  };
}
