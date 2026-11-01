import React, { useEffect, useRef, useState } from 'react';
import { miscellaneousPages } from './catalog.js';
import { contactSections, contactDraft, saveContact } from './contact-model.js';
import { changeContactRow } from './primary.js';
import { optionsFor } from '../fabric/domain.js';
const h = React.createElement;
export function ContactEditor({ data, id, onSave, onClose, can = () => true }) {
  const dialog = useRef(null),
    [draft, setDraft] = useState(() => contactDraft(data, id, can)),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false);
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
              'aria-label': prefix + field.label,
              value: row[field.key] ?? '',
              disabled,
              onChange: (e) => set(e.target.value),
            }),
    );
  }
  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const next = saveContact(data, draft, can);
      if (!review) {
        setReview(true);
        return;
      }
      setBusy(true);
      await onSave(next);
      onClose();
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
      className: 'fabric-dialog contact-editor',
      onCancel: (e) => (busy ? e.preventDefault() : onClose()),
    },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, 'CONTACTS'),
        h('h2', null, review ? 'Review contact' : id ? 'Edit contact' : 'Add contact'),
      ),
      h('button', { onClick: onClose, disabled: busy }, 'Close'),
    ),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    h(
      'form',
      { onSubmit: submit },
      h(
        'section',
        { className: 'fabric-line' },
        h('h3', null, 'Contact'),
        review
          ? h('p', null, draft.header.company_name || 'Unnamed contact')
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
      contactSections.map((section) => {
        const rows = draft.sections[section.table];
        return h(
          'section',
          { className: 'fabric-line', key: section.table },
          h('h3', null, section.title + ' · optional'),
          rows === undefined
            ? h('p', null, 'Your role cannot view this section.')
            : h(
                React.Fragment,
                null,
                rows.length === 0 && h('p', { className: 'editor-note' }, 'Not provided'),
                rows.map((row, index) =>
                  h(
                    'div',
                    { className: 'contact-entry-row', key: row.id || index },
                    h('h4', null, section.title + ' ' + (index + 1)),
                    review
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
                          section.fields.map((f) =>
                            input(
                              f,
                              row,
                              (value) =>
                                change((d) => ({
                                  ...d,
                                  sections: {
                                    ...d.sections,
                                    [section.table]: changeContactRow(
                                      d.sections[section.table],
                                      index,
                                      f,
                                      value,
                                    ),
                                  },
                                })),
                              section.title + ' ' + (index + 1) + ' ',
                              busy || !can(row.id ? 'edit' : 'create', section.resource),
                            ),
                          ),
                        ),
                    !review &&
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
                  ),
                ),
                !review &&
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
                                section.fields.map((f) => [
                                  f.key,
                                  f.type === 'checkbox' ? false : '',
                                ]),
                              ),
                            ],
                          },
                        })),
                    },
                    '+ Add ' +
                      {
                        contact_items: 'contact item',
                        contact_bank_account: 'bank account',
                        contact_extra: 'extra detail',
                      }[section.table],
                  ),
              ),
        );
      }),
      h(
        'div',
        { className: 'editor-actions' },
        h('button', { type: 'button', onClick: onClose, disabled: busy }, 'Cancel'),
        review &&
          h(
            'button',
            { type: 'button', disabled: busy, onClick: () => setReview(false) },
            'Back to edit',
          ),
        h(
          'button',
          { type: 'submit', className: 'primary', disabled: busy },
          review ? 'Confirm & save contact' : 'Review contact',
        ),
      ),
    ),
  );
}
