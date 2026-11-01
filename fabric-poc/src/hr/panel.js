import React, { useEffect, useMemo, useState } from 'react';
import { allowed } from '../admin/model.js';
import { FabricSheet } from '../fabric/sheet.js';
import { employeeCommands } from './live.js';
import { EmployeeEditor } from './editor.js';
import { employeeReferences, employeeRows, employeeDraft, hrPages } from './model.js';
import './styles.css';
const h = React.createElement;
const spec = {
  title: 'Employees',
  columns: [
    ['name', 'Employee'],
    ['code', 'Employee code'],
    ['phone', 'Phone'],
    ['joined', 'Joined'],
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
}) {
  const tab = hrPages[page].table;
  const [snapshot, setSnapshot] = useState(() =>
      live ? null : preview(access, contactChoices, contactItems),
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [editor, setEditor] = useState(null),
    [query, setQuery] = useState(''),
    [view, setView] = useState('overview'),
    [reference, setReference] = useState(''),
    [referenceId, setReferenceId] = useState(null),
    [busy, setBusy] = useState(false),
    [selection, setSelection] = useState(null),
    [preferences, setPreferences] = useState({});
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
  async function save(payload, proof) {
    if (live) updated(await commands.save(payload, proof));
    else {
      const old = snapshot.records.find((r) => r.employee.id === payload.id);
      const row = {
        ...old,
        employee: {
          ...old?.employee,
          ...payload.draft.employee,
          id: payload.id || crypto.randomUUID(),
          employee_code: old?.employee.employee_code || 'Preview · assigned on live save',
          updated_at: new Date().toISOString(),
          verified_by_employee_id: null,
        },
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
    setEditor(null);
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
  const rows = employeeRows(snapshot?.records || [], query);
  return h(
    'section',
    { className: 'hr-workspace' },
    h(
      'header',
      { className: 'fabric-page-header' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, 'EMPLOYEE / HR'),
        h('h1', null, tab === 'employees' ? 'Employees' : employeeReferences[tab]),
        h(
          'p',
          null,
          'Employee profiles, contacts and documents. Login access stays in Administration.',
        ),
      ),
    ),
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
            h(
              'table',
              { className: 'access-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, 'Name'),
                  h('th', null, 'Updated at'),
                  h('th', null, 'Actions'),
                ),
              ),
              h(
                'tbody',
                null,
                snapshot[tab].map((r) =>
                  h(
                    'tr',
                    { key: r.id },
                    h('td', null, r.name),
                    h('td', null, r.updated_at || '—'),
                    h(
                      'td',
                      null,
                      can('edit') &&
                        h(
                          'button',
                          {
                            onClick: () => {
                              setReferenceId(r.id);
                              setReference(r.name);
                            },
                          },
                          'Edit',
                        ),
                    ),
                  ),
                ),
              ),
            ),
            !snapshot[tab].length && h('p', null, 'No values added yet.'),
          )
        : h(
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
              h(
                'div',
                { className: 'fabric-view-toggle' },
                ['overview', 'sheet'].map((v) =>
                  h(
                    'button',
                    { key: v, 'aria-pressed': v === view, onClick: () => setView(v) },
                    v === 'overview' ? 'Overview' : 'Sheet',
                  ),
                ),
              ),
              can('create') &&
                h(
                  'button',
                  { className: 'primary', onClick: () => setEditor({ record: null }) },
                  '+ Add employee',
                ),
              view === 'sheet' &&
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
            view === 'sheet'
              ? h(FabricSheet, {
                  page: 'employees',
                  spec,
                  records: rows,
                  preferences,
                  onPreferences: (p) => setPreferences((old) => ({ ...old, ...p })),
                  capabilities: { format: false, export: can('export'), print: can('print') },
                  onSelect: (row) => setSelection(row?.id || null),
                  onNotice: setNotice,
                })
              : h(
                  'div',
                  { className: 'hr-directory' },
                  rows.map((r) =>
                    h(
                      'button',
                      {
                        key: r.id,
                        className: 'hr-person-card',
                        onClick: () => setEditor({ record: r.record }),
                      },
                      h(
                        'span',
                        { className: 'hr-initials' },
                        r.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((s) => s[0])
                          .join(''),
                      ),
                      h('strong', null, r.name),
                      h('span', null, r.code),
                      h('span', null, r.phone || 'Phone not set'),
                      h('small', null, r.verified),
                      h('span', { className: 'hr-open' }, 'Open profile →'),
                    ),
                  ),
                ),
            !rows.length && h('p', null, 'No matching employees.'),
            editor &&
              h(EmployeeEditor, {
                key: editor.record?.employee.id || 'new',
                record: editor.record,
                draft: employeeDraft(editor.record),
                snapshot,
                live,
                canEdit: can(editor.record ? 'edit' : 'create'),
                onSave: save,
                onClose: () => setEditor(null),
                onReload: reload,
              }),
          ),
  );
}
