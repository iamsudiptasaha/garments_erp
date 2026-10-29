import React, { useEffect, useRef, useState } from 'react';
import { allowed, saveEmployee } from '../admin/model.js';
const h = React.createElement;
function EmployeeEditor({ access, actor, employee, onSave, onClose }) {
  const dialog = useRef(null),
    revision = useRef(access.revision),
    [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    id: employee?.id,
    name: employee?.name || '',
    employeeCode: employee?.employeeCode || '',
    phone: employee?.phone || '',
  }));
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  function submit(e) {
    e.preventDefault();
    try {
      onSave(saveEmployee(access, actor, draft, revision.current));
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }
  return h(
    'dialog',
    { ref: dialog, className: 'fabric-dialog', onCancel: onClose },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, 'EMPLOYEE / HR'),
        h('h2', null, employee ? 'Edit employee' : 'Add employee'),
      ),
      h('button', { onClick: onClose }, 'Close'),
    ),
    h(
      'p',
      { className: 'editor-note' },
      'Manage employee details here. Roles and login access are controlled separately in Administration.',
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    h(
      'form',
      { onSubmit: submit },
      h(
        'div',
        { className: 'fabric-fields' },
        [
          ['name', 'Employee name'],
          ['employeeCode', 'Employee ID'],
          ['phone', 'Phone number'],
        ].map(([key, label]) =>
          h(
            'label',
            { key },
            h('span', null, label),
            h('input', {
              'aria-label': label,
              type: key === 'phone' ? 'tel' : 'text',
              value: draft[key],
              required: key !== 'phone' || !employee || !!employee.phone,
              onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })),
            }),
          ),
        ),
      ),
      !employee &&
        h(
          'p',
          { className: 'editor-note' },
          'A new profile starts without enabled login access. An administrator can assign its role and enable access.',
        ),
      h(
        'div',
        { className: 'editor-actions' },
        h('button', { type: 'button', onClick: onClose }, 'Cancel'),
        h('button', { className: 'primary', type: 'submit' }, 'Save employee'),
      ),
    ),
  );
}
export function HRPanel({ access, actor, onSave }) {
  const [editor, setEditor] = useState(null),
    [query, setQuery] = useState('');
  if (!allowed(access, actor, 'employees', 'view'))
    return h(
      'section',
      { className: 'access-denied' },
      h('h1', null, 'Access restricted'),
      h('p', null, 'Your role cannot open Employee / HR.'),
    );
  const users = access.users.filter((u) =>
    [u.name, u.employeeCode, u.phone].some((v) => v.toLowerCase().includes(query.toLowerCase())),
  );
  return h(
    React.Fragment,
    null,
    h(
      'header',
      { className: 'fabric-page-header' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, 'EMPLOYEE / HR'),
        h('h1', null, 'Employees'),
        h(
          'p',
          null,
          'Employee details in one place. Account permissions stay with Administration.',
        ),
      ),
    ),
    h(
      'div',
      { className: 'access-info' },
      'Local employee-directory preview · no real login is created or changed',
    ),
    h(
      'div',
      { className: 'fabric-actions' },
      h('input', {
        type: 'search',
        'aria-label': 'Search employees',
        placeholder: 'Search name, employee ID or phone…',
        value: query,
        onChange: (e) => setQuery(e.target.value),
      }),
      allowed(access, actor, 'employees', 'create') &&
        h(
          'button',
          { className: 'primary', onClick: () => setEditor({ employee: null }) },
          '+ Add employee',
        ),
    ),
    h(
      'div',
      { className: 'permission-scroll' },
      h(
        'table',
        { className: 'access-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ['Employee', 'Employee ID', 'Phone', ''].map((label) => h('th', { key: label }, label)),
          ),
        ),
        h(
          'tbody',
          null,
          users.map((u) =>
            h(
              'tr',
              { key: u.id },
              h('td', null, u.name),
              h('td', null, u.employeeCode),
              h('td', null, u.phone || 'Not linked · preview profile'),
              h(
                'td',
                null,
                allowed(access, actor, 'employees', 'edit') &&
                  h('button', { onClick: () => setEditor({ employee: u }) }, 'Edit employee'),
              ),
            ),
          ),
        ),
      ),
    ),
    editor &&
      h(EmployeeEditor, {
        access,
        actor,
        employee: editor.employee,
        onSave,
        onClose: () => setEditor(null),
      }),
  );
}
