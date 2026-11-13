import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import React, { useEffect, useRef, useState } from 'react';
import { prettyBytes, targetFor, resolveGroup } from './model.js';
const h = React.createElement;
const isCurrent = (row) => row.current === true || row.current === undefined;
export function FilePanel(props) {
  return h(RecordFilePanel, { ...props, key: props.targetKey + ':' + props.recordId });
}

function RecordFilePanel({
  store,
  registry,
  targetKey,
  recordId,
  recordLabel,
  canRead = true,
  canWrite = false,
  onAttached,
  onBusyChange,
  targetDefinition,
}) {
  const target = targetDefinition || targetFor(targetKey),
    picker = useRef(null),
    generation = useRef(0),
    [rows, setRows] = useState([]),
    [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const review = useSaveReview();
  let group = null;
  try {
    group = resolveGroup(registry, target.group);
  } catch {
    /* The panel exposes missing registry as a disabled state. */
  }
  async function refresh(epoch = generation.current) {
    if (!canRead) {
      setRows([]);
      return;
    }
    try {
      const next = await store.list(targetKey, recordId);
      if (epoch === generation.current) {
        setRows(next);
        setError('');
      }
    } catch (e) {
      if (epoch === generation.current) setError(e.message);
    }
  }
  useEffect(() => {
    generation.current++;
    setFile(null);
    setRows([]);
    setNotice('');
    setBusy(false);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [store, targetKey, recordId, canRead]);
  function attach() {
    if (!canWrite || !file || !group || busy) return;
    const epoch = generation.current;
    const current = rows.find(isCurrent);
    review.prepare(
      {
        targetKey,
        recordId,
        previousAttachmentId: current?.id ?? null,
        attempt: crypto.randomUUID(),
        filename: file.name,
        size: file.size,
        type: file.type,
        modified: file.lastModified,
      },
      [
        ['Record', recordLabel || recordId],
        ['Attachment field', target.label],
        ['Action', current ? 'Replace' : 'Upload'],
        ['Current file', current?.filename],
        ['Selected file', file.name],
        ['File size', prettyBytes(file.size)],
      ],
      async (payload, requestId) => {
        if (epoch !== generation.current)
          throw Error('The target changed. Return to editing and review again.');
        onBusyChange?.(true);
        try {
          const attachment = await store
            .attach({
              targetKey: payload.targetKey,
              recordId: payload.recordId,
              file,
              requestId,
              previousAttachmentId: payload.previousAttachmentId,
            })
            .catch(async (failure) => {
              if (epoch === generation.current) await refresh(epoch);
              throw failure;
            });
          if (epoch !== generation.current) return;
          setFile(null);
          if (picker.current) picker.current.value = '';
          try {
            await onAttached?.(attachment);
          } catch {
            setError(
              'File saved, but the record could not be refreshed. Reload before editing it.',
            );
            return;
          }
          await refresh(epoch);
          if (epoch === generation.current)
            setNotice(
              store.mode === 'local' ? 'File saved in this browser only.' : 'Attachment saved.',
            );
        } finally {
          onBusyChange?.(false);
        }
      },
      'Review attachment',
    );
  }
  function remove(row) {
    review.prepare(
      { targetKey, recordId, remove: row.id },
      [
        ['Record', recordLabel || recordId],
        ['Attachment field', target.label],
        ['Remove file', row.filename],
        ['File after save', 'None'],
      ],
      async (payload) => {
        onBusyChange?.(true);
        try {
          await store.remove(payload.targetKey, payload.recordId, payload.remove);
          await refresh();
          setNotice('Attachment removed.');
          try {
            await onAttached?.(null);
          } catch {
            setError('Attachment removed, but the record could not be refreshed.');
          }
        } finally {
          onBusyChange?.(false);
        }
      },
      'Review attachment removal',
    );
  }
  async function open(row, download = false) {
    setBusy(true);
    setError('');
    try {
      const result = await store.open(row, { targetKey, recordId, download });
      if (result instanceof Blob) {
        const url = URL.createObjectURL(result),
          link = document.createElement('a');
        link.href = url;
        link.download = row.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const url = new URL(result?.url);
        const isLoopback = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
        if (
          url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && isLoopback(url.hostname) && isLoopback(location.hostname))
        )
          throw Error('An authorised download could not be opened.');
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'section',
    { className: 'file-panel' },
    h(
      'div',
      { className: 'file-panel-heading' },
      h(
        'div',
        null,
        h('span', { className: 'file-kicker' }, target.label),
        h('h2', null, recordLabel || recordId),
      ),
      h('span', { className: 'file-private' }, 'Private files'),
    ),
    h(
      'p',
      { className: 'file-help' },
      store.mode === 'local'
        ? 'Local file preview · files stay in this browser. No Supabase upload or live record link is made.'
        : 'Files are available only to people with access to this record.',
    ),
    !group &&
      h(
        'p',
        { className: 'form-error' },
        'The bucket registry is not configured for this file group.',
      ),
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    notice && h('p', { role: 'status', className: 'file-notice' }, notice),
    canWrite &&
      target.enabled !== false &&
      h(
        ReviewForm,
        { review, onSubmit: attach, className: 'file-uploader', key: targetKey + ':' + recordId },
        h(
          'label',
          null,
          h('strong', null, 'Choose a file'),
          h(
            'small',
            null,
            `${target.mime.includes('application/pdf') ? 'PDF or image' : 'JPEG, PNG or WebP'} · up to ${prettyBytes(Math.min(group?.max_bytes || 0, target.max_bytes || 10485760))}`,
          ),
          h('input', {
            ref: picker,
            type: 'file',
            accept: target.mime.join(','),
            disabled: busy || !group,
            onChange: (e) => {
              setFile(e.target.files?.[0] || null);
              setError('');
            },
          }),
        ),
        file &&
          h(
            'div',
            { className: 'file-selection' },
            h('span', null, file.name),
            h('small', null, prettyBytes(file.size)),
            h(
              'button',
              { className: 'primary', type: 'submit', disabled: busy || !group },
              'Review attachment',
            ),
          ),
      ),
    !canRead
      ? h('p', null, 'Your role cannot view these attachments.')
      : h(
          'div',
          { className: 'file-list' },
          rows.some(isCurrent)
            ? rows.filter(isCurrent).map((row) =>
                h(
                  'article',
                  { key: row.id },
                  h(
                    'div',
                    { className: 'file-symbol', 'aria-hidden': true },
                    row.mime_type === 'application/pdf' ? 'PDF' : 'IMG',
                  ),
                  h(
                    'div',
                    null,
                    h('strong', null, row.filename),
                    h(
                      'small',
                      null,
                      `${prettyBytes(row.file_size)} · ${new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
                    ),
                  ),
                  h(
                    'button',
                    { disabled: busy || review.busy, onClick: () => open(row) },
                    store.mode === 'local' ? 'Download' : 'Open',
                  ),
                  store.mode === 'supabase' &&
                    h(
                      'button',
                      {
                        type: 'button',
                        disabled: busy || review.busy,
                        onClick: () => open(row, true),
                      },
                      'Download',
                    ),
                  canWrite &&
                    store.remove &&
                    !review.pending &&
                    h(
                      'button',
                      { type: 'button', disabled: busy, onClick: () => remove(row) },
                      'Remove',
                    ),
                ),
              )
            : h(
                'div',
                { className: 'file-empty' },
                h('strong', null, 'No files attached'),
                h(
                  'p',
                  null,
                  canWrite
                    ? 'Choose a file above to get started.'
                    : 'Files will appear here when added.',
                ),
              ),
        ),
  );
}
