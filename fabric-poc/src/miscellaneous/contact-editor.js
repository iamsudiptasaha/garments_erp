import { contactWrite, reviewContactBankFiles } from './live.js';
import { getAccessClient } from '../access/client.js';
import { PrivateImageButton } from '../files/record-attachments.js';
import React, { useEffect, useRef, useState } from 'react';
import { miscellaneousPages } from './catalog.js';
import { contactSections, contactDraft, saveContact } from './contact-model.js';
import { changeContactRow } from './primary.js';
import { optionsFor } from '../fabric/domain.js';
const h = React.createElement;
export function ContactEditor({ data, id, onSave, onReload, onClose, can = () => true }) {
  const dialog = useRef(null),
    saving = useRef(false),
    reviewed = useRef(null),
    saved = useRef(false),
    [draft, setDraft] = useState(() => contactDraft(data, id, can)),
    [activeSection, setActiveSection] = useState('basic'),
    [detailQuery, setDetailQuery] = useState(''),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [deleteContact, setDeleteContact] = useState(false),
    [contactSaved, setContactSaved] = useState(false),
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
  function setBankFile(table, index, pendingFile) {
    change((draft) => ({
      ...draft,
      sections: {
        ...draft.sections,
        [table]: draft.sections[table].map((row, i) =>
          i === index ? { ...row, pendingFile } : row,
        ),
      },
    }));
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
  const canDeleteContact = Boolean(id && data._live && data.contactDelete?.contacts);
  const removals = visibleSections.flatMap(({ table, title }) =>
    (id ? data[table].filter((row) => row.contact_id === id) : [])
      .filter((row) => deleteContact || !draft.sections[table].some((entry) => entry.id === row.id))
      .map((row) => ({
        id: row.id,
        table,
        label: row.name || row.key || row.account_number || title,
      })),
  );
  async function submit(e) {
    e.preventDefault();
    if (saving.current || !(editable || (deleteContact && canDeleteContact))) return;
    setError('');
    try {
      saving.current = true;
      setBusy(true);
      if (!review) {
        const files = (draft.sections.contact_bank_account || [])
          .filter((row) => row.pendingFile)
          .map((row) => ({
            ...row.pendingFile,
            recordId: row.id,
            previousAttachmentId: row.supporting_documents ?? null,
          }));
        const document = data._live ? contactWrite(data, draft) : saveContact(data, draft, can);
        const upload = files.length ? await reviewContactBankFiles(getAccessClient(), files) : null;
        reviewed.current = { document, files, upload };
        setReview(true);
        return;
      }
      const batch = reviewed.current;
      if (!saved.current) {
        const ids = await onSave(batch.document);
        saved.current = true;
        setContactSaved(true);
        for (const entry of batch.files) entry.recordId ||= ids?.[entry.requestId];
      }
      if (batch.upload) {
        while (batch.files.length) {
          const entry = batch.files[0];
          if (!entry.recordId) throw Error('Reopen the bank account to attach its document.');
          await batch.upload(entry);
          batch.files.shift();
        }
        await onReload();
      }
      onClose();
    } catch (e) {
      setError(saved.current ? 'Contact saved. ' + e.message : e.message);
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
                input(
                  f,
                  draft.header,
                  (value) => change((d) => ({ ...d, header: { ...d.header, [f.key]: value } })),
                  '',
                  busy,
                ),
              ),
            ),
      ),
      review &&
        removals.length > 0 &&
        h(
          'section',
          { className: 'fabric-line' },
          h('h3', null, 'Records to remove'),
          h(
            'ul',
            null,
            removals.map(({ id, table, label }) => h('li', { key: table + id }, label)),
          ),
        ),
      review &&
        deleteContact &&
        h(
          'p',
          { className: 'form-error' },
          'Confirming will delete this contact and the listed entries.',
        ),
      !deleteContact &&
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
          const fields = section.fields.filter(
            (field) =>
              field.type !== 'checkbox' && (!data._live || field.key !== 'supporting_documents'),
          );
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
                        section.fields
                          .filter((f) => !data._live || f.key !== 'supporting_documents')
                          .map((f) =>
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
                          h(
                            'div',
                            { className: 'contact-primary-flags' },
                            toggles.map(renderField),
                          ),
                      ),
                  bank &&
                    row.pendingFile &&
                    h(
                      'p',
                      { className: 'editor-note' },
                      row.pendingFile.file
                        ? 'Supporting document: ' + row.pendingFile.file.name
                        : 'Remove supporting document: ' +
                            (data.attachments?.find(
                              ({ id }) => String(id) === String(row.supporting_documents),
                            )?.filename || 'current file'),
                    ),
                  !review &&
                    bank &&
                    data._live &&
                    h(
                      'div',
                      { className: 'editor-note' },
                      row.id &&
                        row.supporting_documents &&
                        h(
                          PrivateImageButton,
                          {
                            targetKey: 'contactBankDocument',
                            recordId: row.id,
                            attachmentId: row.supporting_documents,
                          },
                          'View supporting document',
                        ),
                      canChange &&
                        can('edit', section.resource) &&
                        h(
                          React.Fragment,
                          null,
                          row.supporting_documents &&
                            !row.pendingFile &&
                            h(
                              'button',
                              {
                                type: 'button',
                                disabled: busy,
                                onClick: () => setBankFile(section.table, index, { file: null }),
                              },
                              'Remove supporting document',
                            ),
                          h(
                            'label',
                            { className: 'contact-bank-file' },
                            h(
                              'span',
                              null,
                              row.supporting_documents
                                ? 'Replace supporting document'
                                : 'Supporting document',
                            ),
                            h('input', {
                              type: 'file',
                              accept: 'application/pdf,image/jpeg,image/png,image/webp',
                              disabled: busy,
                              onChange: (event) => {
                                const file = event.target.files?.[0];
                                if (file)
                                  setBankFile(section.table, index, {
                                    file,
                                    requestId: crypto.randomUUID(),
                                  });
                                event.target.value = '';
                              },
                            }),
                          ),
                          row.pendingFile &&
                            h(
                              'div',
                              { className: 'fabric-actions' },
                              h(
                                'span',
                                { role: 'status' },
                                row.pendingFile.file
                                  ? 'Selected: ' + row.pendingFile.file.name
                                  : 'Marked for removal',
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  disabled: busy,
                                  onClick: () => setBankFile(section.table, index, null),
                                },
                                'Undo attachment change',
                              ),
                            ),
                        ),
                    ),
                  !review &&
                    ((!row.id && canChange) ||
                      (row.id && editable && data._live && data.contactDelete?.[section.table])) &&
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
          editable && !contactSaved ? 'Cancel' : 'Close',
        ),
        !review &&
          canDeleteContact &&
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => {
                reviewed.current = {
                  document: contactWrite(data, draft, true),
                  files: [],
                  upload: null,
                };
                setDeleteContact(true);
                setError('');
                setReview(true);
              },
            },
            'Delete contact',
          ),
        review &&
          !contactSaved &&
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => {
                setDeleteContact(false);
                setReview(false);
                setError('');
              },
            },
            'Back to edit',
          ),
        (editable || (deleteContact && canDeleteContact)) &&
          h(
            'button',
            { type: 'submit', className: 'primary', disabled: busy },
            deleteContact
              ? 'Confirm Delete'
              : contactSaved
                ? 'Retry supporting documents'
                : review
                  ? 'Confirm Save'
                  : 'Review Changes',
          ),
      ),
    ),
  );
}
