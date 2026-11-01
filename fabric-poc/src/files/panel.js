import React, { useEffect, useRef, useState } from 'react';
import { prettyBytes, targetFor, resolveGroup } from './model.js';
const h = React.createElement;
export function FilePanel({
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
  async function attach(e) {
    e.preventDefault();
    const epoch = generation.current;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const attachment = await store.attach({ targetKey, recordId, file });
      if (onAttached) await onAttached(attachment);
      if (epoch !== generation.current) return;
      setFile(null);
      if (picker.current) picker.current.value = '';
      await refresh(epoch);
      if (epoch !== generation.current) return;
      setNotice(store.mode === 'local' ? 'File saved in this browser only.' : 'Attachment saved.');
    } catch (e) {
      if (epoch === generation.current) setError(e.message);
    } finally {
      if (epoch === generation.current) setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function open(row) {
    setBusy(true);
    setError('');
    try {
      const result = await store.open(row);
      if (result instanceof Blob) {
        const url = URL.createObjectURL(result),
          link = document.createElement('a');
        link.href = url;
        link.download = row.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const url = new URL(result?.url);
        if (url.protocol !== 'https:') throw Error('An authorised download could not be opened.');
        window.open(url.href, '_blank', 'noopener,noreferrer');
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
      h(
        'form',
        { onSubmit: attach, className: 'file-uploader' },
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
              busy ? 'Saving…' : store.mode === 'local' ? 'Save local file' : 'Attach file',
            ),
          ),
      ),
    !canRead
      ? h('p', null, 'Your role cannot view these attachments.')
      : h(
          'div',
          { className: 'file-list' },
          rows.length
            ? rows.map((row) =>
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
                    { disabled: busy, onClick: () => open(row) },
                    store.mode === 'local' ? 'Download' : 'Open',
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
