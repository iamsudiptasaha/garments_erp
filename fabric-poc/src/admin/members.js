import React, { useEffect, useRef, useState } from 'react';
import { EmployeeSelect } from './employee-select.js';
const h = React.createElement;
export function employeeMatches(employee, query) {
  const text = query.trim().toLowerCase();
  return [employee.name, employee.code, employee.phone].some((v) =>
    String(v || '')
      .toLowerCase()
      .includes(text),
  );
}
export function RoleMembers({
  role,
  employees,
  onAdd,
  onRemove,
  onClose,
  removeLabel = 'Remove',
  note = '',
}) {
  const dialog = useRef(null),
    [query, setQuery] = useState(''),
    [selectedId, setSelectedId] = useState(null),
    [tab, setTab] = useState('members'),
    [pending, setPending] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const candidates = employees.filter((e) => !e.assigned);
  const visible =
    tab === 'members'
      ? employees.filter((e) => e.assigned && employeeMatches(e, query))
      : candidates.filter((e) => e.id === selectedId);
  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await (pending.assigned ? onRemove : onAdd)(pending);
      setPending(null);
      setSelectedId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog role-members',
      onCancel: (e) => {
        if (busy) e.preventDefault();
        else onClose();
      },
    },
    h(
      'div',
      { className: 'editor-heading' },
      h('div', null, h('small', null, 'ROLE MEMBERS'), h('h2', null, role.name)),
      h('button', { disabled: busy, onClick: onClose }, 'Close'),
    ),
    h(
      'p',
      { className: 'editor-note' },
      note ||
        'Add employees to this role or remove their membership. Login access is managed separately.',
    ),
    h(
      'div',
      { className: 'member-toolbar' },
      h(
        'div',
        { className: 'fabric-view-toggle' },
        [
          ['members', `Assigned (${employees.filter((e) => e.assigned).length})`],
          ['add', 'Add employees'],
        ].map(([key, label]) =>
          h(
            'button',
            {
              key,
              disabled: busy,
              'aria-pressed': tab === key,
              onClick: () => {
                setTab(key);
                setPending(null);
                setSelectedId(null);
                setQuery('');
              },
            },
            label,
          ),
        ),
      ),
      tab === 'members' &&
        h('input', {
          type: 'search',
          'aria-label': 'Search assigned employees',
          placeholder: 'Search assigned employees…',
          value: query,
          onChange: (e) => setQuery(e.target.value),
        }),
    ),
    tab === 'add' &&
      h(EmployeeSelect, {
        employees: candidates,
        value: selectedId,
        disabled: busy,
        label: 'Employee',
        onChange: (id) => {
          setSelectedId(id);
          setPending(null);
          setError('');
        },
      }),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    pending &&
      h(
        'section',
        { className: 'member-confirm', role: 'status' },
        h(
          'p',
          null,
          pending.assigned
            ? `${removeLabel}: ${pending.name} (${pending.code}) from ${role.name}?`
            : `Add ${pending.name} (${pending.code}) to ${role.name}?`,
        ),
        h(
          'div',
          null,
          h('button', { disabled: busy, onClick: () => setPending(null) }, 'Cancel'),
          h(
            'button',
            { className: 'primary', disabled: busy, onClick: confirm },
            busy ? 'Saving…' : 'Confirm change',
          ),
        ),
      ),
    (tab === 'members' || selectedId) &&
      h(
        'div',
        { className: 'member-list' },
        visible.length
          ? visible.map((e) =>
              h(
                'article',
                { key: e.id, className: 'member-row' },
                h(
                  'div',
                  { className: 'member-avatar', 'aria-hidden': true },
                  (e.name || 'E').slice(0, 1).toUpperCase(),
                ),
                h(
                  'div',
                  { className: 'member-identity' },
                  h('strong', null, e.name || 'Name not set'),
                  h('small', null, e.code || 'Employee code not set'),
                  h('span', null, e.roles || 'No role assigned'),
                ),
                h(
                  'span',
                  { className: e.enabled ? 'access-active' : 'access-paused' },
                  e.enabled ? 'Login enabled' : 'Login disabled',
                ),
                h(
                  'button',
                  {
                    disabled: busy || e.unlinked || (e.assigned && e.canRemove === false),
                    onClick: () => {
                      setError('');
                      setPending(e);
                    },
                  },
                  e.unlinked ? 'Link login first' : e.assigned ? removeLabel : 'Add to role',
                ),
              ),
            )
          : h(
              'div',
              { className: 'empty-state' },
              h(
                'h3',
                null,
                query
                  ? 'No matching employees'
                  : tab === 'members'
                    ? 'No employees assigned'
                    : 'Everyone is already assigned',
              ),
              h(
                'p',
                null,
                query
                  ? 'Try a name or employee-code fragment.'
                  : tab === 'members'
                    ? 'Use Add employees to choose people for this role.'
                    : 'Employee profiles are managed in Employee / HR.',
              ),
            ),
      ),
  );
}
