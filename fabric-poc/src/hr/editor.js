import React, { useEffect, useRef, useState } from 'react';
import { ContactSelect } from './contact-select.js';
import { FilePanel } from '../files/panel.js';
import { liveFileCommands } from '../files/live.js';
import { getAccessClient } from '../access/client.js';
import { employeeFields, employeeDraft, employeeLinks, validateEmployeeDraft } from './model.js';
import '../files/styles.css';
const h = React.createElement;
export function EmployeeEditor({
  record,
  draft: initial,
  snapshot,
  live,
  canEdit,
  operator,
  onSave,
  onStatus,
  onClose,
  onReload,
}) {
  const dialog = useRef(null),
    [draft, setDraft] = useState(() => ({
      ...initial,
      employee: {
        ...initial.employee,
        contact_purpose_id:
          initial.employee.contact_purpose_id ||
          snapshot.contact_purpose.find((p) => p.type === 'Employee')?.id ||
          '',
      },
    })),
    [tab, setTab] = useState('profile'),
    [review, setReview] = useState(false),
    [active, setActive] = useState(record?.employee.is_active !== false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState(null);
  const [revision, setRevision] = useState(record?.revision || null);
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== savedDraft;
  const payload = { id: record?.employee.id || null, expected: revision, draft };
  const assignedContacts = new Set(
    snapshot.records
      .filter((row) => row.employee.id !== record?.employee.id)
      .map((row) => row.employee.contacts_id),
  );
  const employeeContacts = snapshot.contact_choices.filter(
    (contact) => !assignedContacts.has(contact.id),
  );
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (!live || !record) return;
    let active = true;
    const c = liveFileCommands(getAccessClient());
    Promise.all([c.registry(), c.routes()])
      .then(([registry, routes]) => {
        if (active) setFiles({ registry, routes, store: c.store(registry, routes) });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function change(update) {
    if (busy) return;
    setDraft((d) => update(d));
    setReview(false);
  }
  function field(obj, key, label, type = 'text', set) {
    const options = snapshot[type];
    return h(
      'label',
      { key },
      h('span', null, label),
      options
        ? h(
            'select',
            {
              value: obj[key] || '',
              disabled: !canEdit || busy,
              onChange: (e) => set(e.target.value || null),
            },
            h('option', { value: '' }, 'Not set'),
            options.map((o) => h('option', { key: o.id, value: o.id }, o.name || o.type)),
          )
        : h(type === 'textarea' ? 'textarea' : 'input', {
            type: type === 'textarea' ? undefined : type,
            value: obj[key] || '',
            disabled: !canEdit || busy,
            onChange: (e) => set(e.target.value),
            autoComplete: 'off',
          }),
    );
  }
  function groupFields(obj, fields, set) {
    return h(
      'div',
      { className: 'fabric-fields' },
      fields.map(([key, label, type]) =>
        field(obj, key, label, type || 'text', (value) => set(key, value)),
      ),
    );
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (tab === 'status') await onStatus(record, active, revision);
      else await onSave(payload);
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
      className: 'fabric-dialog hr-editor',
      onCancel: (e) => {
        if (busy) e.preventDefault();
        else onClose();
      },
    },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, 'EMPLOYEE / HR'),
        h('h2', null, record ? record.contact.company_name : 'Add employee'),
        h('p', null, record?.employee.employee_code || 'Employee code is generated on save'),
      ),
      h('button', { disabled: busy, onClick: onClose }, 'Close'),
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    !review &&
      h(
        'div',
        { className: 'fabric-view-toggle' },
        ['profile', 'contacts', 'documents', 'status'].map((key) =>
          h(
            'button',
            { key, 'aria-pressed': tab === key, onClick: () => setTab(key) },
            {
              profile: 'Profile',
              contacts: 'Contact links',
              documents: 'Documents',
              status: 'Status',
            }[key],
          ),
        ),
      ),
    review
      ? h(
          'section',
          { className: 'hr-review' },
          h('h3', null, tab === 'status' ? 'Review employee status' : 'Review employee'),
          h(
            'dl',
            null,
            [
              [
                'Employee contact',
                snapshot.contact_choices.find((c) => c.id === draft.employee.contacts_id)
                  ?.company_name || 'Not selected',
              ],
              ['Employee code', record?.employee.employee_code || 'Generated on save'],
              [
                'Emergency contact',
                snapshot.contact_choices.find((c) => c.id === draft.employee.contacts_emergency_id)
                  ?.company_name || 'Not set',
              ],
              ['Verification', 'Automatically verified by ' + operator],
              [
                'Status',
                tab === 'status'
                  ? active
                    ? 'Active'
                    : 'Inactive'
                  : record?.employee.is_active === false
                    ? 'Inactive · unchanged on save'
                    : 'Active',
              ],
            ].map(([a, b]) => h('div', { key: a }, h('dt', null, a), h('dd', null, b))),
          ),
        )
      : h(
          'div',
          null,
          tab === 'status' &&
            h(
              'section',
              { className: 'hr-status-panel' },
              h('h3', null, 'Employee status'),
              record
                ? h(
                    React.Fragment,
                    null,
                    h(
                      'label',
                      null,
                      'Status',
                      h(
                        'select',
                        {
                          value: active ? 'active' : 'inactive',
                          disabled: !canEdit || busy || dirty,
                          onChange: (e) => {
                            setActive(e.target.value === 'active');
                            setReview(false);
                          },
                        },
                        h('option', { value: 'active' }, 'Active'),
                        h('option', { value: 'inactive' }, 'Inactive'),
                      ),
                    ),
                    h(
                      'p',
                      { className: 'editor-note' },
                      'Inactive employees cannot access their portal.',
                    ),
                    dirty &&
                      h(
                        'p',
                        { className: 'editor-note' },
                        'Save profile changes before changing employee status.',
                      ),
                  )
                : h(
                    'p',
                    null,
                    'New employees are active by default. Save the employee before changing their status.',
                  ),
            ),
          tab === 'profile' &&
            h(
              React.Fragment,
              null,
              groupFields(
                draft.employee,
                employeeFields.filter(([k]) => !k.startsWith('supporting_')),
                (k, v) => change((d) => ({ ...d, employee: { ...d.employee, [k]: v } })),
              ),
              h(
                'p',
                { className: 'editor-note' },
                'Created: ' +
                  (record?.employee.created_at || 'On save') +
                  ' · Updated: ' +
                  (record?.employee.updated_at || 'On save'),
              ),
              record &&
                h(
                  'label',
                  null,
                  'Primary contact email',
                  h('input', {
                    readOnly: true,
                    value: record.contacts?.find((contact) => contact.primary_email)?.email || '',
                  }),
                ),
              record?.verifier_name &&
                h('p', null, 'Previously verified by ' + record.verifier_name),
            ),
          tab === 'contacts' &&
            h(
              React.Fragment,
              null,
              employeeLinks.map((link) =>
                link.source === 'contacts'
                  ? h(ContactSelect, {
                      key: link.key,
                      link,
                      records:
                        link.key === 'contacts_id' ? employeeContacts : snapshot.contact_choices,
                      value: draft.employee[link.key],
                      disabled: !canEdit || busy,
                      onChange: (value) =>
                        change((d) => ({
                          ...d,
                          employee: {
                            ...d.employee,
                            [link.key]: value,
                            ...(link.key === 'contacts_emergency_id' && !value
                              ? { contact_purpose_emergency_id: '' }
                              : {}),
                          },
                        })),
                    })
                  : field(draft.employee, link.key, link.label, link.source, (v) =>
                      change((d) => ({ ...d, employee: { ...d.employee, [link.key]: v } })),
                    ),
              ),
              h(
                'p',
                { className: 'editor-note' },
                'Contact details, bank accounts and their supporting documents are maintained in Contacts.',
              ),
              h(
                'a',
                {
                  href: live
                    ? '/fabric.html?live=1#materialContacts'
                    : '/fabric.html#materialContacts',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                'Open Contacts',
              ),
            ),
          tab === 'documents' &&
            h(
              React.Fragment,
              null,
              groupFields(
                draft.employee,
                employeeFields.filter(([k]) => k.startsWith('supporting_')),
                (k, v) => change((d) => ({ ...d, employee: { ...d.employee, [k]: v } })),
              ),
              !record
                ? h('p', null, 'Save the employee first, then upload their private documents.')
                : !live
                  ? h('p', null, 'Private uploads are available in the live workspace.')
                  : files
                    ? h(
                        React.Fragment,
                        null,
                        dirty &&
                          h(
                            'p',
                            { className: 'editor-note' },
                            'Save profile changes before uploading documents.',
                          ),
                        ['employeePhoto', 'employeeDocument1', 'employeeDocument2'].map((key) =>
                          h(FilePanel, {
                            key,
                            targetKey: key,
                            recordId: record.employee.id,
                            recordLabel: record.employee.employee_code,
                            registry: files.registry,
                            store: files.store,
                            targetDefinition: files.routes.find((r) => r.key === key),
                            canWrite: canEdit && !dirty && !busy,
                            onBusyChange: setBusy,
                            onAttached: async () => {
                              const next = await onReload();
                              if (!next)
                                throw Error(
                                  'File saved. Close and reload this employee before further edits.',
                                );
                              const fresh = next.records.find(
                                (r) => r.employee.id === record.employee.id,
                              );
                              const nextDraft = employeeDraft(fresh);
                              setDraft(nextDraft);
                              setSavedDraft(JSON.stringify(nextDraft));
                              setRevision(fresh.revision);
                            },
                          }),
                        ),
                      )
                    : h('p', null, 'Loading private document routes…'),
            ),
        ),
    canEdit &&
      h(
        'section',
        { className: 'hr-verification' },
        h('h3', null, 'Verification'),
        h('label', null, 'Verified by', h('input', { value: operator, readOnly: true })),
        h(
          'p',
          { className: 'editor-note' },
          'Saving automatically verifies this record using the logged-in operator. ' +
            (tab === 'status'
              ? 'Status changes are attributed to the same operator.'
              : record
                ? 'The current active/inactive status stays unchanged.'
                : 'New employees are active by default.'),
        ),
      ),
    h(
      'div',
      { className: 'editor-actions' },
      h('button', { disabled: busy, onClick: onClose }, 'Cancel'),
      canEdit &&
        (review
          ? h(
              React.Fragment,
              null,
              h('button', { disabled: busy, onClick: () => setReview(false) }, 'Back to edit'),
              h(
                'button',
                { className: 'primary', disabled: busy, onClick: save },
                busy
                  ? 'Saving…'
                  : tab === 'status'
                    ? 'Confirm & save status'
                    : 'Confirm & save employee',
              ),
            )
          : h(
              'button',
              {
                className: 'primary',
                disabled:
                  busy ||
                  (tab === 'status' &&
                    (!record || dirty || active === (record.employee.is_active !== false))),
                onClick: () => {
                  try {
                    if (tab !== 'status') validateEmployeeDraft(draft);
                    setError('');
                    setReview(true);
                  } catch (e) {
                    setError(e.message);
                  }
                },
              },
              tab === 'status' ? 'Review status' : 'Review employee',
            )),
    ),
  );
}
