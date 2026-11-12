import { AdminDialog } from '../admin/dialog.js';
import { GridSearch, GridSort, useGridSearch } from '../fabric/grid-toolbar.js';
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
const fields = [
  ['source', 'Attachment source'],
  ['bucket', 'Bucket group'],
  ['types', 'Allowed files'],
  ['limit', 'Per file'],
  ['status', 'Status'],
];

export function UploadRoutes({ routes, registry, onSave, preferenceClient }) {
  const [edit, setEdit] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState({ key: 'source', direction: 'asc' });
  const query = useGridSearch(search).trim().toLowerCase();
  const shown = routes
    .map((record) => {
      const group = registry.find((g) => g.id === record.bucket_group_id);
      return {
        source: record.label,
        bucket: group?.group || 'Missing group',
        types: record.mime.map((m) => types.find((t) => t[0] === m)?.[1] || m).join(', '),
        limit: Math.min(record.max_bytes, group?.max_bytes || record.max_bytes),
        status: record.enabled ? 'Enabled' : 'Paused',
        record,
      };
    })
    .filter((r) => [r.source, r.bucket].some((value) => value?.toLowerCase().includes(query)))
    .sort(
      (a, b) =>
        (sort.direction === 'asc' ? 1 : -1) *
        String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }),
    );
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(edit);
      setEdit(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    { className: 'bucket-settings upload-routes' },
    h('h2', null, 'Upload routes'),
    h(
      'p',
      { className: 'file-help' },
      'Changes apply to new uploads. Existing files stay in their original locations.',
    ),
    h(
      'div',
      { className: 'fabric-actions worksheet-actions admin-toolbar' },
      h(GridSearch, { label: 'Search upload routes', value: search, onChange: setSearch }),
    ),
    h(GridSort, {
      columns: fields.map(([key, label]) => ({ key, label })),
      sort,
      onSort: setSort,
      rowCount: shown.length,
    }),
    edit &&
      h(
        AdminDialog,
        { title: edit.label, onClose: () => !busy && setEdit(null) },
        h(
          'form',
          { onSubmit: submit },
          error && h('p', { role: 'alert', className: 'form-error' }, error),
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
                registry.map((g) => h('option', { key: g.id, value: g.id }, g.group)),
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
                disabled: busy,
                onClick: () => {
                  setEdit(null);
                  setError('');
                },
              },
              'Cancel',
            ),
            h(
              'button',
              { type: 'submit', className: 'primary', disabled: busy || !edit.mime.length },
              busy ? 'Saving…' : 'Save upload route',
            ),
          ),
        ),
      ),
    h(
      'div',
      { className: 'admin-records' },
      h(
        RecordGrid,
        {
          client: preferenceClient,
          grid: 'files-upload-routes',
          fields,
        },
        h(
          'tbody',
          null,
          shown.map(({ record: r, source, bucket, types, limit, status }) => {
            return h(
              'tr',
              { key: r.key },
              h('td', null, h('strong', null, source)),
              h('td', null, bucket),
              h('td', null, types || '—'),
              h('td', null, prettyBytes(limit)),
              h('td', null, status),
              h(
                'td',
                null,
                h(
                  'button',
                  {
                    onClick: () => {
                      setError('');
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
    !shown.length &&
      h(
        'div',
        { className: 'empty-state' },
        query ? 'No upload routes match your search.' : 'No upload routes configured.',
      ),
  );
}
