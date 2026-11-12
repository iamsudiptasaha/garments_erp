import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import { AdminDialog } from '../admin/dialog.js';
import { GridSearch, GridSort, useGridSearch } from '../fabric/grid-toolbar.js';
import { RecordGrid } from '../fabric/record-grid.js';
import React, { useState } from 'react';
import { FILE_GROUPS, prettyBytes } from './model.js';
import { FileTypes, MIME_OPTIONS } from './rules.js';
const h = React.createElement;
const groupName = (group) => FILE_GROUPS.find((g) => g.key === group.group)?.label || group.group;
const fields = [
  ['group', 'Group'],
  ['bucket', 'Private bucket'],
  ['types', 'File types'],
  ['limit', 'Per file'],
  ['routes', 'Routes'],
];
export function BucketSettings({
  preferenceClient,
  registry,
  buckets,
  isAdministrator,
  onSave,
  onCreate,
  onRemove,
  lockBucket = false,
}) {
  const [selected, setSelected] = useState(null),
    [creating, setCreating] = useState(null),
    [removing, setRemoving] = useState(null),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState({ key: 'group', direction: 'asc' });
  const review = useSaveReview();
  const query = useGridSearch(search).trim().toLowerCase();
  const shown = registry
    .map((group) => ({
      group: groupName(group),
      bucket: lockBucket ? 'Private' : group.bucket_id,
      types: (group.mime || [])
        .map((m) => MIME_OPTIONS.find(([v]) => v === m)?.[1] || m)
        .join(', '),
      limit: group.max_bytes,
      routes: group.route_count ?? '—',
      record: group,
    }))
    .filter((row) =>
      [row.group, row.record.description].some((value) => value?.toLowerCase().includes(query)),
    )
    .sort(
      (a, b) =>
        (sort.direction === 'asc' ? 1 : -1) *
        String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }),
    );
  const editing = creating || removing || selected;
  const title = creating
    ? 'Create a private bucket'
    : removing
      ? `Remove ${groupName(removing)}?`
      : selected
        ? groupName(selected)
        : '';
  if (!isAdministrator)
    return h(
      'section',
      { className: 'access-denied' },
      h('h2', null, 'Administrator access required'),
      h('p', null, 'Bucket configuration is available only in Administration.'),
    );
  async function run(action) {
    setError('');
    setBusy(true);
    try {
      await action();
      setSelected(null);
      setCreating(null);
      setRemoving(null);
      setConfirmation('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function prepareCreate() {
    if (!creating.mime.length) return;
    review.prepare(
      creating,
      [
        ['Group key', creating.group],
        ['Description', creating.description],
        ['Allowed file types', creating.mime.join(', ')],
        ['Upload limit', prettyBytes(creating.max_bytes)],
      ],
      async (payload) => {
        await onCreate(payload);
        cancel();
      },
      'Review private bucket',
    );
  }

  function prepareEdit() {
    const prior = registry.find(({ group }) => group === selected.group);
    const change = (before, after) =>
      before !== after ? (before ?? '—') + ' → ' + (after ?? '—') : after;
    review.prepare(
      {
        groupKey: selected.group,
        description: selected.description,
        bucketId: selected.bucket_id,
        maxBytes: Number(selected.max_bytes),
        expectedVersion: selected.version || 1,
      },
      [
        ['Group key', selected.group],
        ['Description', change(prior?.description, selected.description)],
        ['Private bucket', change(prior?.bucket_id, selected.bucket_id)],
        [
          'Upload limit',
          change(prettyBytes(prior?.max_bytes || 0), prettyBytes(selected.max_bytes)),
        ],
      ],
      async (payload) => {
        await onSave(payload);
        cancel();
      },
      'Review bucket settings',
    );
  }
  function cancel() {
    setSelected(null);
    setCreating(null);
    setRemoving(null);
    setError('');
  }
  const controls = (submit, label, disabled = false) =>
    h(
      'div',
      { className: 'editor-actions' },
      h('button', { type: 'button', disabled: busy || review.busy, onClick: cancel }, 'Cancel'),
      h(
        'button',
        {
          type: 'submit',
          className: 'primary',
          disabled: busy || review.busy || disabled,
          onClick: submit,
        },
        busy ? 'Saving…' : label,
      ),
    );
  return h(
    'section',
    { className: 'bucket-settings' },
    h('h2', null, 'Storage groups'),
    h(
      'div',
      { className: 'fabric-actions worksheet-actions admin-toolbar' },
      h(GridSearch, { label: 'Search bucket groups', value: search, onChange: setSearch }),
      onCreate &&
        !creating &&
        !selected &&
        !removing &&
        h(
          'button',
          {
            className: 'primary',
            onClick: () => {
              setError('');
              setCreating({
                group: '',
                description: '',
                mime: MIME_OPTIONS.map(([m]) => m),
                max_bytes: 10485760,
              });
            },
          },
          'Create bucket',
        ),
    ),
    h(
      'p',
      { className: 'file-help' },
      'Only empty buckets without upload routes or file references can be removed.',
    ),
    editing &&
      h(
        AdminDialog,
        { title, onClose: () => !busy && !review.busy && cancel() },
        error && h('p', { className: 'form-error', role: 'alert' }, error),
        creating
          ? h(
              ReviewForm,
              { review, onSubmit: prepareCreate },
              h(
                'div',
                { className: 'fabric-fields' },
                h(
                  'label',
                  null,
                  'Group key',
                  h('input', {
                    'aria-label': 'New bucket group key',
                    required: true,
                    pattern: '[a-z][a-z0-9_]{1,47}',
                    maxLength: 48,
                    placeholder: 'e.g. lab_dip_files',
                    value: creating.group,
                    onChange: (e) => setCreating((v) => ({ ...v, group: e.target.value })),
                  }),
                  h('small', null, '2–48 lowercase letters, numbers or underscores.'),
                ),
                h(
                  'label',
                  null,
                  'Description',
                  h('input', {
                    'aria-label': 'New bucket description',
                    maxLength: 500,
                    value: creating.description,
                    onChange: (e) => setCreating((v) => ({ ...v, description: e.target.value })),
                  }),
                ),
                h(
                  'label',
                  null,
                  'Per-file size limit',
                  h(
                    'select',
                    {
                      value: creating.max_bytes,
                      onChange: (e) =>
                        setCreating((v) => ({ ...v, max_bytes: Number(e.target.value) })),
                    },
                    [1, 2, 5, 10].map((n) =>
                      h('option', { key: n, value: n * 1048576 }, `${n} MB`),
                    ),
                  ),
                ),
              ),
              h(FileTypes, {
                value: creating.mime,
                onChange: (mime) => setCreating((v) => ({ ...v, mime })),
              }),
              h(
                'p',
                { className: 'file-help' },
                'A private bucket address is generated automatically. Creating a bucket does not assign any upload routes.',
              ),
              controls(null, 'Review private bucket', !creating.mime.length),
            )
          : removing
            ? h(
                'form',
                {
                  onSubmit: (e) => {
                    e.preventDefault();
                    void run(() => onRemove(removing, confirmation));
                  },
                },
                h(
                  'p',
                  null,
                  'This permanently removes the empty Storage bucket and its group registry entry. The server checks files, routes and upload/attachment references again. It never empties a bucket.',
                ),
                h(
                  'label',
                  null,
                  `Type ${removing.group} to confirm`,
                  h('input', {
                    'aria-label': 'Confirm bucket group removal',
                    value: confirmation,
                    onChange: (e) => setConfirmation(e.target.value),
                    autoComplete: 'off',
                  }),
                ),
                controls(null, 'Remove empty bucket', confirmation !== removing.group),
              )
            : selected
              ? h(
                  ReviewForm,
                  { review, onSubmit: prepareEdit },
                  h(
                    'div',
                    { className: 'fabric-fields' },
                    h(
                      'label',
                      null,
                      'Description',
                      h('input', {
                        'aria-label': 'Group description',
                        maxLength: 500,
                        value: selected.description || '',
                        onChange: (e) =>
                          setSelected((d) => ({ ...d, description: e.target.value })),
                      }),
                    ),
                    !lockBucket &&
                      h(
                        'label',
                        null,
                        'Registered private bucket',
                        h(
                          'select',
                          {
                            'aria-label': 'Registered private bucket',
                            disabled: lockBucket,
                            value: selected.bucket_id,
                            onChange: (e) =>
                              setSelected((d) => ({ ...d, bucket_id: e.target.value })),
                          },
                          buckets
                            .filter((b) => b.private)
                            .map((b) => h('option', { key: b.id, value: b.id }, b.id)),
                        ),
                      ),
                    h(
                      'label',
                      null,
                      'Upload limit',
                      h(
                        'select',
                        {
                          'aria-label': 'Upload limit',
                          value: selected.max_bytes,
                          onChange: (e) =>
                            setSelected((d) => ({ ...d, max_bytes: Number(e.target.value) })),
                        },
                        [1, 2, 5, 10].map((n) =>
                          h('option', { key: n, value: n * 1048576 }, `${n} MB`),
                        ),
                      ),
                    ),
                  ),
                  controls(null, 'Review bucket settings'),
                )
              : null,
      ),
    h(GridSort, {
      columns: fields.map(([key, label]) => ({ key, label })),
      sort,
      onSort: setSort,
      rowCount: shown.length,
    }),
    h(
      'div',
      { className: 'admin-records' },
      h(
        RecordGrid,
        {
          client: preferenceClient,
          grid: 'files-buckets',
          fields,
        },
        h(
          'tbody',
          null,
          shown.map(({ record: group, bucket, types }) =>
            h(
              'tr',
              { key: group.id },
              h(
                'td',
                null,
                h('strong', null, groupName(group)),
                h('small', null, group.description),
              ),
              h('td', null, bucket),
              h('td', null, types || '—'),
              h('td', null, prettyBytes(group.max_bytes)),
              h('td', null, group.route_count ?? '—'),
              h(
                'td',
                null,
                h(
                  'div',
                  { className: 'bucket-row-actions' },
                  !group.removing &&
                    h(
                      'button',
                      {
                        onClick: () => {
                          setError('');
                          setSelected({ ...group });
                        },
                      },
                      'Edit settings',
                    ),
                  onRemove &&
                    h(
                      'button',
                      {
                        disabled:
                          Number(group.route_count) > 0 || Number(group.attachment_count) > 0,
                        title: 'Reassign routes and resolve references before removal',
                        onClick: () => {
                          setError('');
                          setRemoving(group);
                          setConfirmation('');
                        },
                      },
                      group.removing ? 'Retry removal' : 'Remove',
                    ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    !shown.length &&
      h(
        'div',
        { className: 'empty-state' },
        query ? 'No storage groups match your search.' : 'No storage groups configured.',
      ),
  );
}
