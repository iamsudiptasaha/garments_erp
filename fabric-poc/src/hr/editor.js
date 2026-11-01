import React, { useEffect, useRef, useState } from 'react';
import { EmployeeSelect } from '../admin/employee-select.js';
import { ContactSelect } from './contact-select.js';
import { FilePanel } from '../files/panel.js';
import { liveFileCommands } from '../files/live.js';
import { getAccessClient } from '../access/client.js';
import { employeeFields, employeeDraft, employeeLinks, validateEmployeeDraft } from './model.js';
import { verifyEmployeePassword } from './live.js';
import '../files/styles.css';
const h = React.createElement;
export function EmployeeEditor({
  record,
  draft: initial,
  snapshot,
  live,
  canEdit,
  onSave,
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
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [verifier, setVerifier] = useState(null),
    [password, setPassword] = useState(''),
    [proof, setProof] = useState(null),
    [files, setFiles] = useState(null);
  const [revision, setRevision] = useState(record?.revision || null);
  const [savedDraft, setSavedDraft] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== savedDraft;
  const payload = { id: record?.employee.id || null, expected: revision, draft };
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
    setProof(null);
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
  async function verify() {
    setBusy(true);
    setError('');
    try {
      validateEmployeeDraft(draft);
      const person = snapshot.verifiers.find((e) => e.id === verifier);
      setProof(
        await verifyEmployeePassword({
          email: person.email,
          password,
          employeeId: verifier,
          actor: live.actor,
          payload,
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (verifier && !proof)
        throw Error('The selected employee must verify their password before saving.');
      await onSave(payload, proof);
    } catch (e) {
      setError(e.message);
      setProof(null);
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
        ['profile', 'contacts', 'documents'].map((key) =>
          h(
            'button',
            { key, 'aria-pressed': tab === key, onClick: () => setTab(key) },
            {
              profile: 'Profile',
              contacts: 'Contact links',
              documents: 'Documents',
            }[key],
          ),
        ),
      ),
    review
      ? h(
          'section',
          { className: 'hr-review' },
          h('h3', null, 'Review employee'),
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
              [
                'Verification',
                proof
                  ? 'Password verified for this exact record'
                  : verifier
                    ? 'Password verification required'
                    : 'Will save as unverified',
              ],
            ].map(([a, b]) => h('div', { key: a }, h('dt', null, a), h('dd', null, b))),
          ),
        )
      : h(
          'div',
          null,
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
                      records: snapshot.contact_choices,
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
                        ['employeeDocument1', 'employeeDocument2'].map((key) =>
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
                              setProof(null);
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
        h('h3', null, 'Verified by employee'),
        !live
          ? h('p', null, 'Password verification is available only in the live workspace.')
          : h(
              React.Fragment,
              null,
              h(EmployeeSelect, {
                employees: snapshot.verifiers,
                value: verifier,
                inputId: 'hr-verifier',
                onChange: (id) => {
                  setVerifier(id);
                  setProof(null);
                  setPassword('');
                },
                disabled: busy,
                label: 'Select verifying employee',
              }),
              verifier &&
                !proof &&
                h(
                  'div',
                  { className: 'hr-verify-fields' },
                  h(
                    'label',
                    null,
                    'Selected employee’s password',
                    h('input', {
                      type: 'password',
                      autoComplete: 'off',
                      value: password,
                      onChange: (e) => setPassword(e.target.value),
                      disabled: busy,
                    }),
                  ),
                  h('button', { disabled: busy || !password, onClick: verify }, 'Verify password'),
                ),
              proof &&
                h(
                  'p',
                  { role: 'status' },
                  'Password verified. Changing any form data will require verification again.',
                ),
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
                { className: 'primary', disabled: busy || (!!verifier && !proof), onClick: save },
                busy ? 'Saving…' : 'Confirm & save employee',
              ),
            )
          : h(
              'button',
              {
                className: 'primary',
                disabled: busy,
                onClick: () => {
                  try {
                    validateEmployeeDraft(draft);
                    setError('');
                    setReview(true);
                  } catch (e) {
                    setError(e.message);
                  }
                },
              },
              'Review employee',
            )),
    ),
  );
}
