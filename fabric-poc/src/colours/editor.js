import React, { useEffect, useRef, useState } from 'react';
import { labLabels, versionsFor, saveLabDip, labClosed } from './domain.js';
const h = React.createElement;
export function LabEditor({ data, id, mode = 'update', onSave, onClose }) {
  const lab = data.lab_dip.find((l) => l.id === id),
    existing = lab && mode !== 'edition',
    latest = existing ? versionsFor(data, id).at(-1) : null,
    dialog = useRef(null),
    [review, setReview] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => ({
    id: existing ? id : null,
    mode: existing ? mode : 'version',
    color_map_by_brand_id: lab?.color_map_by_brand_id || '',
    dyer_id: lab?.dyer_id || '',
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    lab_dip_status_id: data.lab_dip_version_status.find((s) => s.sort_order === 1)?.id || '',
    attached_swatch: false,
    shade_card_no: '',
    shade_card_option: '',
    comments: '',
    shade_card_image_attachment: '',
    ...(mode === 'update' && latest
      ? {
          ...latest,
          id,
          mode,
          date: latest.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        }
      : {}),
  }));
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const swatch = Boolean(draft.attached_swatch);
  const closed = existing && labClosed(data, id),
    update = (key, value) =>
      setDraft((d) => ({
        ...d,
        [key]: value,
        ...(key === 'attached_swatch' && value
          ? {
              shade_card_no: null,
              shade_card_option: null,
              lab_dip_status_id:
                data.lab_dip_version_status.find((s) => s.sort_order === 4)?.id || '',
            }
          : {}),
      }));
  const label =
    data.lab_dip_version_status.find((s) => s.id === draft.lab_dip_status_id)?.status || '—';
  const version = existing
    ? mode === 'update'
      ? latest?.version || 1
      : (latest?.version || 0) + 1
    : 1;
  const edition = existing
    ? lab.edition
    : Math.max(
        0,
        ...data.lab_dip
          .filter(
            (l) =>
              l.color_map_by_brand_id === draft.color_map_by_brand_id &&
              l.dyer_id === draft.dyer_id,
          )
          .map((l) => l.edition),
      ) + 1;
  const fields = [
    ['shade_card_no', 'Shade card number', 'text'],
    ['shade_card_option', 'Shade card option', 'text'],
  ];
  const select = (key, title, options, disabled = false, required = true) =>
    h(
      'label',
      { key },
      title,
      h(
        'select',
        {
          required,
          disabled,
          value: draft[key] || '',
          onChange: (e) => update(key, e.target.value),
        },
        h('option', { value: '' }, required ? 'Choose…' : 'Not selected'),
        options.map(([id, name]) => h('option', { key: id, value: id }, name)),
      ),
    );
  function check(e) {
    e.preventDefault();
    try {
      saveLabDip(data, draft);
      setError('');
      setReview(true);
    } catch (e) {
      setError(e.message);
    }
  }
  return h(
    'dialog',
    { ref: dialog, className: 'fabric-dialog lab-editor', onCancel: onClose },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, 'COLOURS / LAB DIPS'),
        h(
          'h2',
          null,
          review
            ? 'Review lab dip'
            : existing
              ? `Edition ${edition} · Version ${version}`
              : 'Create lab-dip edition',
        ),
      ),
      h('button', { onClick: onClose }, 'Close'),
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    closed
      ? h('p', null, 'This edition is completed. Create a new edition from its card.')
      : review
        ? h(
            'section',
            null,
            h(
              'div',
              { className: 'review-header' },
              [
                [
                  'Colour / brand',
                  (() => {
                    const l = labLabels(data, {
                      color_map_by_brand_id: draft.color_map_by_brand_id,
                      dyer_id: draft.dyer_id,
                    });
                    return `${l.name} / ${l.brand}`;
                  })(),
                ],
                [
                  'Dyer',
                  labLabels(data, {
                    color_map_by_brand_id: draft.color_map_by_brand_id,
                    dyer_id: draft.dyer_id,
                  }).dyer,
                ],
                ['Edition', edition],
                ['Version', version],
                ['Status', label],
                ['Attached swatch', swatch ? 'Yes' : 'No'],
                ['Date', draft.date || '—'],
                ['Shade card', `${draft.shade_card_no || '—'} / ${draft.shade_card_option || '—'}`],
                [
                  'Attachment',
                  draft.shade_card_image_attachment
                    ? data.attachments.find((a) => a.id === draft.shade_card_image_attachment)
                        ?.filename || 'Attached'
                    : 'Not attached',
                ],
                ['Comments', draft.comments || '—'],
              ].map(([key, value]) =>
                h('div', { key }, h('small', null, key), h('strong', null, value)),
              ),
            ),
            h(
              'p',
              null,
              labLabels(data, {
                color_map_by_brand_id: draft.color_map_by_brand_id,
                dyer_id: draft.dyer_id,
              }).name,
            ),
            h(
              'p',
              { className: 'editor-note' },
              ['Approved', 'Approved with comments', 'Attached Swatch'].includes(label)
                ? 'Saving completes and locks this edition. Further attempts need a new edition.'
                : 'This edition remains in progress.',
            ),
            h(
              'div',
              { className: 'editor-actions' },
              h('button', { onClick: () => setReview(false) }, 'Back to edit'),
              h(
                'button',
                {
                  className: 'primary',
                  disabled: busy,
                  onClick: async () => {
                    setBusy(true);
                    try {
                      await onSave(saveLabDip(data, draft));
                      onClose();
                    } catch (e) {
                      setError(e.message);
                      setBusy(false);
                    }
                  },
                },
                'Confirm & save',
              ),
            ),
          )
        : h(
            'form',
            { onSubmit: check },
            h(
              'p',
              { className: 'editor-note' },
              `Edition ${edition} · Version ${version}. Colour mapping and dyer stay fixed for the edition.`,
            ),
            h(
              'div',
              { className: 'fabric-fields' },
              select(
                'color_map_by_brand_id',
                'Colour / brand',
                data.color_map_by_brand.map((m) => [
                  m.id,
                  `${data.color_map.find((c) => c.id === m.color_map_id)?.name} / ${data.brand_list.find((b) => b.id === m.brand_list_id)?.brand}`,
                ]),
                existing,
              ),
              select(
                'dyer_id',
                'Dyer',
                data.dyer.map((d) => [
                  d.id,
                  data.contacts.find((c) => c.id === d.contacts_id)?.company_name,
                ]),
                existing,
              ),
              h(
                'label',
                { className: 'checkbox-label' },
                h('input', {
                  type: 'checkbox',
                  checked: swatch,
                  onChange: (e) => update('attached_swatch', e.target.checked),
                }),
                'Attached swatch',
              ),
              ...fields.map(([key, title, type]) =>
                h(
                  'label',
                  { key },
                  title,
                  h('input', {
                    type,
                    disabled: swatch,
                    value: draft[key] || '',
                    onChange: (e) => update(key, e.target.value),
                  }),
                ),
              ),
              !data._live &&
                select(
                  'shade_card_image_attachment',
                  'Shade-card attachment',
                  data.attachments.map((a) => [a.id, a.filename || a.id]),
                  false,
                  false,
                ),
            ),
            h(
              'div',
              { className: 'fabric-fields lab-status-fields' },
              select(
                'lab_dip_status_id',
                'Status',
                data.lab_dip_version_status.map((s) => [s.id, s.status]),
                swatch,
              ),
              h(
                'label',
                null,
                'Date',
                h('input', {
                  type: 'date',
                  required: true,
                  value: draft.date,
                  onChange: (e) => update('date', e.target.value),
                }),
              ),
            ),
            h(
              'label',
              null,
              'Comments',
              h('textarea', {
                value: draft.comments,
                onChange: (e) => update('comments', e.target.value),
              }),
            ),
            h(
              'p',
              { className: 'editor-note' },
              'When Attached swatch is checked, shade card number and option are cleared and unavailable.',
            ),
            h(
              'div',
              { className: 'editor-actions' },
              h('button', { type: 'button', onClick: onClose }, 'Cancel'),
              h('button', { className: 'primary', type: 'submit' }, 'Review →'),
            ),
          ),
  );
}
