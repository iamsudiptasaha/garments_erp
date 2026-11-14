import { EmployeeAvatar } from '../hr/avatar.js';
import { flushNavigationPreferences } from './navigation-preferences.js';
import React, { useEffect, useRef, useState } from 'react';
import { getAccessClient } from './client.js';
const h = React.createElement;
function dismissAccountMenu(details) {
  if (!details.open) return;
  details.dataset.dismissed = 'true';
  details.open = false;
}
export function AccountFooter({
  name = 'My account',
  role = 'Signed-in workspace',
  photoId,
  live = true,
  onCollapse,
  onSignOut,
  destination,
}) {
  const menu = useRef(null);
  const previousDestination = useRef(destination);
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
  useEffect(() => {
    const details = menu.current;
    function dismissOutside(event) {
      if (details.open && !event.composedPath().includes(details)) dismissAccountMenu(details);
    }
    function dismissOnEscape(event) {
      if (event.key !== 'Escape' || !details.open || event.defaultPrevented) return;
      const restoreFocus = details.contains(document.activeElement);
      dismissAccountMenu(details);
      if (restoreFocus && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        details.querySelector('summary').focus();
      }
    }
    document.addEventListener('click', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      document.removeEventListener('click', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  }, []);
  useEffect(() => {
    if (previousDestination.current !== destination) {
      previousDestination.current = destination;
      dismissAccountMenu(menu.current);
    }
  }, [destination]);
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
      { ref: menu, className: 'sidebar-account-menu', 'data-nav-section': 'account' },
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
