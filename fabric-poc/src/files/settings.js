import { RecordGrid } from '../fabric/record-grid.js';
import React, { useState } from 'react';
import { FILE_GROUPS, prettyBytes } from './model.js';
import { FileTypes, MIME_OPTIONS } from './rules.js';
const h = React.createElement;
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
    [busy, setBusy] = useState(false);
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
      h('button', { type: 'button', disabled: busy, onClick: cancel }, 'Cancel'),
      h(
        'button',
        { type: 'submit', className: 'primary', disabled: busy || disabled, onClick: submit },
        busy ? 'Saving…' : label,
      ),
    );
  return h(
    'section',
    { className: 'bucket-settings' },
    h(
      'div',
      { className: 'fabric-actions' },
      h('h2', null, 'Bucket settings'),
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
          '+ Create bucket',
        ),
    ),
    h(
      'p',
      { className: 'file-help' },
      'Private buckets are registered by group. Assign upload routes below. Only empty, unassigned and unreferenced buckets can be removed.',
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    creating
      ? h(
          'form',
          {
            onSubmit: (e) => {
              e.preventDefault();
              void run(() => onCreate(creating));
            },
          },
          h('h3', null, 'Create a private bucket'),
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
                [1, 2, 5, 10].map((n) => h('option', { key: n, value: n * 1048576 }, `${n} MB`)),
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
          controls(null, 'Create private bucket', !creating.mime.length),
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
            h('h3', null, `Remove ${removing.group}?`),
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
              'form',
              {
                onSubmit: (e) => {
                  e.preventDefault();
                  void run(() =>
                    onSave({
                      groupKey: selected.group,
                      description: selected.description,
                      bucketId: selected.bucket_id,
                      maxBytes: Number(selected.max_bytes),
                      expectedVersion: selected.version || 1,
                    }),
                  );
                },
              },
              h(
                'h3',
                null,
                FILE_GROUPS.find((g) => g.key === selected.group)?.label || selected.group,
              ),
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
                    onChange: (e) => setSelected((d) => ({ ...d, description: e.target.value })),
                  }),
                ),
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
                      onChange: (e) => setSelected((d) => ({ ...d, bucket_id: e.target.value })),
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
              controls(null, 'Save bucket settings'),
            )
          : h(
              'div',
              { className: 'permission-scroll' },
              h(
                RecordGrid,
                {
                  client: preferenceClient,
                  grid: 'files-buckets',
                  fields: [
                    ['group', 'Group'],
                    ['bucket', 'Private bucket'],
                    ['types', 'File types'],
                    ['limit', 'Per file'],
                    ['routes', 'Routes'],
                  ],
                },
                h(
                  'tbody',
                  null,
                  registry.map((group) =>
                    h(
                      'tr',
                      { key: group.id },
                      h(
                        'td',
                        null,
                        h(
                          'strong',
                          null,
                          FILE_GROUPS.find((g) => g.key === group.group)?.label || group.group,
                        ),
                        h('small', null, group.description),
                      ),
                      h('td', null, group.bucket_id),
                      h(
                        'td',
                        null,
                        (group.mime || [])
                          .map((m) => MIME_OPTIONS.find(([v]) => v === m)?.[1] || m)
                          .join(', '),
                      ),
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
                                  Number(group.route_count) > 0 ||
                                  Number(group.attachment_count) > 0,
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
  );
}
