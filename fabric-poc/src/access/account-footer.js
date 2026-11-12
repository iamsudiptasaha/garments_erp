import { EmployeeAvatar } from '../hr/avatar.js';
import { flushNavigationPreferences } from './navigation-preferences.js';
import React, { useEffect, useState } from 'react';
import { getAccessClient } from './client.js';
const h = React.createElement;
export function AccountFooter({
  name = 'My account',
  role = 'Signed-in workspace',
  photoId,
  live = true,
  onCollapse,
  onSignOut,
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [updatedProfile, setUpdatedProfile] = useState(null);
  const displayName = updatedProfile?.name || name;
  const currentPhoto = updatedProfile ? updatedProfile.photo : photoId;
  useEffect(() => {
    function update(event) {
      setUpdatedProfile(event.detail);
    }
    window.addEventListener('erp-profile-updated', update);
    return () => window.removeEventListener('erp-profile-updated', update);
  }, []);
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
        h(EmployeeAvatar, {
          className: 'sidebar-account-avatar',
          photoId: live ? currentPhoto : null,
          name: displayName,
        }),
        h(
          'span',
          { className: 'sidebar-account-identity' },
          h('strong', null, displayName),
          h('small', null, role),
        ),
      ),
      h(
        'nav',
        { 'aria-label': 'Personal account actions' },
        h(
          'a',
          { href: live ? '/access.html#profile' : '/access.html' },
          live ? 'Account settings' : 'Live sign-in',
        ),
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
