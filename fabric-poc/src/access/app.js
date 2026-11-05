import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getAccessClient, getLoginMethods } from './client.js';
import { AccessNavigation } from './navigation.js';
import { Authenticator, RecoveryForm, PasswordSettings } from './security.js';
import { AccountLifecycle } from '../admin/account-lifecycle.js';
import {
  assertAccountLinkAvailable,
  accountAccessError,
  normalisePhone,
  normaliseEmployeeCode,
} from './identity.js';
import '../fabric/styles.css';
import '../admin/styles.css';
import './styles.css';
import { RoleMembers, employeeMatches } from '../admin/members.js';
const h = React.createElement;
const flags = ['view', 'create', 'edit', 'format', 'export', 'print'];
let client = null,
  configurationError = '';
try {
  client = getAccessClient();
} catch (e) {
  configurationError = e.message;
}
async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
function AccessApp() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [access, setAccess] = useState(null),
    [security, setSecurity] = useState(null),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [phone, setPhone] = useState(''),
    [emailLogin, setEmailLogin] = useState(true),
    [phoneEnabled, setPhoneEnabled] = useState(false),
    [password, setPassword] = useState(''),
    [tab, setTab] = useState(
      () =>
        ({ adminRoles: 'roles', adminAccess: 'accounts', adminAudit: 'audit' })[
          location.hash.slice(1)
        ] || 'roles',
    ),
    [menuOpen, setMenuOpen] = useState(true);
  useEffect(() => {
    if (!client) {
      setReady(true);
      return;
    }
    let active = true;
    getLoginMethods()
      .then((methods) => {
        if (active) setPhoneEnabled(methods.phone);
      })
      .catch(() => {});
    client.auth.getSession().then(({ data, error }) => {
      if (active) {
        setUser(data.session?.user || null);
        setReady(true);
        if (error) setError(error.message);
      }
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      setAccess(null);
      setSnapshot(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  async function refresh() {
    setError('');
    setBusy(true);
    try {
      const checked = await rpc('erp_account_security');
      setSecurity(checked);
      if (checked?.enabled && !checked.ready) {
        setAccess(null);
        setSnapshot(null);
        return;
      }
      const own = await rpc('erp_access_snapshot');
      setAccess(own);
      setSnapshot(own.administrator ? await rpc('erp_admin_snapshot') : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user) void refresh();
  }, [user]);
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error } = await client.auth.signInWithPassword({
        ...(emailLogin ? { email: phone.trim() } : { phone: normalisePhone(phone) }),
        password,
      });
      if (error) throw error;
      setPassword('');
      const checked = await rpc('erp_account_security');
      setSecurity(checked);
      if (checked?.ready) location.assign('/fabric.html?live=1');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setError('');
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
  const signedIn = !!user && access?.enabled;
  return h(
    'div',
    {
      className: signedIn ? `access-workspace${menuOpen ? '' : ' access-menu-closed'}` : undefined,
    },
    signedIn &&
      h(AccessNavigation, {
        accountName: user?.email,
        onSignOut: signOut,
        access,
        tab,
        onTab: setTab,
        open: menuOpen,
        onClose: () => setMenuOpen(false),
      }),
    h(
      'main',
      { className: 'access-live-shell' },
      signedIn &&
        h(
          'div',
          { className: 'workspace-toolbar' },
          h(
            'button',
            {
              'aria-controls': 'live-workspace-sidebar',
              'aria-expanded': menuOpen,
              onClick: () => setMenuOpen((v) => !v),
            },
            menuOpen ? '‹ Hide menu' : '› Show menu',
          ),
        ),
      h(
        'header',
        { className: 'access-live-header' },
        h(
          'div',
          null,
          h('p', { className: 'eyebrow' }, 'GARMENT WORKSPACE'),
          h('h1', null, user ? 'User management' : 'Sign in'),
        ),
        user &&
          h(
            'div',
            null,
            h('button', { disabled: busy, onClick: refresh }, 'Refresh access'),
            !signedIn && h('button', { onClick: signOut }, 'Sign out'),
          ),
      ),
      error && h('p', { className: 'form-error', role: 'alert' }, error),
      signedIn && h(PasswordSettings),
      !ready
        ? h('p', null, 'Loading session…')
        : !user
          ? h(
              'section',
              { className: 'access-login' },
              h(
                'p',
                null,
                emailLogin
                  ? 'Use your email and password.'
                  : 'Use your 10-digit mobile number and password.',
              ),
              h(
                'form',
                { onSubmit: signIn },
                h(
                  'label',
                  null,
                  emailLogin ? 'Email' : 'Mobile number',
                  h('input', {
                    type: emailLogin ? 'email' : 'tel',
                    autoComplete: emailLogin ? 'username' : 'tel-national',
                    inputMode: emailLogin ? 'email' : 'numeric',
                    maxLength: emailLogin ? undefined : 10,
                    placeholder: emailLogin ? 'you@example.com' : '10-digit mobile number',
                    value: phone,
                    onChange: (e) => setPhone(e.target.value),
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
              phoneEnabled &&
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'login-method-switch',
                    onClick: () => {
                      setEmailLogin((v) => !v);
                      setPhone('');
                      setError('');
                    },
                  },
                  emailLogin ? 'Use phone login' : 'Use email login',
                ),
              h(RecoveryForm),
              h(
                'p',
                { className: 'editor-note' },
                'An Administrator must create and enable your account before you can access the portal.',
              ),
            )
          : security?.enabled && !security.ready
            ? security.mustChangePassword
              ? h(
                  'section',
                  null,
                  h('h2', null, 'Set your password'),
                  h(
                    'p',
                    null,
                    'Ask your Administrator to send a setup code, sign out, and use Forgot password.',
                  ),
                  h('button', { onClick: signOut }, 'Sign out'),
                )
              : h(Authenticator, {
                  onVerified: async () => {
                    await refresh();
                    location.assign('/fabric.html?live=1');
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
                : !access.administrator
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
                  : snapshot &&
                    h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { className: 'access-info' },
                        'Live Supabase account management · changes save to the database',
                      ),
                      h(
                        'div',
                        { className: 'fabric-view-toggle' },
                        [
                          ['roles', 'Roles & permissions'],
                          ['accounts', 'Account access'],
                          ['audit', 'Activity log'],
                        ].map(([key, label]) =>
                          h(
                            'button',
                            { key, 'aria-pressed': tab === key, onClick: () => setTab(key) },
                            label,
                          ),
                        ),
                      ),
                      tab === 'roles'
                        ? h(RoleManager, { snapshot, onSaved: refresh })
                        : tab === 'accounts'
                          ? h(
                              React.Fragment,
                              null,
                              h(AccountLifecycle, { snapshot, onSaved: refresh }),
                              h(AccountManager, { snapshot, onSaved: refresh }),
                            )
                          : h(
                              'section',
                              { className: 'audit-list' },
                              snapshot.audit.length
                                ? snapshot.audit.map((a) =>
                                    h(
                                      'article',
                                      { key: a.id },
                                      h(
                                        'div',
                                        null,
                                        h('strong', null, a.action),
                                        h('p', null, `${a.target_type} · ${a.target_id || ''}`),
                                      ),
                                      h(
                                        'time',
                                        null,
                                        new Date(a.created_at).toLocaleString('en-IN', {
                                          timeZone: 'Asia/Kolkata',
                                        }),
                                      ),
                                    ),
                                  )
                                : h('p', null, 'No access changes recorded.'),
                            ),
                    ),
    ),
  );
}
function RoleManager({ snapshot, onSaved }) {
  const [editing, setEditing] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [memberRole, setMemberRole] = useState(null),
    [showArchived, setShowArchived] = useState(false),
    [archiveTarget, setArchiveTarget] = useState(null);
  function edit(role) {
    const permissions = {};
    for (const p of snapshot.permissions.filter((p) => p.app_role_id === role?.id)) {
      const key = snapshot.resources.find((r) => r.id === p.app_resource_id)?.key;
      if (key) permissions[key] = Object.fromEntries(flags.map((a) => [a, p['can_' + a]]));
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
    h(
      'label',
      { className: 'access-check' },
      h('input', {
        type: 'checkbox',
        checked: showArchived,
        onChange: (e) => setShowArchived(e.target.checked),
      }),
      'Show archived roles',
    ),
    archiveTarget &&
      h(
        'section',
        { className: 'member-confirm' },
        h('p', null, `Archive ${archiveTarget.name}? History will be retained.`),
        h('button', { disabled: busy, onClick: () => setArchiveTarget(null) }, 'Cancel'),
        h('button', { disabled: busy, className: 'primary', onClick: archive }, 'Confirm archive'),
      ),
    h(
      'div',
      { className: 'fabric-actions' },
      h('h2', null, 'Roles'),
      h('button', { className: 'primary', onClick: () => edit(null) }, '+ Create role'),
    ),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    editing
      ? h(
          'form',
          { onSubmit: save },
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
          h(
            'div',
            { className: 'permission-scroll' },
            h(
              'table',
              { className: 'permission-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, 'Screen'),
                  flags.map((a) => h('th', { key: a }, a)),
                ),
              ),
              h(
                'tbody',
                null,
                snapshot.resources
                  .filter((r) => r.resource_type === 'screen' && !r.admin_only)
                  .map((r) =>
                    h(
                      'tr',
                      { key: r.id },
                      h('th', null, r.name),
                      flags.map((a) =>
                        h(
                          'td',
                          { key: a },
                          h('input', {
                            type: 'checkbox',
                            'aria-label': `${r.name}: ${a}`,
                            disabled: a !== 'view' && !editing.permissions[r.key]?.view,
                            checked: !!editing.permissions[r.key]?.[a],
                            onChange: (e) => {
                              const checked = e.target.checked;
                              setEditing((d) => ({
                                ...d,
                                permissions: {
                                  ...d.permissions,
                                  [r.key]:
                                    a === 'view' && !checked
                                      ? {}
                                      : { ...d.permissions[r.key], [a]: checked },
                                },
                              }));
                            },
                          }),
                        ),
                      ),
                    ),
                  ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { type: 'button', onClick: () => setEditing(null) }, 'Cancel'),
            h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Save role'),
          ),
        )
      : h(
          'div',
          { className: 'overview-grid' },
          snapshot.roles
            .filter((r) => showArchived || r.is_active)
            .map((r, i) =>
              h(
                'article',
                { className: `overview-card tone-${i % 4}`, key: r.id },
                h('h2', null, r.name),
                h('p', null, r.description),
                !r.is_active
                  ? h('small', null, 'Archived · history retained')
                  : h(
                      React.Fragment,
                      null,
                      h(
                        'button',
                        { className: 'manage-members', onClick: () => setMemberRole(r) },
                        'Manage employees →',
                      ),
                      r.is_system_admin
                        ? h('small', null, 'Protected Administrator role')
                        : h(
                            React.Fragment,
                            null,
                            h('button', { onClick: () => edit(r) }, 'Edit permissions'),
                            h(
                              'button',
                              {
                                disabled: snapshot.accounts.some((a) => a.role_ids.includes(r.id)),
                                title: 'Reassign all employees before archiving',
                                onClick: () => setArchiveTarget(r),
                              },
                              'Archive role',
                            ),
                          ),
                    ),
              ),
            ),
        ),
  );
}
function AccountManager({ snapshot, onSaved }) {
  const [editing, setEditing] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      assertAccountLinkAvailable(snapshot.accounts, editing);
      await rpc('erp_save_account_access', {
        p_user_id: editing.user_id,
        p_employee_id: editing.employee_id,
        p_role_ids: editing.role_ids,
        p_enabled: editing.is_active,
        p_expected_version: editing.version ?? null,
      });
      setEditing(null);
      await onSaved();
    } catch (e) {
      setError(accountAccessError(e));
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    null,
    h(
      'div',
      { className: 'fabric-actions' },
      h('h2', null, 'Employee account access'),
      h('input', {
        type: 'search',
        'aria-label': 'Find employee access',
        placeholder: 'Search employee name or code…',
        value: query,
        onChange: (e) => setQuery(e.target.value),
      }),
      h(
        'button',
        {
          className: 'primary',
          onClick: () => {
            setError('');
            setEditing({ user_id: '', employee_id: '', role_ids: [], is_active: false });
          },
        },
        '+ Link employee account',
      ),
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    editing
      ? h(
          'form',
          { onSubmit: save },
          h(
            'div',
            { className: 'fabric-fields' },
            h(
              'label',
              null,
              'Login account',
              h(
                'select',
                {
                  required: true,
                  disabled: !!editing.version,
                  value: editing.user_id,
                  onChange: (e) => setEditing((d) => ({ ...d, user_id: e.target.value })),
                },
                h('option', { value: '' }, 'Choose…'),
                snapshot.auth_accounts
                  .filter(
                    (a) =>
                      a.id === editing.user_id ||
                      !snapshot.accounts.some((link) => link.user_id === a.id),
                  )
                  .map((a) => h('option', { key: a.id, value: a.id }, a.phone || a.email || a.id)),
              ),
            ),
            h(
              'label',
              null,
              'Employee',
              h(
                'select',
                {
                  required: true,
                  disabled: !!editing.version,
                  value: editing.employee_id,
                  onChange: (e) => setEditing((d) => ({ ...d, employee_id: e.target.value })),
                },
                h('option', { value: '' }, 'Choose…'),
                snapshot.employees
                  .filter(
                    (e) =>
                      e.id === editing.employee_id ||
                      !snapshot.accounts.some((link) => link.employee_id === e.id),
                  )
                  .map((e) =>
                    h(
                      'option',
                      { key: e.id, value: e.id },
                      `${e.name || 'Name not set'} · ${normaliseEmployeeCode(e.employee_code)}`,
                    ),
                  ),
              ),
            ),
            h(
              'label',
              null,
              'Roles',
              h(
                'select',
                {
                  multiple: true,
                  required: true,
                  value: editing.role_ids.map(String),
                  onChange: (e) =>
                    setEditing((d) => ({
                      ...d,
                      role_ids: [...e.target.selectedOptions].map((o) => o.value),
                    })),
                },
                snapshot.roles
                  .filter((r) => r.is_active)
                  .map((r) => h('option', { key: r.id, value: r.id }, r.name)),
              ),
            ),
            h(
              'label',
              { className: 'access-check' },
              h('input', {
                type: 'checkbox',
                checked: editing.is_active,
                onChange: (e) => setEditing((d) => ({ ...d, is_active: e.target.checked })),
              }),
              'Account enabled',
            ),
          ),
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { type: 'button', onClick: () => setEditing(null) }, 'Cancel'),
            h(
              'button',
              { type: 'submit', className: 'primary', disabled: busy },
              'Save account access',
            ),
          ),
        )
      : h(
          'table',
          { className: 'access-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ['Employee', 'Code', 'Roles', 'Access', ''].map((t) => h('th', { key: t }, t)),
            ),
          ),
          h(
            'tbody',
            null,
            snapshot.accounts
              .filter(
                (a) =>
                  !query.trim() || employeeMatches({ name: a.name, code: a.employee_code }, query),
              )
              .map((a) =>
                h(
                  'tr',
                  { key: a.user_id },
                  h('td', null, a.name || 'Employee'),
                  h('td', null, a.employee_code),
                  h(
                    'td',
                    null,
                    a.role_ids
                      .map((id) => snapshot.roles.find((r) => r.id === id)?.name)
                      .filter(Boolean)
                      .join(', '),
                  ),
                  h('td', null, a.is_active ? 'Enabled' : 'Disabled'),
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        onClick: () => {
                          setError('');
                          setEditing({ ...a });
                        },
                      },
                      'Edit access',
                    ),
                  ),
                ),
              ),
          ),
        ),
  );
}
createRoot(document.getElementById('access-root')).render(h(AccessApp));
