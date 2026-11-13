import { createElement as h, useEffect, useRef, useState } from 'react';
import { getAccessClient } from '../access/client.js';
import { liveFileCommands } from './live.js';
import { prettyBytes, resolveGroup, targetFor, validateFile } from './model.js';
import './styles.css';

async function openRecordFile(client, targetKey, recordId, id) {
  const tab = window.open('about:blank', '_blank');
  if (!tab) throw Error('Allow pop-ups to view the private file.');
  tab.opener = null;
  try {
    const { url } = await liveFileCommands(client).store([]).open({ id }, { targetKey, recordId });
    tab.location.replace(url);
  } catch (failure) {
    tab.close();
    throw failure;
  }
}

export function PrivateImageButton({ targetKey, recordId, attachmentId, children }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return h(
    'span',
    null,
    h(
      'button',
      {
        type: 'button',
        disabled: busy,
        onClick: async () => {
          setBusy(true);
          setError('');
          try {
            await openRecordFile(getAccessClient(), targetKey, recordId, attachmentId);
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        },
      },
      children,
    ),
    error && h('span', { role: 'alert' }, error),
  );
}

// A prepared plan belongs to one reviewed payload. The record receipt and each
// successful file operation survive a retry while that review remains open.
function prepareRecordAttachments(files, changes) {
  const entries = Object.entries(changes).map(([key, { file, previous }]) => {
    const route = files?.routes.find((entry) => entry.key === key);
    const label = targetFor(key).label;
    if (file) {
      if (!route || route.enabled === false) throw Error(label + ' uploads are unavailable.');
      const group = resolveGroup(files.registry, route.group);
      validateFile(file, route, {
        ...group,
        max_bytes: Math.min(group.max_bytes, route.max_bytes || 10485760),
      });
    }
    return { key, label, file, previous, requestId: crypto.randomUUID(), done: false };
  });
  let receipt;
  let saved = false;
  return {
    rows: entries.map(({ label, file, previous }) => [
      label,
      file
        ? (previous ? 'Replace ' + previous.filename + ' with ' : 'Upload ') +
          file.name +
          ' · ' +
          prettyBytes(file.size)
        : 'Remove ' + previous.filename,
    ]),
    get saved() {
      return saved;
    },
    async confirm(save) {
      if (!saved) {
        receipt = await save();
        saved = true;
      }
      for (const entry of entries) {
        if (entry.done) continue;
        try {
          if (!receipt) throw Error('The server did not return the saved record ID.');
          if (entry.file)
            await files.store.attach({
              targetKey: entry.key,
              recordId: receipt,
              file: entry.file,
              previousAttachmentId: entry.previous?.id ?? null,
              requestId: entry.requestId,
            });
          else await files.store.remove(entry.key, receipt, entry.previous.id);
          entry.done = true;
        } catch (failure) {
          throw Error(
            'Record saved. ' +
              entry.label +
              ' was not updated. Confirm again to retry, or close and reopen the saved record to change the file. ' +
              failure.message,
            { cause: failure },
          );
        }
      }
      return receipt;
    },
  };
}

export function useRecordAttachments(client) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState({});
  useEffect(() => {
    if (!client) return;
    let active = true;
    const commands = liveFileCommands(client);
    Promise.all([commands.registry(), commands.routes()])
      .then(([registry, routes]) => {
        if (active) setFiles({ registry, routes, store: commands.store(registry, routes) });
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [client]);
  return {
    files,
    error,
    changes,
    change(key, value) {
      setChanges((before) => {
        const next = { ...before };
        if (value) next[key] = value;
        else delete next[key];
        return next;
      });
    },
    prepare: () => prepareRecordAttachments(files, changes),
  };
}

export function RecordAttachmentField({
  attachments,
  client,
  targetKey,
  recordId,
  canWrite = true,
  label = targetFor(targetKey).label,
}) {
  const picker = useRef(null);
  const [current, setCurrent] = useState(null);
  const [loaded, setLoaded] = useState(!recordId);
  const [error, setError] = useState('');
  const { files, changes } = attachments;
  const target = files?.routes.find((entry) => entry.key === targetKey);
  const change = changes[targetKey];
  useEffect(() => {
    if (!recordId || !files) return;
    let active = true;
    files.store
      .list(targetKey, recordId)
      .then((rows) => {
        if (!active) return;
        setCurrent(rows.find((row) => row.current === true) ?? null);
        setLoaded(true);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [files, targetKey, recordId]);
  return h(
    'div',
    { className: 'fabric-line record-attachment' },
    h('h3', null, label),
    current &&
      h(
        'div',
        { className: 'fabric-actions' },
        h('span', null, current.filename),
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              openRecordFile(client, targetKey, recordId, current.id).catch((failure) =>
                setError(failure.message),
              );
            },
          },
          'View ' + label.toLowerCase(),
        ),
        canWrite &&
          !change &&
          h(
            'button',
            { type: 'button', onClick: () => attachments.change(targetKey, { previous: current }) },
            'Remove ' + label.toLowerCase(),
          ),
      ),
    (canWrite || change) &&
      h(
        'div',
        { className: 'fabric-actions' },
        canWrite &&
          target?.enabled !== false &&
          h(
            'button',
            { type: 'button', disabled: !target || !loaded, onClick: () => picker.current.click() },
            (current || change?.file ? 'Replace ' : 'Upload ') + label.toLowerCase(),
          ),
        h('input', {
          ref: picker,
          type: 'file',
          hidden: true,
          'aria-label': (current || change?.file ? 'Replace ' : 'Upload ') + label.toLowerCase(),
          accept: (target ?? targetFor(targetKey)).mime.join(','),
          disabled: !target || !loaded || !canWrite || target.enabled === false,
          onChange: (event) => {
            const file = event.target.files[0];
            if (file) attachments.change(targetKey, { file, previous: current });
            event.target.value = '';
          },
        }),
        change &&
          h(
            'span',
            { role: 'status' },
            change.file ? 'Selected: ' + change.file.name : 'Marked for removal',
          ),
        change &&
          h(
            'button',
            { type: 'button', onClick: () => attachments.change(targetKey, null) },
            'Undo attachment change',
          ),
      ),
    (error || attachments.error) &&
      h('p', { role: 'alert', className: 'form-error' }, error || attachments.error),
  );
}
