import React, { useEffect, useState } from 'react';
import { createVerificationClient, getAccessClient } from './client.js';
const h = React.createElement;
export async function accountCommand(input) {
  const { data, error } = await getAccessClient().functions.invoke('erp-accounts', { body: input });
  if (error || data?.error)
    throw Error('Account operation failed. Check the details or contact the Administrator.');
  return data;
}
export function RecoveryForm() {
  const [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return h(
    'details',
    null,
    h('summary', null, 'Forgot password?'),
    h(
      'form',
      {
        onSubmit: async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await getAccessClient().auth.resetPasswordForEmail(email.trim(), {
              redirectTo: new URL('/access.html', location.origin).href,
            });
          } catch {
            // Use the same response for every address.
          } finally {
            setMessage('If this email is registered, you will receive a password reset link.');
            setBusy(false);
          }
        },
      },
      h(
        'label',
        null,
        'Registered email',
        h('input', {
          type: 'email',
          required: true,
          autoComplete: 'email',
          value: email,
          onChange: (e) => setEmail(e.target.value),
        }),
      ),
      h('button', { disabled: busy, type: 'submit' }, 'Send reset link'),
    ),
    message && h('p', { role: 'status' }, message),
  );
}

export function readPasswordLink(hash, search = '') {
  const fragment = new URLSearchParams(hash.slice(1));
  const query = new URLSearchParams(search);
  const type = fragment.get('type') ?? query.get('type');
  if (fragment.has('error') || query.has('error')) return { type, invalid: true };
  if (type !== 'invite' && type !== 'recovery') return null;

  const tokenHash = fragment.get('token_hash');
  if (tokenHash) return { type, tokenHash };
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) return { type, accessToken, refreshToken };
  return { type, invalid: true };
}

export function PasswordLink({ link }) {
  const [client] = useState(createVerificationClient);
  const linkError =
    link.type === 'recovery'
      ? 'This password link is invalid or expired. Request another from the sign-in screen.'
      : 'This invitation is invalid or expired. Ask your Administrator to resend it.';
  const [step, setStep] = useState(link.invalid ? 'invalid' : 'confirm'),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(link.invalid ? linkError : ''),
    [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setMessage('');
    try {
      const verified = link.tokenHash
        ? await client.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash })
        : await client.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
      if (verified.error || !verified.data.session) throw Error();
      if (!link.tokenHash) {
        const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (
          assurance.error ||
          !assurance.data.currentAuthenticationMethods.some((entry) =>
            typeof entry === 'string' ? entry === 'otp' : entry.method === 'otp',
          )
        )
          throw Error();
      }
      const security = await client.rpc('erp_account_security');
      if (
        security.error ||
        !security.data?.enabled ||
        (link.type === 'invite' && !security.data.mustChangePassword)
      )
        throw Error();
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) throw Error();
      setStep(factors.data.totp.length ? 'mfa' : 'password');
    } catch {
      await client.auth.signOut({ scope: 'local' });
      setStep('invalid');
      setMessage(linkError);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const updated = await client.auth.updateUser({ password });
      if (updated.error) throw updated.error;
      setPassword('');
      const signedOut = await client.auth.signOut();
      if (signedOut.error) throw signedOut.error;
      location.replace('/access.html');
    } catch {
      setMessage('Could not complete the password update. Check your password and retry.');
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    { className: 'access-login' },
    h(
      'h2',
      null,
      link.type === 'invite'
        ? 'Accept invitation'
        : link.type === 'recovery'
          ? 'Reset password'
          : 'Password setup',
    ),
    message && h('p', { className: 'form-error', role: 'alert' }, message),
    step === 'invalid'
      ? null
      : step === 'confirm'
        ? h('button', { className: 'primary', disabled: busy, onClick: accept }, 'Continue')
        : step === 'mfa'
          ? h(Authenticator, { verificationClient: client, onVerified: () => setStep('password') })
          : h(
              'form',
              { onSubmit: save },
              h(
                'label',
                null,
                'New password',
                h('input', {
                  type: 'password',
                  required: true,
                  minLength: 12,
                  maxLength: 128,
                  autoComplete: 'new-password',
                  value: password,
                  onChange: (e) => setPassword(e.target.value),
                }),
              ),
              h(
                'button',
                { className: 'primary', disabled: busy, type: 'submit' },
                'Save password',
              ),
            ),
    h('a', { className: 'password-link-back', href: '/access.html' }, 'Back to sign in'),
  );
}

export function Authenticator({ onVerified, verificationClient = null }) {
  const [factors, setFactors] = useState(null),
    [factor, setFactor] = useState(''),
    [enrolment, setEnrolment] = useState(null),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const client = verificationClient || getAccessClient();
  useEffect(() => {
    let active = true;
    client.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      setFactors(data.totp);
      setFactor(data.totp[0]?.id || '');
    });
    return () => {
      active = false;
    };
  }, [client]);
  async function enroll() {
    setBusy(true);
    setError('');
    try {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      // Replace only unfinished enrolments, never a verified factor.
      for (const f of data.all.filter(
        (f) => f.factor_type === 'totp' && f.status === 'unverified',
      )) {
        const r = await client.auth.mfa.unenroll({ factorId: f.id });
        if (r.error) throw r.error;
      }
      const r = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Garment ERP',
        issuer: 'Garment ERP',
      });
      if (r.error) throw r.error;
      setEnrolment(r.data);
      setFactor(r.data.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await client.auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (r.error) throw r.error;
      setCode('');
      setEnrolment(null);
      await onVerified();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    { className: 'access-login' },
    h('h2', null, 'Google Authenticator'),
    h('p', null, 'Use the six-digit code from your authenticator app. No SMS is sent.'),
    error && h('p', { role: 'alert' }, error),
    factors === null
      ? h('p', null, 'Loading authenticator…')
      : !factors.length && !enrolment
        ? h('button', { disabled: busy, onClick: enroll }, 'Set up Google Authenticator')
        : h(
            'form',
            { onSubmit: verify },
            enrolment &&
              h(
                React.Fragment,
                null,
                h('p', null, 'Scan this QR code with Google Authenticator, then enter its code.'),
                h('img', {
                  alt: 'Authenticator setup QR code',
                  width: 220,
                  height: 220,
                  src: enrolment.totp.qr_code.startsWith('data:')
                    ? enrolment.totp.qr_code
                    : 'data:image/svg+xml;charset=utf-8,' +
                      encodeURIComponent(enrolment.totp.qr_code),
                }),
                h(
                  'details',
                  null,
                  h('summary', null, 'Enter setup key manually'),
                  h('code', null, enrolment.totp.secret),
                ),
              ),
            factors.length > 1 &&
              h(
                'label',
                null,
                'Authenticator',
                h(
                  'select',
                  { value: factor, onChange: (e) => setFactor(e.target.value) },
                  factors.map((f) =>
                    h('option', { key: f.id, value: f.id }, f.friendly_name || 'Authenticator'),
                  ),
                ),
              ),
            h(
              'label',
              null,
              'Authenticator code',
              h('input', {
                required: true,
                inputMode: 'numeric',
                autoComplete: 'one-time-code',
                pattern: '[0-9]{6}',
                maxLength: 6,
                value: code,
                onChange: (e) => setCode(e.target.value),
              }),
            ),
            h('button', { type: 'submit', disabled: busy }, 'Verify authenticator'),
          ),
  );
}
export function PasswordSettings() {
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return h(
    'details',
    null,
    h('summary', null, 'Change my password'),
    h(
      'form',
      {
        onSubmit: async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await accountCommand({ action: 'changePassword', currentPassword: current, password });
            setCurrent('');
            setPassword('');
            await getAccessClient().auth.signOut();
            location.assign('/access.html');
          } catch (e) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        },
      },
      h(
        'label',
        null,
        'Current password',
        h('input', {
          type: 'password',
          required: true,
          autoComplete: 'current-password',
          value: current,
          onChange: (e) => setCurrent(e.target.value),
        }),
      ),
      h(
        'label',
        null,
        'New password',
        h('input', {
          type: 'password',
          required: true,
          minLength: 12,
          maxLength: 128,
          autoComplete: 'new-password',
          value: password,
          onChange: (e) => setPassword(e.target.value),
        }),
      ),
      h('button', { type: 'submit', disabled: busy }, 'Update password and sign out'),
    ),
    message && h('p', { role: 'alert' }, message),
  );
}
