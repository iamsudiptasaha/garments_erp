import { fileRecordPath } from '../access/workspace-routes.js';
import React, { useEffect, useRef, useState } from 'react';
import { miscellaneousPages } from './catalog.js';
import { contactSections, contactDraft, saveContact } from './contact-model.js';
import { changeContactRow } from './primary.js';
import { optionsFor } from '../fabric/domain.js';
const h = React.createElement;
export function ContactEditor({ data, id, onSave, onClose, can = () => true }) {
  const dialog = useRef(null),
    saving = useRef(false),
    [draft, setDraft] = useState(() => contactDraft(data, id, can)),
    [activeSection, setActiveSection] = useState('basic'),
    [detailQuery, setDetailQuery] = useState(''),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false);
  const editable = can(id ? 'edit' : 'create', 'materialContacts');
  const visibleSections = contactSections.filter(
    ({ table }) => draft.sections[table] !== undefined,
  );
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  function change(fn) {
    setDraft(fn);
    setReview(false);
  }
  function input(field, row, set, prefix = '', disabled = false) {
    return h(
      'label',
      {
        key: field.key,
        className: field.type === 'checkbox' ? 'contact-primary-toggle' : undefined,
      },
      h('span', null, field.label),
      field.type === 'checkbox'
        ? h('input', {
            type: 'checkbox',
            'aria-label': prefix + field.label,
            checked: row[field.key] === true,
            disabled,
            onChange: (e) => set(e.target.checked),
          })
        : field.type === 'select'
          ? h(
              'select',
              {
                'aria-label': prefix + field.label,
                value: row[field.key] ?? '',
                disabled,
                onChange: (e) => set(e.target.value),
              },
              h('option', { value: '' }, 'Not selected'),
              optionsFor(data, field.source).map(([key, label]) =>
                h('option', { key, value: key }, label),
              ),
            )
          : h('input', {
              type: field.type === 'email' ? 'email' : 'text',
              'aria-label': prefix + field.label,
              value: row[field.key] ?? '',
              disabled,
              onChange: (e) => set(e.target.value),
            }),
    );
  }
  async function submit(e) {
    e.preventDefault();
    if (saving.current || !editable) return;
    setError('');
    try {
      const next = saveContact(data, draft, can);
      if (!review) {
        setReview(true);
        return;
      }
      saving.current = true;
      setBusy(true);
      await onSave(next);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog contact-editor',
      'aria-labelledby': 'contact-editor-title',
      onCancel: (e) => (busy ? e.preventDefault() : onClose()),
    },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, 'CONTACTS'),
        h(
          'h2',
          { id: 'contact-editor-title' },
          review ? 'Review Changes' : id ? draft.header.company_name || 'Contact' : 'Add contact',
        ),
      ),
      h('button', { onClick: onClose, disabled: busy }, 'Close'),
    ),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    h(
      'form',
      { onSubmit: submit },
      !review &&
        h(
          'nav',
          { className: 'contact-section-nav', 'aria-label': 'Contact sections' },
          [
            ['basic', 'Basic Information'],
            ...visibleSections.map(({ table, title }) => [table, title]),
          ].map(([key, title]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                'aria-pressed': activeSection === key,
                onClick: () => setActiveSection(key),
              },
              title,
            ),
          ),
        ),
      h(
        'section',
        { className: 'fabric-line', hidden: !review && activeSection !== 'basic' },
        h('h3', null, 'Basic Information'),
        review || !editable
          ? h(
              'dl',
              { className: 'fabric-fields' },
              miscellaneousPages.materialContacts.header.map((f) => {
                const original = data.contacts.find((row) => row.id === id)?.[f.key];
                const value = draft.header[f.key];
                const display = (fieldValue) =>
                  f.type === 'select'
                    ? optionsFor(data, f.source).find(([key]) => key === fieldValue)?.[1] || '—'
                    : fieldValue || '—';
                return h(
                  'div',
                  { key: f.key },
                  h('dt', null, f.label),
                  h(
                    'dd',
                    null,
                    id && String(original ?? '') !== String(value ?? '')
                      ? display(original) + ' → ' + display(value)
                      : display(value),
                  ),
                );
              }),
            )
          : h(
              'div',
              { className: 'fabric-fields' },
              miscellaneousPages.materialContacts.header.map((f) =>
                input(f, draft.header, (value) =>
                  change((d) => ({ ...d, header: { ...d.header, [f.key]: value } })),
                ),
              ),
            ),
      ),
      visibleSections.map((section) => {
        const rows = draft.sections[section.table];
        const additional = section.table === 'contact_extra';
        const bank = section.table === 'contact_bank_account';
        const query = additional && !review ? detailQuery.trim().toLowerCase() : '';
        const matches = (row) =>
          !query ||
          !row.id ||
          [row.key, row.value].some((value) =>
            String(value ?? '')
              .toLowerCase()
              .includes(query),
          );
        const fields = section.fields.filter((field) => field.type !== 'checkbox');
        const toggles = section.fields.filter((field) => field.type === 'checkbox');
        return h(
          'section',
          {
            className: 'fabric-line',
            key: section.table,
            hidden: !review && activeSection !== section.table,
          },
          h('h3', null, section.title),
          additional &&
            !review &&
            rows.length > 0 &&
            h('input', {
              type: 'search',
              'aria-label': 'Search additional details',
              placeholder: 'Search detail names and values',
              value: detailQuery,
              onChange: (event) => setDetailQuery(event.target.value),
            }),
          h(
            React.Fragment,
            null,
            rows.length === 0 && h('p', { className: 'editor-note' }, 'Not provided'),
            query &&
              !rows.some(matches) &&
              h('p', { className: 'editor-note' }, 'No matching details'),
            rows.map((row, index) => {
              if (!matches(row)) return null;
              const canChange = editable && can(row.id ? 'edit' : 'create', section.resource);
              const renderField = (field) =>
                input(
                  field,
                  row,
                  (value) =>
                    change((d) => ({
                      ...d,
                      sections: {
                        ...d.sections,
                        [section.table]: changeContactRow(
                          d.sections[section.table],
                          index,
                          field,
                          value,
                        ),
                      },
                    })),
                  section.title + ' ' + (index + 1) + ' ',
                  busy,
                );
              return h(
                'div',
                { className: 'contact-entry-row', key: row.id || index },
                h('h4', null, section.title + ' ' + (index + 1)),
                review || !canChange
                  ? h(
                      'dl',
                      null,
                      section.fields.map((f) =>
                        h(
                          'div',
                          { key: f.key },
                          h('dt', null, f.label),
                          h(
                            'dd',
                            null,
                            (f.type === 'checkbox'
                              ? row[f.key]
                                ? 'Yes'
                                : 'No'
                              : f.type === 'select'
                                ? optionsFor(data, f.source).find(
                                    ([key]) => key === row[f.key],
                                  )?.[1]
                                : row[f.key]) || '—',
                          ),
                        ),
                      ),
                    )
                  : h(
                      'div',
                      { className: 'fabric-fields' },
                      fields.map(renderField),
                      toggles.length > 0 &&
                        h('div', { className: 'contact-primary-flags' }, toggles.map(renderField)),
                    ),
                !review &&
                  bank &&
                  data._live &&
                  row.id &&
                  h(
                    'a',
                    {
                      href: fileRecordPath('contactBankDocument', { record: row.id }),
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    },
                    canChange ? 'Manage supporting document' : 'View supporting document',
                  ),
                !review &&
                  canChange &&
                  !row.id &&
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () =>
                        change((d) => ({
                          ...d,
                          sections: {
                            ...d.sections,
                            [section.table]: d.sections[section.table].filter(
                              (_, i) => i !== index,
                            ),
                          },
                        })),
                    },
                    'Remove row',
                  ),
              );
            }),
            !review &&
              editable &&
              can('create', section.resource) &&
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy,
                  onClick: () =>
                    change((d) => ({
                      ...d,
                      sections: {
                        ...d.sections,
                        [section.table]: [
                          ...d.sections[section.table],
                          Object.fromEntries(
                            section.fields.map((f) => [f.key, f.type === 'checkbox' ? false : '']),
                          ),
                        ],
                      },
                    })),
                },
                '+ Add ' +
                  {
                    contact_items: 'contact item',
                    contact_bank_account: 'bank account',
                    contact_extra: 'detail',
                  }[section.table],
              ),
          ),
        );
      }),
      h(
        'div',
        { className: 'editor-actions' },
        h(
          'button',
          { type: 'button', onClick: onClose, disabled: busy },
          editable ? 'Cancel' : 'Close',
        ),
        review &&
          h(
            'button',
            { type: 'button', disabled: busy, onClick: () => setReview(false) },
            'Back to edit',
          ),
        editable &&
          h(
            'button',
            { type: 'submit', className: 'primary', disabled: busy },
            review ? 'Confirm Save' : 'Review Changes',
          ),
      ),
    ),
  );
}
