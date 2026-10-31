import React, { useEffect, useState } from 'react';
import { getAccessClient } from './client.js';
const h = React.createElement;
export async function accountCommand(input) {
  const { data, error } = await getAccessClient().functions.invoke('erp-accounts', { body: input });
  if (error || data?.error)
    throw Error('Account operation failed. Check the details or contact the Administrator.');
  return data;
}
export function RecoveryForm() {
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return h(
    'details',
    null,
    h('summary', null, 'Forgot password?'),
    h(
      'p',
      null,
      'Contact your Administrator for a single-use recovery code sent to their email. Your Google Authenticator remains required.',
    ),
    h(
      'form',
      {
        onSubmit: async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await accountCommand({ action: 'recover', phone, code, password });
            setCode('');
            setPassword('');
            setMessage(r.message);
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
        'Employee mobile number',
        h('input', {
          type: 'tel',
          required: true,
          maxLength: 10,
          value: phone,
          onChange: (e) => setPhone(e.target.value),
        }),
      ),
      h(
        'label',
        null,
        'Recovery code',
        h('input', {
          required: true,
          autoComplete: 'off',
          value: code,
          onChange: (e) => setCode(e.target.value.trim().toUpperCase()),
        }),
      ),
      h(
        'label',
        null,
        'New password',
        h('input', {
          type: 'password',
          autoComplete: 'new-password',
          required: true,
          minLength: 12,
          maxLength: 128,
          value: password,
          onChange: (e) => setPassword(e.target.value),
        }),
      ),
      h('button', { disabled: busy, type: 'submit' }, 'Reset password'),
    ),
    message && h('p', { role: 'status' }, message),
  );
}
export function Authenticator({ onVerified }) {
  const [factors, setFactors] = useState(null),
    [factor, setFactor] = useState(''),
    [enrolment, setEnrolment] = useState(null),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const client = getAccessClient();
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
