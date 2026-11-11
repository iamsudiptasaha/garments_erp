import { flushNavigationPreferences } from './navigation-preferences.js';
import React, { useState } from 'react';
import { getAccessClient } from './client.js';
const h = React.createElement;
export function AccountFooter({
  name = 'My account',
  role = 'Signed-in workspace',
  live = true,
  onCollapse,
  onSignOut,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      if (onSignOut) await onSignOut();
      else {
        const client = getAccessClient();
        await flushNavigationPreferences(client);
        const { error } = await client.auth.signOut();
        if (error) throw error;
        location.assign('/access.html');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'div',
    { className: 'sidebar-account' },
    h(
      'details',
      { className: 'sidebar-account-menu', 'data-nav-section': 'account' },
      h(
        'summary',
        { 'aria-label': 'Personal account' },
        h('span', { className: 'sidebar-account-avatar', 'aria-hidden': true }, initials),
        h(
          'span',
          { className: 'sidebar-account-identity' },
          h('strong', null, name),
          h('small', null, role),
        ),
      ),
      h(
        'nav',
        { 'aria-label': 'Personal account actions' },
        h('a', { href: '/access.html' }, live ? 'Account settings' : 'Live sign-in'),
        live &&
          h(
            'button',
            { type: 'button', disabled: busy, onClick: signOut },
            busy ? 'Signing out…' : 'Sign out',
          ),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'sidebar-account-collapse',
        'aria-label': 'Collapse navigation',
        onClick: onCollapse,
        title: 'Collapse navigation',
      },
      '«',
    ),
    error && h('p', { role: 'alert' }, error),
  );
}
