import { EmployeeAvatar } from './avatar.js';
import { getAccessClient } from '../access/client.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { allowed, isAdministrator } from '../admin/model.js';
import { followWorkspaceLink } from '../access/workspace-routes.js';
import { OverviewTable } from '../fabric/overview-table.js';
import { RecordPageHeading } from '../fabric/record-page.js';
import { WorkspaceViewToggle } from '../fabric/view-toggle.js';
import { FabricSheet } from '../fabric/sheet.js';
import { employeeCommands } from './live.js';
import { EmployeeEditor } from './editor.js';
import { employeeRows, employeeDraft, employeeStatus, hrPages } from './model.js';
import './styles.css';
const h = React.createElement;
const spec = {
  title: 'Employees',
  columns: [
    ['name', 'Employee'],
    ['code', 'Employee code'],
    ['phone', 'Phone'],
    ['joined', 'Joined'],
    ['status', 'Status'],
    ['verified', 'Verified by'],
    ['updated', 'Updated at'],
  ].map(([key, label]) => ({ key, label, width: 200 })),
};
function preview(access, contactChoices, contactItems) {
  try {
    const saved = JSON.parse(localStorage.getItem('garments-hr-preview-v2'));
    if (saved?.records) return { ...saved, contact_choices: contactChoices };
  } catch {
    /* Preview works without persistence. */
  }
  return {
    records: access.users.map((u) => ({
      employee: {
        id: u.id,
        employee_code: u.employeeCode,
        is_active: true,
        is_verified: true,
        contacts_id: contactChoices.find((c) => c.company_name === u.name)?.id || '',
      },
      contact: { company_name: u.name },
      contacts: u.phone ? [{ name: u.name, phone: u.phone, address: '' }] : [],
    })),
    contact_choices: contactChoices,
    contact_people: contactItems,
    verifiers: [],
    gender: [],
    blood_group: [],
    type_of_employment: [],
    contact_purpose: [{ id: 'employee', type: 'Employee' }],
  };
}
export function HRPanel({
  access,
  actor,
  live,
  page = 'employees',
  contactChoices = [],
  contactItems = [],
  onContacts,
}) {
  const { table: tab, title } = hrPages[page];
  const [snapshot, setSnapshot] = useState(() =>
      live ? null : preview(access, contactChoices, contactItems),
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [editor, setEditor] = useState(null),
    [statusFilter, setStatusFilter] = useState('current'),
    [query, setQuery] = useState(''),
    [view, setView] = useState('overview'),
    [reference, setReference] = useState(''),
    [referenceId, setReferenceId] = useState(null),
    [busy, setBusy] = useState(false),
    [selection, setSelection] = useState(null);
  const referenceInput = useRef(null);
  const commands = useMemo(() => (live ? employeeCommands() : null), [!!live]);
  const can = (action) => allowed(access, actor, 'employees', action);
  async function reload() {
    try {
      setError('');
      const next = await commands.load();
      setSnapshot(next);
      setEditor((current) =>
        current?.record
          ? {
              record:
                next.records.find((r) => r.employee.id === current.record.employee.id) ||
                current.record,
            }
          : current,
      );
      return next;
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (commands && can('view')) void reload();
  }, [commands, actor]);
  function updated(next) {
    setSnapshot(next);
    if (!live) {
      try {
        localStorage.setItem('garments-hr-preview-v2', JSON.stringify(next));
      } catch {
        setNotice('Preview saved in this tab only.');
      }
    }
  }
  const operator = live
    ? snapshot?.verifiers?.[0]?.name || 'Logged-in operator'
    : access.users.find((u) => u.id === actor)?.name || 'Preview operator';
  async function save(payload) {
    let receipt;
    if (live) {
      const { _saved_id, ...next } = await commands.save(payload);
      receipt = _saved_id ?? payload.id;
      updated(next);
    } else {
      const old = snapshot.records.find((r) => r.employee.id === payload.id);
      const row = {
        ...old,
        employee: {
          ...old?.employee,
          ...payload.draft.employee,
          id: payload.id || crypto.randomUUID(),
          employee_code: old?.employee.employee_code || 'Preview · assigned on live save',
          updated_at: new Date().toISOString(),
          verified_by_employee_id: live ? null : actor,
          is_verified: true,
          is_active: old?.employee.is_active ?? true,
          activated_by_employee_id: old?.employee.activated_by_employee_id || actor,
        },
        verifier_name: operator,
        contact: snapshot.contact_choices.find((c) => c.id === payload.draft.employee.contacts_id),
        contacts: (snapshot.contact_people || []).filter(
          (c) => c.contact_id === payload.draft.employee.contacts_id,
        ),
        emergency:
          snapshot.contact_choices.find(
            (c) => c.id === payload.draft.employee.contacts_emergency_id,
          ) || null,
      };
      updated({
        ...snapshot,
        records: old
          ? snapshot.records.map((r) => (r === old ? row : r))
          : [...snapshot.records, row],
      });
    }
    setNotice(live ? 'Employee saved.' : 'Employee saved in this browser preview only.');
    return receipt;
  }
  async function saveStatus(record, active, revision) {
    setBusy(true);
    setError('');
    try {
      if (live) {
        await commands.setActive(record.employee.id, active, revision);
        const next = await reload();
        if (!next) throw Error('Status saved. Reload or sign in again to refresh employee access.');
      } else {
        updated({
          ...snapshot,
          records: snapshot.records.map((r) =>
            r === record
              ? {
                  ...r,
                  verifier_name: operator,
                  employee: {
                    ...r.employee,
                    is_active: active,
                    is_verified: true,
                    verified_by_employee_id: actor,
                    activated_by_employee_id: actor,
                    updated_at: new Date().toISOString(),
                  },
                }
              : r,
          ),
        });
      }
      setEditor(null);
      setNotice(
        active ? 'Employee activated.' : 'Employee deactivated. Portal access is disabled.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveReference(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (live)
        updated(
          await commands.reference(
            tab,
            referenceId,
            reference,
            snapshot[tab].find((r) => r.id === referenceId)?.updated_at,
          ),
        );
      else
        updated({
          ...snapshot,
          [tab]: referenceId
            ? snapshot[tab].map((r) => (r.id === referenceId ? { ...r, name: reference } : r))
            : [...snapshot[tab], { id: crypto.randomUUID(), name: reference }],
        });
      setReference('');
      setReferenceId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!can('view'))
    return h(
      'section',
      { className: 'access-denied' },
      h('h1', null, 'Access restricted'),
      h('p', null, 'Your role cannot open Employee / HR.'),
    );
  const rows = employeeRows(
    (snapshot?.records || []).filter((row) =>
      statusFilter === 'current'
        ? employeeStatus(row) !== 'Archived'
        : employeeStatus(row).toLowerCase() === statusFilter,
    ),
    view === 'sheet' ? query : '',
  );
  async function removeEmployee(record) {
    await commands.archive(record.employee.id, record.revision);
    setEditor(null);
    setSelection(null);
    setNotice('Employee removed and archived.');
    await reload();
  }
  const overview = tab === 'employees' && view === 'overview';
  const addEmployee =
    statusFilter !== 'archived' && can('create')
      ? h(
          'button',
          { className: 'primary', onClick: () => setEditor({ record: null }) },
          '+ Add employee',
        )
      : null;
  const recordScope =
    live &&
    h(
      'label',
      null,
      'Employee records ',
      h(
        'select',
        {
          value: statusFilter,
          onChange: (event) => {
            setStatusFilter(event.target.value);
            setSelection(null);
          },
        },
        h('option', { value: 'current' }, 'Current'),
        h('option', { value: 'active' }, 'Active'),
        h('option', { value: 'inactive' }, 'Inactive'),
        h('option', { value: 'archived' }, 'Archived'),
      ),
    );
  return h(
    'section',
    { className: 'hr-workspace' },
    h(RecordPageHeading, {
      eyebrow: 'EMPLOYEE / HR',
      title,
      description:
        'Employee profiles, contacts and documents. Login access stays in Administration.',
      view,
      onView: overview && snapshot ? setView : undefined,
      action: overview && snapshot ? addEmployee : undefined,
    }),
    !live &&
      h(
        'p',
        { className: 'access-info' },
        'Local preview · no real employee, password or login is changed',
      ),
    error &&
      h(
        'div',
        { role: 'alert', className: 'form-error' },
        error,
        live && h('button', { onClick: reload }, 'Reload employees'),
      ),
    notice && h('p', { role: 'status' }, notice),
    !snapshot
      ? h('p', { role: 'status' }, 'Loading employees…')
      : tab !== 'employees'
        ? h(
            React.Fragment,
            null,
            (can('create') || can('edit')) &&
              h(
                'form',
                { className: 'fabric-actions', onSubmit: saveReference },
                h(
                  'label',
                  null,
                  referenceId ? 'Edit value' : 'New value',
                  h('input', {
                    ref: referenceInput,
                    value: reference,
                    required: true,
                    maxLength: 100,
                    onChange: (e) => setReference(e.target.value),
                  }),
                ),
                h(
                  'button',
                  {
                    className: 'primary',
                    disabled: busy || !(referenceId ? can('edit') : can('create')),
                  },
                  referenceId ? 'Save value' : 'Add value',
                ),
              ),
            h(OverviewTable, {
              key: actor + ':' + page,
              client: live ? getAccessClient() : null,
              grid: 'overview-' + page,
              title,
              records: snapshot[tab],
              opensDialog: false,
              columns: [
                { accessorKey: 'name', header: 'Name' },
                { accessorKey: 'updated_at', header: 'Updated at' },
              ],
              onOpen:
                can('edit') && !busy
                  ? (id) => {
                      const row = snapshot[tab].find((record) => record.id === id);
                      if (row) {
                        setReferenceId(row.id);
                        setReference(row.name);
                        referenceInput.current?.focus();
                      }
                    }
                  : undefined,
            }),
          )
        : h(
            React.Fragment,
            null,
            view === 'sheet'
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'fabric-actions' },
                    h('input', {
                      type: 'search',
                      'aria-label': 'Search employees',
                      placeholder: 'Search name, code or phone…',
                      value: query,
                      onChange: (e) => setQuery(e.target.value),
                    }),
                    h(WorkspaceViewToggle, { view, onChange: setView }),
                    recordScope,
                    addEmployee,
                    h(
                      'button',
                      {
                        disabled: !selection,
                        onClick: () => {
                          const r = rows.find((r) => r.id === selection);
                          if (r) setEditor({ record: r.record });
                        },
                      },
                      'Open selected employee',
                    ),
                  ),
                  h(FabricSheet, {
                    page: 'employees',
                    spec,
                    records: rows,
                    client: live ? getAccessClient() : null,
                    capabilities: { format: false, export: can('export'), print: can('print') },
                    onSelect: (row) => setSelection(row?.id || null),
                    onNotice: setNotice,
                  }),
                  !rows.length && h('p', null, 'No matching employees.'),
                )
              : h(OverviewTable, {
                  key: actor,
                  client: live ? getAccessClient() : null,
                  grid: 'overview-employees',
                  title: 'Employees',
                  records: rows,
                  toolbar: recordScope,
                  columns: [
                    { accessorKey: 'code', header: 'Employee code' },
                    {
                      accessorKey: 'name',
                      header: 'Employee',
                      cell: ({ getValue, row }) =>
                        h(
                          'span',
                          { className: 'hr-overview-name' },
                          h(EmployeeAvatar, {
                            className: 'hr-overview-avatar',
                            photoId: live ? row.original.record.employee.employee_photo : null,
                            name: getValue(),
                          }),
                          onContacts && row.original.record.employee.contacts_id
                            ? h(
                                'a',
                                {
                                  href:
                                    '/fabric.html' + (live ? '?live=1' : '') + '#materialContacts',
                                  onClick: (event) => followWorkspaceLink(event, onContacts),
                                },
                                getValue(),
                              )
                            : getValue(),
                        ),
                    },
                    { accessorKey: 'phone', header: 'Phone' },
                    {
                      accessorKey: 'status',
                      header: 'Status',
                      cell: ({ getValue }) =>
                        h(
                          'span',
                          {
                            className: 'erp-overview-status hr-overview-status',
                            'data-status': getValue(),
                          },
                          getValue(),
                        ),
                    },
                    { accessorKey: 'verified', header: 'Verified by' },
                  ],
                  onOpen: busy
                    ? undefined
                    : (id) => {
                        const row = rows.find((record) => record.id === id);
                        if (row) setEditor({ record: row.record });
                      },
                }),
            editor &&
              h(EmployeeEditor, {
                key: editor.record?.employee.id || 'new',
                record: editor.record,
                draft: employeeDraft(editor.record),
                snapshot,
                operator,
                live,
                canEdit:
                  employeeStatus(editor.record) !== 'Archived' &&
                  can(editor.record ? 'edit' : 'create'),
                onRemove:
                  live &&
                  editor.record &&
                  employeeStatus(editor.record) !== 'Archived' &&
                  editor.record.employee.id !== snapshot.verifiers?.[0]?.id &&
                  can('edit') &&
                  isAdministrator(access, actor)
                    ? removeEmployee
                    : null,
                onSave: save,
                onStatus: saveStatus,
                onClose: () => setEditor(null),
                canEditFiles: employeeStatus(editor.record) !== 'Archived' && can('edit'),
                onFilesSaved: reload,
              }),
          ),
  );
}
