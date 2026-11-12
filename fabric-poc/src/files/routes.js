import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import { RecordGrid } from '../fabric/record-grid.js';
import React, { useState } from 'react';
import { prettyBytes } from './model.js';
const h = React.createElement;
const types = [
  ['application/pdf', 'PDF'],
  ['image/jpeg', 'JPEG'],
  ['image/png', 'PNG'],
  ['image/webp', 'WebP'],
];
export function UploadRoutes({ routes, registry, onSave, preferenceClient }) {
  const [edit, setEdit] = useState(null);
  const review = useSaveReview();
  function submit() {
    const prior = routes.find((route) => route.key === edit.key);
    const groupLabel = (id) => registry.find((group) => group.id === id)?.group;
    const changed = (before, after) =>
      before != null && before !== after ? before + ' → ' + after : after;
    review.prepare(
      edit,
      [
        ['Attachment field', edit.label],
        ['Source', edit.table + '.' + edit.slot],
        [
          'Bucket group',
          changed(groupLabel(prior?.bucket_group_id), groupLabel(edit.bucket_group_id)),
        ],
        ['File types', changed(prior?.mime?.join(', '), edit.mime.join(', '))],
        [
          'Maximum file size',
          changed(prior && prettyBytes(prior.max_bytes), prettyBytes(edit.max_bytes)),
        ],
        [
          'Uploads',
          changed(
            prior && (prior.enabled ? 'Enabled' : 'Paused'),
            edit.enabled ? 'Enabled' : 'Paused',
          ),
        ],
      ],
      async (payload) => {
        await onSave(payload);
        setEdit(null);
      },
      'Review upload route',
    );
  }
  return h(
    'section',
    { className: 'bucket-settings upload-routes' },
    h(
      'div',
      { className: 'fabric-actions' },
      h('h2', null, 'Upload routes'),
      h('span', null, `${routes.length} attachment fields`),
    ),
    h(
      'p',
      { className: 'file-help' },
      'Choose where each attachment field uploads. These rules apply to new uploads; existing files keep their original locations. Source fields and access rules are registered integrations.',
    ),
    edit
      ? h(
          ReviewForm,
          { review, onSubmit: submit },
          h('h3', null, edit.label),
          h('p', { className: 'route-source' }, `garments_erp.${edit.table} → ${edit.slot}`),
          h(
            'div',
            { className: 'fabric-fields' },
            h(
              'label',
              null,
              'Destination bucket group',
              h(
                'select',
                {
                  value: edit.bucket_group_id,
                  onChange: (e) => setEdit((v) => ({ ...v, bucket_group_id: e.target.value })),
                },
                registry.map((g) =>
                  h('option', { key: g.id, value: g.id }, `${g.group} · ${g.bucket_id}`),
                ),
              ),
            ),
            h(
              'label',
              null,
              'Per-file size limit',
              h(
                'select',
                {
                  value: edit.max_bytes,
                  onChange: (e) => setEdit((v) => ({ ...v, max_bytes: Number(e.target.value) })),
                },
                [1, 2, 5, 10].map((n) =>
                  h(
                    'option',
                    {
                      key: n,
                      value: n * 1048576,
                      disabled:
                        n * 1048576 >
                        Number(registry.find((g) => g.id === edit.bucket_group_id)?.max_bytes || 0),
                    },
                    `${n} MB`,
                  ),
                ),
              ),
            ),
          ),
          h(
            'fieldset',
            { className: 'route-file-types' },
            h('legend', null, 'Allowed file types'),
            types.map(([mime, label]) =>
              h(
                'label',
                { key: mime },
                h('input', {
                  type: 'checkbox',
                  checked: edit.mime.includes(mime),
                  disabled:
                    ['itemImage', 'labDipShade'].includes(edit.key) && mime === 'application/pdf',
                  onChange: (e) =>
                    setEdit((v) => ({
                      ...v,
                      mime: e.target.checked ? [...v.mime, mime] : v.mime.filter((m) => m !== mime),
                    })),
                }),
                label,
              ),
            ),
          ),
          h(
            'label',
            { className: 'access-check' },
            h('input', {
              type: 'checkbox',
              checked: edit.enabled,
              onChange: (e) => setEdit((v) => ({ ...v, enabled: e.target.checked })),
            }),
            'Allow new uploads',
          ),
          h(
            'div',
            { className: 'editor-actions' },
            h(
              'button',
              {
                type: 'button',
                disabled: review.busy,
                onClick: () => {
                  setEdit(null);
                },
              },
              'Cancel',
            ),
            h(
              'button',
              { type: 'submit', className: 'primary', disabled: review.busy || !edit.mime.length },
              'Review upload route',
            ),
          ),
        )
      : h(
          'div',
          { className: 'permission-scroll' },
          h(
            RecordGrid,
            {
              client: preferenceClient,
              grid: 'files-upload-routes',
              fields: [
                ['source', 'Attachment source'],
                ['bucket', 'Bucket group / bucket'],
                ['types', 'Allowed files'],
                ['limit', 'Per file'],
                ['status', 'Status'],
              ],
            },
            h(
              'tbody',
              null,
              routes.map((r) => {
                const g = registry.find((g) => g.id === r.bucket_group_id);
                return h(
                  'tr',
                  { key: r.key },
                  h(
                    'td',
                    null,
                    h('strong', null, r.label),
                    h('small', null, `garments_erp.${r.table}`),
                    h('small', null, r.slot),
                  ),
                  h(
                    'td',
                    null,
                    h('strong', null, g?.group || 'Missing group'),
                    h('small', null, g?.bucket_id),
                  ),
                  h(
                    'td',
                    null,
                    r.mime.map((m) => types.find((t) => t[0] === m)?.[1] || m).join(', '),
                  ),
                  h('td', null, prettyBytes(Math.min(r.max_bytes, g?.max_bytes || r.max_bytes))),
                  h('td', null, r.enabled ? 'Enabled' : 'Paused'),
                  h(
                    'td',
                    null,
                    h(
                      'button',
                      {
                        onClick: () => {
                          setEdit({ ...r, mime: [...r.mime] });
                        },
                      },
                      'Edit route',
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
  );
}
