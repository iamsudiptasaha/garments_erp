import React, { useEffect, useRef, useState } from 'react';
import { pages } from '../fabric/catalog.js';
import { documentFor, saveDocument, optionsFor } from '../fabric/domain.js';
import { itemSetup, saveItemSetup, allocatePieces, checklistFields } from './item-model.js';
const h = React.createElement;
export function ItemEditor({ data, id, onSave, onClose }) {
  const dialog = useRef(null),
    [draft, setDraft] = useState(() => documentFor(data, 'productionItems', id)),
    [setup, setSetup] = useState(() => {
      const s = itemSetup(data, id);
      return {
        ...s,
        sizes: s.sizes.length ? s.sizes : [{ size_list_id: '', pieces: '' }],
        variants: s.variants.length
          ? s.variants
          : [{ name: '', share_weight: 1, parts: [{ part_list_id: '', lab_dip_id: '' }] }],
      };
    }),
    [review, setReview] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const pick = (label, value, options, onChange, required = true) =>
    h(
      'label',
      null,
      label,
      h(
        'select',
        {
          'aria-label': label,
          value: value || '',
          required,
          onChange: (e) => onChange(e.target.value),
        },
        h('option', { value: '' }, required ? 'Choose…' : 'Not selected'),
        options.map(([key, name]) => h('option', { key, value: key }, name)),
      ),
    );
  const changeVariant = (index, fn) =>
    setSetup((s) => ({ ...s, variants: s.variants.map((v, i) => (i === index ? fn(v) : v)) }));
  function result() {
    const next = saveDocument(data, 'productionItems', draft);
    return saveItemSetup(next, id || next.item.at(-1).id, setup);
  }
  function submit(e) {
    e.preventDefault();
    try {
      result();
      setError('');
      setReview(true);
    } catch (e) {
      setError(e.message);
    }
  }
  function labOptions() {
    return (data.lab_dip || [])
      .filter(
        (l) =>
          data.color_map_by_brand.find((m) => m.id === l.color_map_by_brand_id)?.brand_list_id ===
          draft.header.brand_id,
      )
      .map((l) => {
        const m = data.color_map_by_brand.find((m) => m.id === l.color_map_by_brand_id),
          dyer = data.dyer.find((d) => d.id === l.dyer_id);
        return [
          l.id,
          `${data.color_map.find((c) => c.id === m.color_map_id)?.name} · ${data.contacts.find((c) => c.id === dyer?.contacts_id)?.company_name} · Edition ${l.edition}`,
        ];
      });
  }
  const checklistInputs = h(
    'section',
    null,
    h('h3', null, '4 · Production checklist'),
    h(
      'div',
      { className: 'fabric-fields' },
      checklistFields.map(([key, label]) =>
        pick(
          label,
          setup.checklist?.[key],
          data.item_status_list.map((s) => [s.id, s.status]),
          (value) => setSetup((s) => ({ ...s, checklist: { ...s.checklist, [key]: value } })),
          false,
        ),
      ),
    ),
  );
  const name = (table, key, field) => data[table].find((r) => r.id === key)?.[field] || '—';
  return h(
    'dialog',
    { ref: dialog, className: 'fabric-dialog production-editor', onCancel: onClose },
    h(
      'div',
      { className: 'editor-heading' },
      h('h2', null, review ? 'Review item' : id ? 'Edit complete item' : 'Create item'),
      h('button', { onClick: onClose }, 'Close'),
    ),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    review
      ? h(
          'section',
          null,
          h(
            'div',
            { className: 'item-review-root' },
            h('h3', null, draft.header.style_code),
            h('p', null, draft.header.product_description),
            h(
              'div',
              { className: 'item-size-summary' },
              setup.sizes.map((s) =>
                h(
                  'span',
                  { key: s.size_list_id },
                  `${name('size_list', s.size_list_id, 'size')} · ${s.pieces} pcs`,
                ),
              ),
            ),
            h('button', { onClick: () => setReview(false) }, 'Edit details & sizes'),
          ),
          h('div', { className: 'item-review-connector' }),
          h(
            'div',
            { className: 'item-variant-grid' },
            setup.variants.map((v, i) =>
              h(
                'article',
                { className: 'item-variant-card', key: i },
                h('small', null, 'VARIANT'),
                h('h3', null, v.name),
                h(
                  'div',
                  { className: 'item-size-summary' },
                  setup.sizes.map((s) =>
                    h(
                      'span',
                      { key: s.size_list_id },
                      `${name('size_list', s.size_list_id, 'size')}: ${
                        allocatePieces(
                          s.pieces,
                          setup.variants.map(() => 1),
                        )[i]
                      } pcs`,
                    ),
                  ),
                ),
                v.parts.map((p, j) =>
                  h(
                    'div',
                    { className: 'item-review-part', key: j },
                    h('strong', null, name('part_list', p.part_list_id, 'part')),
                    h(
                      'p',
                      null,
                      'Lab dip: ' +
                        (p.lab_dip_id
                          ? labOptions().find(([key]) => key === p.lab_dip_id)?.[1] || 'Selected'
                          : 'Not selected'),
                    ),
                  ),
                ),
                h('button', { onClick: () => setReview(false) }, 'Edit variant & parts'),
              ),
            ),
          ),
          h(
            'p',
            { className: 'editor-note' },
            'Pieces are split equally across variants. Any remaining whole pieces go in card order; size totals stay unchanged.',
          ),
          h(
            'div',
            { className: 'review-header' },
            checklistFields.map(([key, label]) =>
              h(
                'div',
                { key },
                h('small', null, label),
                h('strong', null, name('item_status_list', setup.checklist?.[key], 'status')),
              ),
            ),
          ),
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { onClick: () => setReview(false) }, 'Back to edit'),
            h(
              'button',
              {
                className: 'primary',
                onClick: () => {
                  try {
                    onSave(result());
                    onClose();
                  } catch (e) {
                    setError(e.message);
                  }
                },
              },
              'Confirm & save item',
            ),
          ),
        )
      : h(
          'form',
          { onSubmit: submit },
          h('h3', null, '1 · Item details'),
          h(
            'div',
            { className: 'fabric-fields' },
            pages.productionItems.header.map((f) =>
              f.type === 'select'
                ? pick(
                    f.label,
                    draft.header[f.key],
                    optionsFor(data, f.source),
                    (value) => setDraft((d) => ({ ...d, header: { ...d.header, [f.key]: value } })),
                    f.required !== false,
                  )
                : h(
                    'label',
                    { key: f.key },
                    f.label,
                    h('input', {
                      type: f.type,
                      value: draft.header[f.key] ?? '',
                      required: f.required !== false,
                      onChange: (e) =>
                        setDraft((d) => ({
                          ...d,
                          header: { ...d.header, [f.key]: e.target.value },
                        })),
                    }),
                  ),
            ),
          ),
          h('h3', null, '2 · Size set & pieces'),
          h(
            'p',
            { className: 'editor-note' },
            'Sizes and cutting pieces apply to the item, across its variants.',
          ),
          setup.sizes.map((s, i) =>
            h(
              'div',
              { className: 'fabric-fields', key: i },
              pick(
                'Size ' + (i + 1),
                s.size_list_id,
                data.size_list.map((s) => [s.id, s.size]),
                (value) =>
                  setSetup((all) => ({
                    ...all,
                    sizes: all.sizes.map((s, j) => (j === i ? { ...s, size_list_id: value } : s)),
                  })),
              ),
              h(
                'label',
                null,
                'Pieces',
                h('input', {
                  type: 'number',
                  required: true,
                  min: 0,
                  step: 1,
                  value: s.pieces,
                  onChange: (e) =>
                    setSetup((all) => ({
                      ...all,
                      sizes: all.sizes.map((s, j) =>
                        j === i ? { ...s, pieces: e.target.value } : s,
                      ),
                    })),
                }),
              ),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () =>
                setSetup((s) => ({ ...s, sizes: [...s.sizes, { size_list_id: '', pieces: '' }] })),
            },
            '+ Add size',
          ),
          h(
            'div',
            { className: 'line-heading' },
            h('h3', null, '3 · Variants & parts'),
            h(
              'button',
              {
                type: 'button',
                onClick: () =>
                  setSetup((s) => ({
                    ...s,
                    variants: [
                      ...s.variants,
                      { name: '', share_weight: 1, parts: [{ part_list_id: '', lab_dip_id: '' }] },
                    ],
                  })),
              },
              '+ Add variant',
            ),
          ),
          h(
            'div',
            { className: 'item-variant-grid' },
            setup.variants.map((v, i) =>
              h(
                'section',
                { key: i, className: 'item-variant-card' },
                h(
                  'label',
                  null,
                  'Variant name',
                  h('input', {
                    required: true,
                    value: v.name,
                    onChange: (e) => changeVariant(i, (v) => ({ ...v, name: e.target.value })),
                  }),
                ),
                v.parts.map((p, j) =>
                  h(
                    'div',
                    { className: 'item-part-inputs', key: j },
                    pick(
                      'Item part',
                      p.part_list_id,
                      data.part_list.map((p) => [p.id, p.part]),
                      (value) =>
                        changeVariant(i, (v) => ({
                          ...v,
                          parts: v.parts.map((p, k) =>
                            k === j ? { ...p, part_list_id: value } : p,
                          ),
                        })),
                    ),
                    pick(
                      'Lab dip / edition',
                      p.lab_dip_id,
                      labOptions(),
                      (value) =>
                        changeVariant(i, (v) => ({
                          ...v,
                          parts: v.parts.map((p, k) => (k === j ? { ...p, lab_dip_id: value } : p)),
                        })),
                      false,
                    ),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () =>
                      changeVariant(i, (v) => ({
                        ...v,
                        parts: [...v.parts, { part_list_id: '', lab_dip_id: '' }],
                      })),
                  },
                  '+ Add part',
                ),
              ),
            ),
          ),
          checklistInputs,
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { type: 'button', onClick: onClose }, 'Cancel'),
            h('button', { type: 'submit', className: 'primary' }, 'Review item →'),
          ),
        ),
  );
}
