import React, { useEffect, useRef, useState } from 'react';
import { getAccessClient } from './client.js';
import { accountReturnPath, adminPath } from './workspace-routes.js';

function openSignIn() {
  const returnTo = accountReturnPath(location.pathname + location.search + location.hash);
  location.replace(returnTo ? adminPath + '?returnTo=' + encodeURIComponent(returnTo) : adminPath);
}
const h = React.createElement;
export function sessionAccessModel(session) {
  const administrator = session.administrator === true,
    roleId = administrator ? 'admin' : 'session-role';
  return {
    version: 2,
    revision: 0,
    roles: [
      {
        id: roleId,
        name: administrator ? 'Administrator' : 'Assigned access',
        locked: administrator,
        permissions: session.permissions || {},
      },
    ],
    users: [
      {
        id: session.actor,
        employeeCode: 'Signed-in account',
        name: administrator ? 'Administrator' : 'Signed-in employee',
        phone: '',
        roleId,
        active: session.enabled === true,
      },
    ],
    audit: [],
  };
}
export function WorkspaceGate({ render }) {
  const [state, setState] = useState(null),
    [error, setError] = useState('');
  const refresh = useRef(null);
  useEffect(() => {
    let active = true,
      revision = 0,
      sessionUserId,
      client;
    try {
      client = getAccessClient();
    } catch (e) {
      setError(e.message);
      return;
    }
    async function load() {
      const ticket = ++revision;
      try {
        const { data: auth, error: authError } = await client.auth.getSession();
        if (!active || ticket !== revision) return;
        if (authError) throw authError;
        sessionUserId = auth.session?.user.id;
        if (!auth.session) {
          setState(null);
          openSignIn();
          return;
        }
        const security = await client.rpc('erp_account_security');
        if (!active || ticket !== revision) return;
        if (security.error) throw security.error;
        if (security.data?.enabled && !security.data.ready) {
          setState(null);
          openSignIn();
          return;
        }
        const { data, error } = await client.rpc('erp_access_snapshot');
        if (error) throw error;
        if (active && ticket === revision) {
          setState(data);
          setError('');
        }
      } catch (e) {
        if (active && ticket === revision) {
          setState(null);
          setError(e.message);
        }
      }
    }
    refresh.current = load;
    void load();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        const nextUserId = session?.user.id;
        // Refocusing another tab can emit SIGNED_IN again for the same account.
        if (nextUserId !== sessionUserId) setState(null);
        sessionUserId = nextUserId;
        void load();
      }
    });
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      revision++;
      data.subscription.unsubscribe();
      window.removeEventListener('focus', focus);
    };
  }, []);
  if (error)
    return h(
      'main',
      { className: 'fabric-main' },
      h('h1', null, 'Unable to load access'),
      h('p', { role: 'alert' }, error),
      h('a', { href: '/access.html' }, 'Return to sign in'),
    );
  if (!state)
    return h(
      'main',
      { className: 'fabric-main' },
      h('p', { role: 'status' }, 'Loading workspace…'),
    );
  if (!state.enabled)
    return h(
      'main',
      { className: 'fabric-main' },
      h('h1', null, 'Account awaiting activation'),
      h('p', null, state.reason),
      h('a', { href: '/access.html' }, 'Account settings'),
    );
  return render(state, refresh.current);
}
