import React, { useState } from 'react';
import { EmployeeSelect } from './employee-select.js';
import { accountCommand } from '../access/security.js';
const h = React.createElement;
export function AccountLifecycle({ snapshot, onSaved }) {
  const [employee, setEmployee] = useState(null),
    [phone, setPhone] = useState(''),
    [roles, setRoles] = useState([]),
    [enabled, setEnabled] = useState(true),
    [target, setTarget] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function submit(input) {
    setBusy(true);
    setMessage('');
    try {
      const r = await accountCommand(input);
      setMessage(r.message);
      setPhone('');
      await onSaved();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    null,
    h('h2', null, 'Login setup and recovery'),
    message && h('p', { role: 'status' }, message),
    h(
      'details',
      null,
      h('summary', null, 'Create employee login'),
      h(
        'form',
        {
          onSubmit: (e) => {
            e.preventDefault();
            void submit({ action: 'create', employeeId: employee, phone, roleIds: roles, enabled });
          },
        },
        h(EmployeeSelect, {
          inputId: 'create-employee-select',
          employees: snapshot.employees
            .filter((e) => !snapshot.accounts.some((a) => a.employee_id === e.id))
            .map((e) => ({ ...e, code: e.employee_code })),
          value: employee,
          onChange: setEmployee,
          disabled: busy,
        }),
        h(
          'label',
          null,
          'Mobile number',
          h('input', {
            type: 'tel',
            required: true,
            maxLength: 10,
            value: phone,
            onChange: (e) => setPhone(e.target.value),
          }),
        ),
        h(
          'fieldset',
          null,
          h('legend', null, 'Roles'),
          snapshot.roles
            .filter((r) => r.is_active)
            .map((r) =>
              h(
                'label',
                { key: r.id, className: 'access-check' },
                h('input', {
                  type: 'checkbox',
                  checked: roles.includes(r.id),
                  onChange: (e) =>
                    setRoles((old) =>
                      e.target.checked ? [...old, r.id] : old.filter((id) => id !== r.id),
                    ),
                }),
                r.name,
              ),
            ),
        ),
        h(
          'label',
          { className: 'access-check' },
          h('input', {
            type: 'checkbox',
            checked: enabled,
            onChange: (e) => setEnabled(e.target.checked),
          }),
          'Account enabled',
        ),
        h(
          'button',
          { type: 'submit', disabled: busy || !employee || !roles.length },
          'Create login',
        ),
      ),
    ),
    h(
      'details',
      null,
      h('summary', null, 'Send password setup / recovery code'),
      h(
        'p',
        null,
        'The code goes only to the Administrator email. Give it to the selected employee after verifying their identity. It expires in 15 minutes and does not reset their authenticator.',
      ),
      h(EmployeeSelect, {
        inputId: 'recovery-employee-select',
        label: 'Employee account for recovery',
        employees: snapshot.accounts
          .filter((a) => a.is_active)
          .map((a) => ({ ...a, id: a.user_id, code: a.employee_code })),
        value: target,
        onChange: setTarget,
        disabled: busy,
      }),
      h(
        'button',
        {
          disabled: busy || !target,
          onClick: () => submit({ action: 'issueRecovery', userId: target }),
        },
        'Send code to Administrator',
      ),
    ),
  );
}
