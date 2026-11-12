import React, { useState } from 'react';
import { AdminDialog } from './dialog.js';
import { EmployeeSelect } from './employee-select.js';
import { accountCommand } from '../access/security.js';
import { accountAccessError } from '../access/identity.js';
import { getAccessClient } from '../access/client.js';
import { RecordGrid } from '../fabric/record-grid.js';
import { GridSearch, GridSort, useGridSearch } from '../fabric/grid-toolbar.js';

const h = React.createElement;
const fields = [
  ['employee', 'Employee'],
  ['email', 'Email'],
  ['roles', 'Roles'],
  ['access', 'Access'],
  ['invitation', 'Invitation'],
  ['mfa', 'MFA'],
];
const title = {
  invite: 'Invite employee',
  link: 'Link existing account',
  resend: 'Resend invitation',
  edit: 'Edit roles',
  disable: 'Disable access',
  restore: 'Restore access',
  retry: 'Retry provisioning',
  cancel: 'Cancel invitation',
  correct: 'Correct email',
  details: 'View details',
};

function userRows(snapshot) {
  return snapshot.employees.map((employee) => {
    const account = snapshot.accounts.find((a) => String(a.employee_id) === String(employee.id));
    const auth = (snapshot.auth_accounts ?? []).find((a) => a.id === account?.user_id);
    const pending = snapshot.pending_invitations?.find(
      (a) => String(a.employee_id) === String(employee.id),
    );
    const roleIds = (account?.role_ids || pending?.role_ids || []).map(String);
    return {
      id: String(employee.id),
      active: employee.is_active,
      code: employee.employee_code,
      employee: employee.name || 'Name not set',
      email: auth?.email || pending?.email || '',
      roleIds,
      roles: snapshot.roles
        .filter((r) => roleIds.includes(String(r.id)))
        .map((r) => r.name)
        .join(', '),
      access: account ? (account.is_active ? 'Enabled' : 'Disabled') : 'No access',
      invitation: pending
        ? 'Needs attention'
        : auth?.invitation_pending
          ? 'Awaiting acceptance'
          : auth?.setup_pending
            ? 'Password setup pending'
            : account
              ? 'Complete'
              : '—',
      mfa: auth?.mfa_enrolled ? 'Enrolled' : account ? 'Not enrolled' : '—',
      account,
      pending,
      auth,
    };
  });
}

export function AccountLifecycle({ snapshot, onSaved }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ key: 'employee', direction: 'asc' });
  const [operation, setOperation] = useState(null);
  const [message, setMessage] = useState('');
  const query = useGridSearch(search).trim().toLowerCase();
  const rows = userRows(snapshot);
  const shown = rows
    .filter(
      (r) =>
        (!filter ||
          (filter === 'Needs attention' ? r.invitation === filter : r.access === filter)) &&
        [r.employee, r.code, r.email, r.roles].some((value) =>
          value?.toLowerCase().includes(query),
        ),
    )
    .sort(
      (a, b) =>
        (sort.direction === 'asc' ? 1 : -1) *
        (a[sort.key].localeCompare(b[sort.key], undefined, { numeric: true }) ||
          a.id.localeCompare(b.id)),
    );
  const available = rows.filter((r) => r.active && !r.account && !r.pending);
  const unlinked = (snapshot.auth_accounts ?? []).filter(
    (a) =>
      a.email &&
      !snapshot.accounts.some((link) => link.user_id === a.id) &&
      !snapshot.pending_invitations?.some((pending) => pending.email === a.email),
  );
  function open(action, row) {
    setMessage('');
    setOperation({ action, row });
  }
  return h(
    'section',
    { className: 'admin-user-access', 'aria-label': 'User Access' },
    h('h2', null, 'User Access'),
    h(
      'div',
      { className: 'fabric-actions worksheet-actions admin-toolbar' },
      h(GridSearch, { label: 'Search users', value: search, onChange: setSearch }),
      h(
        'select',
        {
          'aria-label': 'Filter access',
          value: filter,
          onChange: (e) => setFilter(e.target.value),
        },
        ['', 'Enabled', 'Disabled', 'No access', 'Needs attention'].map((value) =>
          h('option', { key: value, value }, value || 'All access statuses'),
        ),
      ),
      h(
        'button',
        { className: 'primary', disabled: !available.length, onClick: () => open('invite') },
        'Invite employee',
      ),
      unlinked.length > 0 &&
        h('button', { disabled: !available.length, onClick: () => open('link') }, title.link),
    ),
    message && h('p', { role: 'status' }, message),
    h(GridSort, {
      columns: fields.map(([key, label]) => ({ key, label })),
      sort,
      onSort: setSort,
      rowCount: shown.length,
    }),
    h(
      RecordGrid,
      { client: getAccessClient(), grid: 'administration-accounts', fields },
      h(
        'tbody',
        null,
        shown.map((row) => {
          const action =
            row.pending && row.active
              ? 'retry'
              : row.auth?.invitation_pending && row.account?.is_active
                ? 'resend'
                : !row.account && row.active && !row.pending
                  ? 'invite'
                  : null;
          return h(
            'tr',
            { key: row.id },
            h('td', null, h('strong', null, row.employee), row.code && h('small', null, row.code)),
            h('td', null, row.email || '—'),
            h('td', null, row.roles || '—'),
            h(
              'td',
              null,
              h(
                'span',
                { className: 'lab-status' + (row.access === 'Enabled' ? ' accepted' : '') },
                row.access,
              ),
            ),
            h('td', null, row.invitation),
            h('td', null, row.mfa),
            h(
              'td',
              { className: 'admin-row-actions' },
              action &&
                h(
                  'button',
                  { onClick: () => open(action, row) },
                  action === 'invite' ? 'Invite' : action === 'resend' ? 'Resend' : title[action],
                ),
              h('button', { onClick: () => open('details', row) }, title.details),
            ),
          );
        }),
      ),
    ),
    !shown.length &&
      h(
        'div',
        { className: 'empty-state' },
        rows.length ? 'No employees match these filters.' : 'No employees registered.',
      ),
    operation &&
      h(UserOperation, {
        key: operation.action,
        ...operation,
        available,
        unlinked,
        roles: snapshot.roles.filter((r) => r.is_active),
        onClose: () => setOperation(null),
        onAction: (action) => open(action, operation.row),
        onDone: async (message) => {
          setMessage(message);
          setOperation(null);
          await onSaved();
        },
        onRefresh: onSaved,
      }),
  );
}

function UserOperation({
  action,
  row,
  available,
  unlinked,
  roles,
  onClose,
  onAction,
  onDone,
  onRefresh,
}) {
  const [employee, setEmployee] = useState(row?.id || '');
  const [email, setEmail] = useState('');
  const [roleIds, setRoles] = useState(row?.roleIds || []);
  const [user, setUser] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = action === 'invite' || action === 'link';
  const showRoles = create || action === 'edit';
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (['invite', 'resend', 'retry', 'cancel', 'correct'].includes(action)) {
        const result = await accountCommand({
          action,
          employeeId: employee,
          ...(['invite', 'correct'].includes(action) && { email }),
          ...(action === 'invite' && { roleIds }),
          ...(row?.pending?.revision && { revision: row.pending.revision }),
        });
        await onDone(result.message);
      } else {
        const { error } = await getAccessClient().rpc('erp_save_account_access', {
          p_user_id: row?.account?.user_id || user,
          p_employee_id: employee,
          p_role_ids: roleIds,
          p_enabled: action === 'edit' ? row.account.is_active : action === 'restore',
          p_expected_version: row?.account?.version ?? null,
        });
        if (error) throw error;
        await onDone(
          {
            edit: 'Roles updated.',
            link: 'Account linked. Restore access when ready.',
            disable: 'Access disabled. Existing sessions were ended.',
            restore: 'Access restored.',
          }[action],
        );
      }
    } catch (e) {
      setError(
        action === 'invite'
          ? 'Invitation could not be completed. Close this dialog and check User Access for Retry provisioning. If the email belongs to an existing account, use Link existing account.'
          : accountAccessError(e),
      );
      if (['invite', 'retry', 'correct', 'cancel'].includes(action)) await onRefresh();
    } finally {
      setBusy(false);
    }
  }
  return h(
    AdminDialog,
    { title: title[action], onClose: () => !busy && onClose() },
    row && h('p', null, [row.employee, row.email].filter(Boolean).join(' · ')),
    action === 'details'
      ? h(
          React.Fragment,
          null,
          h(
            'dl',
            { className: 'fabric-line admin-details' },
            fields
              .slice(2)
              .map(([key, label]) =>
                h(React.Fragment, { key }, h('dt', null, label), h('dd', null, row[key] || '—')),
              ),
          ),
          h(
            'div',
            { className: 'editor-actions' },
            row.account && h('button', { onClick: () => onAction('edit') }, title.edit),
            row.account?.is_active &&
              h('button', { onClick: () => onAction('disable') }, title.disable),
            row.account &&
              !row.account.is_active &&
              row.active &&
              h('button', { onClick: () => onAction('restore') }, title.restore),
            row.pending &&
              row.active &&
              h('button', { onClick: () => onAction('retry') }, title.retry),
            row.pending &&
              row.active &&
              h('button', { onClick: () => onAction('correct') }, title.correct),
            row.pending && h('button', { onClick: () => onAction('cancel') }, title.cancel),
            row.auth?.invitation_pending &&
              row.account?.is_active &&
              h('button', { onClick: () => onAction('resend') }, title.resend),
            !row.account &&
              !row.pending &&
              row.active &&
              h(
                'button',
                { className: 'primary', onClick: () => onAction('invite') },
                title.invite,
              ),
          ),
        )
      : h(
          'form',
          { onSubmit: submit },
          error && h('p', { className: 'form-error', role: 'alert' }, error),
          h(
            'fieldset',
            { disabled: busy, className: 'admin-operation-fields' },
            (create || action === 'correct') &&
              h(
                'div',
                { className: 'fabric-fields' },
                !row &&
                  h(EmployeeSelect, {
                    inputId: 'create-employee-select',
                    value: employee,
                    onChange: setEmployee,
                    employees: available.map((e) => ({ id: e.id, name: e.employee, code: e.code })),
                  }),
                ['invite', 'correct'].includes(action) &&
                  h(
                    'label',
                    null,
                    'Employee login email',
                    h('input', {
                      type: 'email',
                      required: true,
                      autoComplete: 'off',
                      value: email,
                      onChange: (e) => setEmail(e.target.value),
                    }),
                  ),
                action === 'link' &&
                  h(
                    'label',
                    null,
                    'Login email',
                    h(
                      'select',
                      { required: true, value: user, onChange: (e) => setUser(e.target.value) },
                      h('option', { value: '' }, 'Choose an email'),
                      unlinked.map((a) => h('option', { key: a.id, value: a.id }, a.email)),
                    ),
                  ),
              ),
            showRoles &&
              h(
                'fieldset',
                { className: 'fabric-line admin-role-options' },
                h('legend', null, 'Roles'),
                roles.map((role) => {
                  const id = String(role.id);
                  return h(
                    'label',
                    { className: 'access-check', key: id },
                    h('input', {
                      type: 'checkbox',
                      checked: roleIds.includes(id),
                      onChange: (e) =>
                        setRoles(
                          e.target.checked
                            ? [...roleIds, id]
                            : roleIds.filter((value) => value !== id),
                        ),
                    }),
                    role.name,
                  );
                }),
              ),
            !showRoles &&
              h(
                'p',
                null,
                {
                  resend: 'Send a new invitation link to this email address.',
                  retry: 'Complete the original invitation using its saved email and roles.',
                  cancel: 'The existing invitation will no longer grant ERP access.',
                  correct: 'Cancel the original invitation and send a new one with the same roles.',
                  disable: 'End existing sessions and prevent ERP sign-in.',
                  restore: 'Allow this employee to sign in again with their existing credentials.',
                }[action],
              ),
          ),
          h(
            'div',
            { className: 'editor-actions' },
            h(
              'button',
              { type: 'button', disabled: busy, onClick: onClose },
              action === 'cancel' ? 'Go back' : 'Cancel',
            ),
            h(
              'button',
              {
                type: 'submit',
                className: 'primary',
                disabled: busy || !employee || (showRoles && !roleIds.length),
              },
              busy
                ? 'Working…'
                : {
                    invite: 'Send invitation',
                    edit: 'Save roles',
                    correct: 'Send corrected invitation',
                  }[action] || title[action],
            ),
          ),
        ),
  );
}
