import { MyProfile } from './profile.js';
import { flushNavigationPreferences } from './navigation-preferences.js';
import React, { useEffect, useRef, useState } from 'react';
import { getAccessClient } from './client.js';
import { WorkspaceMenuToolbar, WorkspaceSidebar, useWorkspaceMenu } from './navigation.js';
import { Authenticator, RecoveryForm, PasswordLink, readPasswordLink } from './security.js';
import { AccountLifecycle } from '../admin/account-lifecycle.js';
import { AdminDialog } from '../admin/dialog.js';
import { GridSearch, useGridSearch } from '../fabric/grid-toolbar.js';
import '../fabric/styles.css';
import '../admin/styles.css';
import '../colours/styles.css';
import './styles.css';
import { accountReturnPath, adminTabs, workspacePath } from './workspace-routes.js';
import { RoleMembers } from '../admin/members.js';
import {
  PermissionMatrix,
  permissionFlags,
  updateScreenPermissions,
} from '../admin/permission-matrix.js';
const h = React.createElement;

function accessConfiguration() {
  try {
    return { client: getAccessClient(), configurationError: '' };
  } catch (error) {
    return { client: null, configurationError: error.message };
  }
}
async function rpc(name, args) {
  const { data, error } = await getAccessClient().rpc(name, args);
  if (error) throw error;
  return data;
}
export function AccessApp({ workspaceAccess, page, navigate, refreshWorkspaceAccess }) {
  const [{ client, configurationError }] = useState(accessConfiguration);
  const embedded = !!workspaceAccess;
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(embedded),
    [access, setAccess] = useState(workspaceAccess ?? null),
    [security, setSecurity] = useState(null),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [passwordLink, setPasswordLink] = useState(() =>
      embedded ? null : readPasswordLink(location.hash, location.search),
    ),
    [password, setPassword] = useState(''),
    [localPage, setLocalPage] = useState(() =>
      location.hash === '#profile' ? 'profile' : 'adminAccess',
    );
  const showProfile = !embedded && localPage === 'profile';
  const currentUserId = useRef(null);
  const signedInUser = embedded || !!user;
  const tab = adminTabs[embedded ? page : localPage] || 'accounts';
  function selectTab(key) {
    if (embedded) navigate(key);
    else {
      const url = workspacePath(key);
      if (location.pathname + location.search + location.hash !== url)
        history.pushState(null, '', url);
      setLocalPage(key);
    }
  }
  function enterWorkspace() {
    const returnTo = new URLSearchParams(location.search).get('returnTo');
    location.assign(accountReturnPath(returnTo) || '/fabric.html?live=1');
  }
  useEffect(() => {
    if (embedded) return;
    const syncTab = () => {
      const incoming = readPasswordLink(location.hash, location.search);
      if (incoming) setPasswordLink(incoming);
      else setLocalPage(location.hash.slice(1) || 'adminAccess');
    };
    window.addEventListener('popstate', syncTab);
    window.addEventListener('hashchange', syncTab);
    return () => {
      window.removeEventListener('popstate', syncTab);
      window.removeEventListener('hashchange', syncTab);
    };
  }, [embedded]);
  useEffect(() => {
    if (embedded) return;
    if (!client) {
      setReady(true);
      return;
    }
    let active = true;
    client.auth.getSession().then(({ data, error }) => {
      if (active) {
        setUser(data.session?.user || null);
        setReady(true);
        if (error) setError(error.message);
      }
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const next = session?.user || null;
      if ((next?.id ?? null) !== currentUserId.current) {
        currentUserId.current = next?.id ?? null;
        setAccess(null);
        setSnapshot(null);
      }
      setUser(next);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [embedded]);
  async function refresh(updateWorkspace = true) {
    setError('');
    setBusy(true);
    try {
      const checked = await rpc('erp_account_security');
      setSecurity(checked);
      if (checked?.enabled && !checked.ready) {
        setAccess(null);
        setSnapshot(null);
        if (embedded) await refreshWorkspaceAccess();
        return;
      }
      const own = await rpc('erp_access_snapshot');
      setAccess(own);
      setSnapshot(
        own.administrator && (!embedded || workspaceAccess.administrator)
          ? await rpc('erp_admin_snapshot')
          : null,
      );
      if (embedded && updateWorkspace) await refreshWorkspaceAccess();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (signedInUser && !passwordLink) void refresh(false);
  }, [signedInUser, user, passwordLink, workspaceAccess?.administrator]);
  useEffect(() => {
    if (passwordLink) history.replaceState(null, '', location.pathname);
  }, [passwordLink]);
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword('');
      const checked = await rpc('erp_account_security');
      setSecurity(checked);
      if (checked?.ready && !showProfile) enterWorkspace();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setError('');
    await flushNavigationPreferences(client);
    const { error } = await client.auth.signOut();
    if (error) setError(error.message);
  }
  if (configurationError)
    return h(
      'main',
      { className: 'access-live-shell' },
      h('h1', null, 'User management'),
      h('p', { role: 'alert' }, configurationError),
    );
  if (passwordLink)
    return h(
      'main',
      { className: 'access-live-shell' },
      h(PasswordLink, {
        key: passwordLink.tokenHash || passwordLink.accessToken || 'invalid',
        link: passwordLink,
      }),
    );
  const signedIn = signedInUser && access?.enabled;
  const content = h(
    React.Fragment,
    null,
    h(
      'header',
      { className: signedInUser ? 'fabric-page-header' : 'access-live-header' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, 'GARMENT WORKSPACE'),
        h(
          'h1',
          null,
          signedInUser
            ? showProfile
              ? 'My Profile'
              : access?.administrator
                ? 'Administration'
                : 'Account settings'
            : 'Sign in',
        ),
      ),
      signedInUser &&
        h(
          'div',
          null,
          h('button', { disabled: busy, onClick: () => refresh() }, 'Refresh access'),
          !signedIn && h('button', { onClick: signOut }, 'Sign out'),
        ),
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    !ready
      ? h('p', null, 'Loading session…')
      : !signedInUser
        ? h(
            'section',
            { className: 'access-login' },
            h(
              'form',
              { onSubmit: signIn },
              h(
                'label',
                null,
                'Email',
                h('input', {
                  type: 'email',
                  autoComplete: 'username',
                  placeholder: 'you@example.com',
                  value: email,
                  onChange: (e) => setEmail(e.target.value),
                  required: true,
                }),
              ),
              h(
                'label',
                null,
                'Password',
                h('input', {
                  type: 'password',
                  autoComplete: 'current-password',
                  value: password,
                  onChange: (e) => setPassword(e.target.value),
                  required: true,
                }),
              ),
              h(
                'button',
                { className: 'primary', disabled: busy, type: 'submit' },
                busy ? 'Signing in…' : 'Sign in',
              ),
            ),
            h(RecoveryForm),
            h(
              'p',
              { className: 'editor-note' },
              'An Administrator must create and enable your account before you can access the portal.',
            ),
          )
        : security?.enabled && !security.ready
          ? security.mustChangePassword || security.requiresPasswordSignIn
            ? h(
                'section',
                null,
                h(
                  'h2',
                  null,
                  security.mustChangePassword ? 'Set your password' : 'Sign in with your password',
                ),
                h(
                  'p',
                  null,
                  security.mustChangePassword
                    ? 'Open your invitation link to set a password, or sign out and use Forgot password.'
                    : 'Sign out and use your email and password to access the workspace.',
                ),
                h('button', { onClick: signOut }, 'Sign out'),
              )
            : h(Authenticator, {
                onVerified: async () => {
                  await refresh();
                  if (!showProfile) enterWorkspace();
                },
              })
          : !access
            ? h(
                'p',
                null,
                busy
                  ? 'Checking account permissions…'
                  : 'Access could not be loaded. Use Refresh access to retry.',
              )
            : !access.enabled
              ? h(
                  'section',
                  { className: 'access-denied' },
                  h('h2', null, 'Account awaiting activation'),
                  h('p', null, access.reason),
                )
              : showProfile
                ? h(MyProfile)
                : !access.administrator || (embedded && !workspaceAccess.administrator)
                  ? h(
                      'section',
                      null,
                      h('h2', null, 'Signed in'),
                      h(
                        'p',
                        null,
                        'Your account is enabled. Administration is restricted to Administrators.',
                      ),
                      h(
                        'p',
                        { className: 'editor-note' },
                        'Business-data integration is still separate from this live access panel.',
                      ),
                    )
                  : !snapshot
                    ? h(
                        'p',
                        null,
                        busy ? 'Loading Administration…' : 'Use Refresh access to try again.',
                      )
                    : h(
                        React.Fragment,
                        null,
                        h(
                          'div',
                          { className: 'fabric-view-toggle' },
                          [
                            ['adminAccess', 'User Access'],
                            ['adminRoles', 'Roles & Permissions'],
                            ['adminAudit', 'Activity log'],
                          ].map(([key, label]) =>
                            h(
                              'button',
                              {
                                key,
                                'aria-pressed': tab === adminTabs[key],
                                onClick: () => selectTab(key),
                              },
                              label,
                            ),
                          ),
                        ),
                        busy &&
                          h(
                            'p',
                            { className: 'editor-note', role: 'status' },
                            'Refreshing access…',
                          ),
                        tab === 'roles'
                          ? h(RoleManager, { snapshot, onSaved: refresh })
                          : tab === 'accounts'
                            ? h(AccountLifecycle, {
                                snapshot,
                                actorId: access?.actor ?? user?.id,
                                onSaved: refresh,
                              })
                            : h(ActivityLog, { snapshot }),
                      ),
  );
  return embedded
    ? content
    : h(
        AccessShell,
        { access, signedIn, page: localPage, onAdmin: selectTab, onSignOut: signOut },
        content,
      );
}

function AccessShell({ access, signedIn, page, onAdmin, onSignOut, children }) {
  const [open, setOpen] = useWorkspaceMenu();
  return h(
    'div',
    {
      className: signedIn
        ? `fabric-shell access-workspace${open ? '' : ' sidebar-collapsed'}`
        : undefined,
    },
    signedIn &&
      h(WorkspaceSidebar, {
        live: access,
        page,
        onAdmin,
        onSignOut,
        open,
        onClose: () => setOpen(false),
      }),
    h(
      'main',
      { className: 'access-live-shell' },
      signedIn && h(WorkspaceMenuToolbar, { open, onToggle: () => setOpen((value) => !value) }),
      children,
    ),
  );
}

function RoleManager({ snapshot, onSaved }) {
  const [editing, setEditing] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [memberRole, setMemberRole] = useState(null),
    [showArchived, setShowArchived] = useState(false),
    [archiveTarget, setArchiveTarget] = useState(null),
    [search, setSearch] = useState('');
  const query = useGridSearch(search).trim().toLowerCase();
  const visibleRoles = snapshot.roles
    .filter(
      (r) =>
        (showArchived || r.is_active) &&
        [r.name, r.description].some((value) => value?.toLowerCase().includes(query)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  function edit(role) {
    const permissions = {};
    for (const p of snapshot.permissions.filter((p) => p.app_role_id === role?.id)) {
      const key = snapshot.resources.find((r) => r.id === p.app_resource_id)?.key;
      if (key)
        permissions[key] = Object.fromEntries(
          permissionFlags.filter((action) => action !== 'delete').map((a) => [a, p['can_' + a]]),
        );
    }
    setEditing({
      id: role?.id,
      name: role?.name || '',
      description: role?.description || '',
      version: role?.version,
      permissions,
    });
    setError('');
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await rpc('erp_save_role', {
        p_input: {
          id: editing.id,
          name: editing.name,
          description: editing.description,
          permissions: editing.permissions,
        },
        p_expected_version: editing.version ?? null,
      });
      setEditing(null);
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function changeMember(employee, remove) {
    const account = snapshot.accounts.find((a) => a.user_id === employee.id);
    if (!account) throw Error('Link this employee to a login account first.');
    const ids = remove
      ? account.role_ids.filter((id) => id !== memberRole.id)
      : [...new Set([...account.role_ids, memberRole.id])];
    if (!ids.length) throw Error('Assign another role before removing the last role.');
    await rpc('erp_save_account_access', {
      p_user_id: account.user_id,
      p_employee_id: account.employee_id,
      p_role_ids: ids,
      p_enabled: account.is_active,
      p_expected_version: account.version,
    });
    await onSaved();
  }
  async function archive() {
    setBusy(true);
    setError('');
    try {
      await rpc('erp_archive_role', {
        p_role_id: archiveTarget.id,
        p_expected_version: archiveTarget.version,
      });
      setArchiveTarget(null);
      await onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    null,
    memberRole &&
      h(RoleMembers, {
        role: memberRole,
        employees: snapshot.employees.map((e) => {
          const a = snapshot.accounts.find((a) => a.employee_id === e.id);
          return {
            id: a?.user_id || 'employee:' + e.id,
            name: e.name || 'Name not set',
            code: e.employee_code,
            roles: a?.role_ids
              .map((id) => snapshot.roles.find((r) => r.id === id)?.name)
              .filter(Boolean)
              .join(', '),
            assigned: a?.role_ids.includes(memberRole.id) || false,
            enabled: a?.is_active || false,
            unlinked: !a,
            canRemove: (a?.role_ids.length || 0) > 1,
          };
        }),
        onAdd: (e) => changeMember(e, false),
        onRemove: (e) => changeMember(e, true),
        onClose: () => setMemberRole(null),
      }),
    h('h2', null, 'Roles'),
    h(
      'div',
      { className: 'fabric-actions worksheet-actions admin-toolbar' },
      h(GridSearch, { label: 'Search roles', value: search, onChange: setSearch }),
      h(
        'label',
        { className: 'access-check' },
        h('input', {
          type: 'checkbox',
          checked: showArchived,
          onChange: (e) => setShowArchived(e.target.checked),
        }),
        'Include archived roles',
      ),
      h('button', { className: 'primary', onClick: () => edit(null) }, 'Create role'),
    ),
    archiveTarget &&
      h(
        AdminDialog,
        { title: 'Archive role', onClose: () => !busy && setArchiveTarget(null) },
        h('p', null, `Archive ${archiveTarget.name}? Its history will be retained.`),
        error && h('p', { role: 'alert', className: 'form-error' }, error),
        h(
          'div',
          { className: 'editor-actions' },
          h('button', { disabled: busy, onClick: () => setArchiveTarget(null) }, 'Cancel'),
          h(
            'button',
            { disabled: busy, className: 'primary', onClick: archive },
            'Confirm archive',
          ),
        ),
      ),
    editing &&
      h(
        AdminDialog,
        {
          title: editing.id ? 'Edit permissions' : 'Create role',
          onClose: () => !busy && setEditing(null),
        },
        h(
          'form',
          { onSubmit: save },
          error && h('p', { role: 'alert', className: 'form-error' }, error),
          h(
            'div',
            { className: 'fabric-fields' },
            h(
              'label',
              null,
              'Role name',
              h('input', {
                required: true,
                value: editing.name,
                onChange: (e) => setEditing((d) => ({ ...d, name: e.target.value })),
              }),
            ),
            h(
              'label',
              null,
              'Description',
              h('input', {
                value: editing.description,
                onChange: (e) => setEditing((d) => ({ ...d, description: e.target.value })),
              }),
            ),
          ),
          h(PermissionMatrix, {
            resources: snapshot.resources,
            permissions: editing.permissions,
            onChange: (screens, action, checked) =>
              setEditing((draft) => ({
                ...draft,
                permissions: updateScreenPermissions(draft.permissions, screens, action, checked),
              })),
          }),
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { type: 'button', onClick: () => setEditing(null) }, 'Cancel'),
            h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Save role'),
          ),
        ),
      ),
    h(
      'div',
      { className: 'lab-record-table-wrap admin-records' },
      h(
        'table',
        { className: 'access-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ['Role', 'Members', 'Status', 'Actions'].map((label) =>
              h('th', { scope: 'col', key: label }, label),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          visibleRoles.map((r) => {
            const count = snapshot.accounts.filter((a) => a.role_ids.includes(r.id)).length;
            return h(
              'tr',
              { key: r.id },
              h(
                'td',
                null,
                h('strong', null, r.name),
                r.description && h('small', null, r.description),
              ),
              h('td', null, count),
              h('td', null, !r.is_active ? 'Archived' : r.is_system_admin ? 'Protected' : 'Active'),
              h(
                'td',
                { className: 'admin-row-actions' },
                r.is_active &&
                  h(
                    React.Fragment,
                    null,
                    h('button', { onClick: () => setMemberRole(r) }, 'Manage members'),
                    !r.is_system_admin &&
                      h(
                        React.Fragment,
                        null,
                        h('button', { onClick: () => edit(r) }, 'Edit permissions'),
                        h(
                          'button',
                          {
                            disabled: count > 0,
                            title: count ? 'Reassign members before archiving' : undefined,
                            onClick: () => {
                              setError('');
                              setArchiveTarget(r);
                            },
                          },
                          'Archive role',
                        ),
                      ),
                  ),
              ),
            );
          }),
        ),
      ),
    ),
    !visibleRoles.length && h('div', { className: 'empty-state' }, 'No roles match these filters.'),
  );
}

function ActivityLog({ snapshot }) {
  const [search, setSearch] = useState('');
  const [descending, setDescending] = useState(true);
  const query = useGridSearch(search).trim().toLowerCase();
  const accountName = (id) => snapshot.accounts.find((a) => a.user_id === id)?.name;
  const events = snapshot.audit
    .map((entry) => {
      const target =
        entry.target_type === 'employee'
          ? snapshot.employees.find((e) => String(e.id) === entry.target_id)?.name
          : entry.target_type === 'app_role'
            ? entry.details?.name ||
              snapshot.roles.find((r) => String(r.id) === entry.target_id)?.name
            : accountName(entry.target_id);
      return {
        ...entry,
        target: target || entry.target_id || '—',
        actor: accountName(entry.actor_user_id) || entry.actor_user_id || '—',
      };
    })
    .filter((entry) =>
      [entry.action, entry.target, entry.actor].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  if (!descending) events.reverse();
  return h(
    'section',
    null,
    h('h2', null, 'Activity log'),
    h(
      'div',
      { className: 'fabric-actions worksheet-actions admin-toolbar' },
      h(GridSearch, { label: 'Search recent activity', value: search, onChange: setSearch }),
      h(
        'select',
        {
          'aria-label': 'Sort activity',
          value: descending ? 'newest' : 'oldest',
          onChange: (e) => setDescending(e.target.value === 'newest'),
        },
        h('option', { value: 'newest' }, 'Newest first'),
        h('option', { value: 'oldest' }, 'Oldest first'),
      ),
    ),
    h('p', { className: 'editor-note' }, 'Showing up to 200 recent access changes.'),
    h(
      'div',
      { className: 'lab-record-table-wrap admin-records' },
      h(
        'table',
        { className: 'access-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ['Action', 'Subject', 'Changed by', 'Time'].map((label) =>
              h('th', { scope: 'col', key: label }, label),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          events.map((entry) =>
            h(
              'tr',
              { key: entry.id },
              h('td', null, entry.action),
              h('td', null, entry.target),
              h('td', null, entry.actor),
              h(
                'td',
                null,
                new Date(entry.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
              ),
            ),
          ),
        ),
      ),
    ),
    !events.length &&
      h(
        'div',
        { className: 'empty-state' },
        search ? 'No activity matches your search.' : 'No access changes recorded.',
      ),
  );
}
