import { getAccessClient } from '../access/client.js';
import { RecordAttachmentField, useRecordAttachments } from '../files/record-attachments.js';
import { FabricRequirementFields } from '../fabric/requirement-fields.js';
import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import React, { useEffect, useRef, useState } from 'react';
import { pages } from '../fabric/catalog.js';
import { documentFor, saveDocument, optionsFor } from '../fabric/domain.js';
import { checklistColumns } from './live.js';
const h = React.createElement;
// Item-owned children are edited here; shared variants and image files keep their own write boundaries.
export function ProductionItemEditor({ data, id, onSave, onClose, canEditFiles, onFilesSaved }) {
  const dialog = useRef(null);
  const [header, setHeader] = useState(() => documentFor(data, 'productionItems', id).header);
  const [sizes, setSizes] = useState(() =>
    data.item_size_list
      .filter((s) => s.item_id === id)
      .map((s) => ({
        ...s,
        pieces: data.item_cut_ratio.find((r) => r.item_size_list_id === s.id)?.pieces ?? '',
      })),
  );
  const [links, setLinks] = useState(() =>
    data.variant_item
      .filter((v) => data.item_part.some((p) => p.id === v.item_part_id && p.item_id === id))
      .map((v) => ({
        ...v,
        part_list_id: data.item_part.find((p) => p.id === v.item_part_id).part_list_id,
      })),
  );
  const [parents, setParents] = useState(() => {
    const parts = data.item_part.filter((part) => part.item_id === id);
    return Object.fromEntries(
      parts.map((part) => [
        part.part_list_id,
        parts.find(({ id }) => id === part.parent_item_part_id)?.part_list_id ?? '',
      ]),
    );
  });
  const [requirements, setRequirements] = useState(() =>
    (data.item_part_fabric || []).filter((f) =>
      data.variant_item.some(
        (v) =>
          v.id === f.variant_item_id &&
          data.item_part.some((p) => p.id === v.item_part_id && p.item_id === id),
      ),
    ),
  );
  const fabricOptions = {
    fabrics: (data.fabric_type || []).map((f) => [f.id, f.name]),
    parts: (data.sub_part_list || []).map((p) => [p.id, p.part]),
    labs: (data.lab_dip || [])
      .filter((l) =>
        data.color_map_by_brand?.some(
          (m) => m.id === l.color_map_by_brand_id && m.brand_list_id === header.brand_id,
        ),
      )
      .map((l) => [
        l.id,
        `${data.color_map?.find((c) => c.id === data.color_map_by_brand?.find((m) => m.id === l.color_map_by_brand_id)?.color_map_id)?.name || 'Lab dip'} · Edition ${l.edition}`,
      ]),
    statuses: (data.item_part_fabric_status || []).map((s) => [s.id, s.type]),
  };
  const [checklist, setChecklist] = useState(
    () => data.production_checklist.find((c) => c.item_id === id) || {},
  );
  const [error, setError] = useState('');
  const review = useSaveReview();
  const reviewedFiles = useRef(null);
  review.locked = reviewedFiles.current?.saved;
  const fileClient = getAccessClient();
  const attachments = useRecordAttachments(fileClient);
  const { busy } = review;
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const select = (label, value, rows, change, required = true) =>
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
          onChange: (e) => change(e.target.value),
        },
        h('option', { value: '' }, 'Choose\u2026'),
        rows.map(([key, name]) => h('option', { key, value: key }, name)),
      ),
    );
  function submit(e) {
    e.preventDefault();
    try {
      setError('');
      if (!sizes.length || !links.length) throw Error('Add sizes and at least one variant / part.');
      if (new Set(sizes.map((s) => s.size_list_id)).size !== sizes.length)
        throw Error('Select each size once.');
      if (new Set(links.map((l) => `${l.variant_id}:${l.part_list_id}`)).size !== links.length)
        throw Error('Select each variant / part combination once.');
      const next = saveDocument(data, 'productionItems', { header, lines: [] });
      const itemId = id || next.item.at(-1).id;
      const oldParts = data.item_part.filter((p) => p.item_id === id);
      const oldSizes = data.item_size_list.filter((s) => s.item_id === id);
      const oldLinks = data.variant_item.filter((v) =>
        oldParts.some((p) => p.id === v.item_part_id),
      );
      const parts = [...new Set(links.map((l) => l.part_list_id))].map(
        (part) =>
          oldParts.find((p) => p.part_list_id === part) || {
            id: crypto.randomUUID(),
            item_id: itemId,
            part_list_id: part,
          },
      );
      const byType = new Map(parts.map((part) => [part.part_list_id, part]));
      const sortedParts = new Map();
      function addPart(part, pending = new Set()) {
        if (sortedParts.has(part.id)) return;
        if (pending.has(part.id)) throw Error('Part parents cannot form a cycle.');
        const parentType = parents[part.part_list_id];
        const parent = byType.get(parentType);
        if (parentType && !parent)
          throw Error('Keep the parent part or clear its dependent relationship.');
        if (parent) addPart(parent, new Set([...pending, part.id]));
        sortedParts.set(part.id, { ...part, parent_item_part_id: parent?.id ?? null });
      }
      for (const part of parts) addPart(part);
      const allocations = sizes.map((s) => {
        const pieces = Number(s.pieces);
        if (String(s.pieces).trim() === '' || !Number.isSafeInteger(pieces) || pieces < 0)
          throw Error('Enter whole non-negative pieces for every size.');
        return {
          id: oldSizes.find((r) => r.size_list_id === s.size_list_id)?.id || crypto.randomUUID(),
          item_id: itemId,
          size_list_id: s.size_list_id,
          pieces,
        };
      });
      next.item_part = [...data.item_part.filter((p) => p.item_id !== id), ...sortedParts.values()];
      next.item_size_list = [
        ...data.item_size_list.filter((s) => s.item_id !== id),
        ...allocations.map(({ pieces: _, ...s }) => s),
      ];
      next.item_cut_ratio = [
        ...data.item_cut_ratio.filter((r) => !oldSizes.some((s) => s.id === r.item_size_list_id)),
        ...allocations.map((s) => ({
          id:
            data.item_cut_ratio.find((r) => r.item_size_list_id === s.id)?.id ||
            crypto.randomUUID(),
          item_size_list_id: s.id,
          pieces: s.pieces,
        })),
      ];
      next.variant_item = [
        ...data.variant_item.filter((v) => !oldLinks.some((r) => r.id === v.id)),
        ...links.map((l) => {
          const part = parts.find((p) => p.part_list_id === l.part_list_id);
          return {
            id:
              oldLinks.find((r) => r.variant_id === l.variant_id && r.item_part_id === part.id)
                ?.id || (/^[0-9a-f-]{36}$/.test(l.id || '') ? l.id : crypto.randomUUID()),
            item_part_id: part.id,
            variant_id: l.variant_id,
          };
        }),
      ];
      const variantIds = new Set(
        next.variant_item
          .filter((v) => parts.some((p) => p.id === v.item_part_id))
          .map((v) => v.id),
      );
      if (requirements.some((f) => !variantIds.has(f.variant_item_id)))
        throw Error('Remove fabric sub-parts before removing their variant / production part.');
      if (requirements.some((f) => !(Number(f.consumption_per_piece_kg) > 0)))
        throw Error('Enter positive decimal kg per piece for every fabric sub-part.');
      next.item_part_fabric = [
        ...(data.item_part_fabric || []).filter(
          (f) => !oldLinks.some((v) => v.id === f.variant_item_id),
        ),
        ...requirements.map((f) => ({
          ...f,
          consumption_per_piece_kg: Number(f.consumption_per_piece_kg),
        })),
      ];
      next.production_checklist = [
        ...data.production_checklist.filter((c) => c.item_id !== id),
        {
          id: checklist.id || crypto.randomUUID(),
          item_id: itemId,
          ...Object.fromEntries(
            Object.values(checklistColumns).map((key) => [key, checklist[key] || null]),
          ),
        },
      ];
      const prior = data.item.find((item) => item.id === id);
      const item = next.item.find((item) => item.id === itemId);
      const change = (before, after) =>
        prior && String(before ?? '') !== String(after ?? '')
          ? (before ?? '—') + ' → ' + (after ?? '—')
          : after;
      const reviewRows = [
        ...pages.productionItems.header
          .filter(({ key }) => key !== 'image_attachment')
          .map((field) => {
            const describe = (value) =>
              field.type === 'select' && value
                ? (optionsFor(data, field.source).find(([key]) => key === value)?.[1] ?? value)
                : value;
            return [field.label, change(describe(prior?.[field.key]), describe(item[field.key]))];
          }),
        ...allocations.map((size) => [
          data.size_list.find(({ id }) => id === size.size_list_id)?.size ?? size.size_list_id,
          change(
            data.item_cut_ratio.find((row) => row.item_size_list_id === size.id)?.pieces,
            size.pieces,
          ),
        ]),
        ...oldSizes
          .filter((size) => !allocations.some(({ id }) => id === size.id))
          .map((size) => [
            'Remove size',
            data.size_list.find(({ id }) => id === size.size_list_id)?.size,
          ]),
        ...links.map((link) => [
          'Variant / part',
          [
            data.variant.find(({ id }) => id === link.variant_id)?.variant_name ?? link.variant_id,
            data.part_list.find(({ id }) => id === link.part_list_id)?.part,
          ]
            .filter(Boolean)
            .join(' · '),
        ]),
        ...[...sortedParts.values()].map((part) => [
          `${data.part_list.find(({ id }) => id === part.part_list_id)?.part} · Parent part`,
          change(
            data.part_list.find(
              ({ id }) =>
                id ===
                oldParts.find(
                  (p) => p.id === oldParts.find((r) => r.id === part.id)?.parent_item_part_id,
                )?.part_list_id,
            )?.part,
            data.part_list.find(({ id }) => id === parents[part.part_list_id])?.part ??
              'Independent',
          ),
        ]),
        ...Object.entries(checklistColumns).map(([label, key]) => [
          label,
          change(
            data.production_checklist.find((row) => row.item_id === id)?.[key],
            checklist[key],
          ),
        ]),
      ];
      for (const f of requirements)
        reviewRows.push([
          'Fabric sub-part',
          [
            data.variant.find(
              (v) => v.id === links.find((l) => l.id === f.variant_item_id)?.variant_id,
            )?.variant_name,
            data.part_list.find(
              (p) => p.id === links.find((l) => l.id === f.variant_item_id)?.part_list_id,
            )?.part,
            f.sub_part_name || 'Unnamed',
            fabricOptions.parts.find(([id]) => id === f.sub_part_list_id)?.[1] ||
              'Unspecified type',
            fabricOptions.fabrics.find(([id]) => id === f.fabric_type_id)?.[1],
            fabricOptions.labs.find(([id]) => id === f.lab_dip_id)?.[1] || 'No lab dip',
            `${f.consumption_per_piece_kg} kg / piece`,
            fabricOptions.statuses.find(([id]) => id === f.item_part_fabric_status_id)?.[1] ||
              'Automatic',
          ]
            .filter(Boolean)
            .join(' · '),
        ]);
      for (const f of (data.item_part_fabric || []).filter(
        (f) =>
          oldLinks.some((v) => v.id === f.variant_item_id) &&
          !requirements.some((r) => r.id === f.id),
      ))
        reviewRows.push(['Remove fabric sub-part', f.sub_part_name || f.id]);
      const files = attachments.prepare();
      reviewedFiles.current = files;
      review.prepare(
        next,
        [...reviewRows, ...files.rows],
        async (payload) => {
          await files.confirm(() => onSave(payload));
          if (files.rows.length) await onFilesSaved();
          onClose();
        },
        'Review production item',
      );
    } catch (cause) {
      setError(cause.message);
    }
  }
  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog production-editor',
      onCancel: (event) => {
        if (busy) event.preventDefault();
        else onClose();
      },
    },
    h(
      'header',
      { className: 'editor-heading' },
      h('h2', null, review.pending ? 'Review item' : id ? 'Edit item' : 'Create item'),
      h('button', { type: 'button', disabled: busy, onClick: onClose }, 'Close'),
    ),
    h(
      ReviewForm,
      { review, onSubmit: submit },
      h(
        'section',
        null,
        h('h3', null, 'Item details'),
        h(
          'div',
          { className: 'fabric-fields' },
          pages.productionItems.header
            .filter((f) => f.key !== 'image_attachment')
            .map((f) =>
              f.type === 'select'
                ? h(
                    'span',
                    { key: f.key },
                    select(
                      f.label,
                      header[f.key],
                      optionsFor(data, f.source),
                      (value) => setHeader({ ...header, [f.key]: value }),
                      f.required !== false,
                    ),
                  )
                : h(
                    'label',
                    { key: f.key },
                    f.label,
                    h('input', {
                      'aria-label': f.label,
                      required: f.required !== false,
                      type: f.type === 'number' ? 'number' : 'text',
                      min: f.type === 'number' ? 0 : void 0,
                      step: f.type === 'number' ? 'any' : void 0,
                      value: header[f.key] ?? '',
                      onChange: (e) => setHeader({ ...header, [f.key]: e.target.value }),
                    }),
                  ),
            ),
        ),
        h(RecordAttachmentField, {
          attachments,
          client: fileClient,
          targetKey: 'itemImage',
          recordId: id,
          canWrite: canEditFiles,
        }),
      ),
      h(
        'section',
        null,
        h('h3', null, 'Size allocations'),
        sizes.map((s, i) =>
          h(
            'div',
            { className: 'fabric-fields', key: i },
            select(
              `Size ${i + 1}`,
              s.size_list_id,
              data.size_list.map((r) => [r.id, r.size]),
              (value) =>
                setSizes(sizes.map((r, n) => (n === i ? { ...r, size_list_id: value } : r))),
            ),
            h(
              'label',
              null,
              'Pieces',
              h('input', {
                'aria-label': `Pieces ${i + 1}`,
                type: 'number',
                min: '0',
                step: '1',
                required: true,
                value: s.pieces,
                onChange: (e) =>
                  setSizes(sizes.map((r, n) => (n === i ? { ...r, pieces: e.target.value } : r))),
              }),
            ),
            h(
              'button',
              { type: 'button', onClick: () => setSizes(sizes.filter((_, n) => n !== i)) },
              'Remove size',
            ),
          ),
        ),
        h(
          'button',
          { type: 'button', onClick: () => setSizes([...sizes, { size_list_id: '', pieces: '' }]) },
          'Add size',
        ),
      ),
      h(
        'section',
        null,
        h('h3', null, 'Production parts and variants'),
        h(
          'p',
          null,
          'Create shared variants in Variants, then select them here. Each variant has an equal share.',
        ),
        links.map((l, i) =>
          h(
            'div',
            { className: 'fabric-fields', key: i },
            select(
              `Variant ${i + 1}`,
              l.variant_id,
              data.variant.map((v) => [v.id, v.variant_name || v.id]),
              (value) => setLinks(links.map((r, n) => (n === i ? { ...r, variant_id: value } : r))),
            ),
            select(
              `Part ${i + 1}`,
              l.part_list_id,
              data.part_list.map((p) => [p.id, p.part]),
              (value) =>
                setLinks(links.map((r, n) => (n === i ? { ...r, part_list_id: value } : r))),
            ),
            h(
              'button',
              { type: 'button', onClick: () => setLinks(links.filter((_, n) => n !== i)) },
              'Remove variant / part',
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () =>
              setLinks([...links, { id: crypto.randomUUID(), variant_id: '', part_list_id: '' }]),
          },
          'Add variant / part',
        ),
        h(
          'div',
          { className: 'fabric-fields' },
          [...new Set(links.map((link) => link.part_list_id).filter(Boolean))].map((part) => {
            const name = data.part_list.find(({ id }) => id === part)?.part;
            const choices = data.part_list
              .filter(({ id }) => id !== part && links.some((row) => row.part_list_id === id))
              .map(({ id, part }) => [id, part]);
            return h(
              'div',
              { key: part },
              select(
                `Parent of ${name}`,
                parents[part],
                choices,
                (value) => setParents({ ...parents, [part]: value }),
                false,
              ),
            );
          }),
        ),
      ),
      h(
        'section',
        null,
        h('h3', null, 'Fabric consumption'),
        h(
          'p',
          null,
          'Fabric sub-parts do not create production jobs. Consumption is kg per planned piece.',
        ),
        requirements.map((f, i) =>
          h(
            'div',
            { key: f.id },
            h(
              'div',
              { className: 'fabric-fields' },
              select(
                `Sub-part variant / production part ${i + 1}`,
                f.variant_item_id,
                links
                  .filter((l) => l.id)
                  .map((l) => [
                    l.id,
                    `${data.variant.find((v) => v.id === l.variant_id)?.variant_name || 'Variant'} · ${data.part_list.find((p) => p.id === l.part_list_id)?.part || 'Part'}`,
                  ]),
                (value) =>
                  setRequirements(
                    requirements.map((r) => (r.id === f.id ? { ...r, variant_item_id: value } : r)),
                  ),
              ),
            ),
            h(FabricRequirementFields, {
              prefix: `item-component-${f.id}`,
              row: f,
              options: fabricOptions,
              onChange: (row) =>
                setRequirements(requirements.map((r) => (r.id === f.id ? row : r))),
            }),
            h(
              'p',
              null,
              'Saved status: ',
              fabricOptions.statuses.find(
                ([id]) =>
                  id ===
                  (data.fabric_requirement_statuses || []).find((r) => r.id === f.id)?.status_id,
              )?.[1] || 'Not ordered',
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => setRequirements(requirements.filter((r) => r.id !== f.id)),
              },
              'Remove fabric sub-part',
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: !links.length,
            onClick: () =>
              setRequirements([
                ...requirements,
                {
                  id: crypto.randomUUID(),
                  variant_item_id: links[0]?.id,
                  fabric_type_id: '',
                  sub_part_list_id: null,
                  sub_part_name: '',
                  lab_dip_id: null,
                  consumption_per_piece_kg: '',
                  item_part_fabric_status_id: null,
                },
              ]),
          },
          'Add fabric sub-part',
        ),
      ),
      h(
        'section',
        null,
        h('h3', null, 'Production checklist'),
        h(
          'div',
          { className: 'fabric-fields' },
          Object.entries(checklistColumns).map(([label, key]) =>
            h(
              'span',
              { key },
              select(
                label,
                checklist[key],
                data.item_status_list.map((s) => [s.id, s.status]),
                (value) => setChecklist({ ...checklist, [key]: value }),
                false,
              ),
            ),
          ),
        ),
      ),
      error && h('p', { role: 'alert', className: 'form-error' }, error),
      h(
        'footer',
        { className: 'editor-actions' },
        h('button', { type: 'button', onClick: onClose }, 'Cancel'),
        h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Review item'),
      ),
    ),
  );
}
