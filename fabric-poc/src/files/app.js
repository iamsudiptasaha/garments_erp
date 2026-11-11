import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Select from 'react-select';
import { getAccessClient } from '../access/client.js';
import { WorkspaceGate } from '../access/workspace-gate.js';
import { AccessNavigation } from '../access/navigation.js';
import { UploadRoutes } from './routes.js';
import { liveFileCommands } from './live.js';
import { BucketSettings } from './settings.js';
import { FilePanel } from './panel.js';
import '../admin/styles.css';
import '../fabric/styles.css';
import '../access/styles.css';
import './styles.css';
const h = React.createElement,
  admin = !!document.getElementById('file-admin-root');
function FilesWorkspace({ access }) {
  const commands = useMemo(() => liveFileCommands(getAccessClient()), []),
    [registry, setRegistry] = useState([]),
    [routes, setRoutes] = useState([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [open, setOpen] = useState(true),
    [key, setKey] = useState(''),
    [query, setQuery] = useState(''),
    [records, setRecords] = useState([]),
    [selected, setSelected] = useState(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const targets = routes.filter((t) => access.permissions?.[t.resource]?.view),
    target = targets.find((t) => t.key === key) || targets[0],
    store = useMemo(() => commands.store(registry, routes), [commands, registry, routes]);
  async function refresh() {
    setError('');
    try {
      const [groups, configured] = await Promise.all([commands.registry(), commands.routes()]);
      setRegistry(groups);
      setRoutes(configured);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [commands]);
  useEffect(() => {
    setSelected(null);
    setRecords([]);
    setQuery('');
  }, [target?.key]);
  useEffect(() => {
    if (!target || admin) return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        commands
          .records(target.key, query)
          .then((rows) => {
            if (active) {
              setRecords(rows);
              setError('');
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [commands, target?.key, query]);
  async function save(input) {
    setError('');
    await commands.saveGroup({
      p_group_id: registry.find((g) => g.group === input.groupKey).id,
      p_version: input.expectedVersion,
      p_description: input.description,
      p_max_bytes: input.maxBytes,
    });
    await refresh();
    setNotice('Bucket group settings saved to Supabase.');
  }
  async function createGroup(input) {
    await commands.createGroup(input);
    await refresh();
    setNotice('Private bucket created. Assign an upload route to start using it.');
  }
  async function removeGroup(group, confirmation) {
    await commands.removeGroup(group, confirmation);
    await refresh();
    setNotice('Empty bucket and registry entry removed.');
  }
  async function saveRoute(input) {
    await commands.saveRoute({
      p_key: input.key,
      p_group_id: input.bucket_group_id,
      p_mimes: input.mime,
      p_max_bytes: input.max_bytes,
      p_enabled: input.enabled,
      p_version: input.version,
    });
    await refresh();
    setNotice('Upload route saved. New uploads use these settings.');
  }
  async function cleanup() {
    setBusy(true);
    setError('');
    try {
      const result = await commands.cleanup();
      setNotice(
        result.results.some((r) => !r.cleaned)
          ? 'Some interrupted files still need cleanup. Retry later.'
          : `Cleanup completed · ${result.results.length} interrupted upload(s).`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return h(
    'div',
    { className: `access-workspace${open ? '' : ' access-menu-closed'}` },
    h(AccessNavigation, {
      access,
      tab: 'files',
      onTab: (key) => {
        location.href =
          '/access.html#' +
          { roles: 'adminRoles', accounts: 'adminAccess', audit: 'adminAudit' }[key];
      },
      open,
      onClose: () => setOpen(false),
    }),
    h(
      'main',
      { className: 'access-live-shell files-live' },
      h(
        'div',
        { className: 'workspace-toolbar' },
        h(
          'button',
          { 'aria-expanded': open, onClick: () => setOpen((v) => !v) },
          open ? '‹ Hide menu' : '› Show menu',
        ),
        h('a', { href: '/fabric.html?live=1' }, 'Workspace'),
      ),
      h(
        'header',
        null,
        h('p', { className: 'eyebrow' }, admin ? 'ADMINISTRATION' : 'SAVED RECORD ATTACHMENTS'),
        h('h1', null, admin ? 'Bucket groups' : 'Files'),
      ),
      error && h('p', { role: 'alert', className: 'form-error' }, error),
      notice && h('p', { role: 'status', className: 'file-notice' }, notice),
      admin
        ? !access.administrator
          ? h('p', null, 'Administrator access required.')
          : h(
              React.Fragment,
              null,
              h(
                'p',
                { className: 'files-boundary' },
                'Live Supabase configuration · private buckets · group keys and bucket addresses stay fixed to preserve file links.',
              ),
              h(BucketSettings, {
                preferenceClient: getAccessClient(),
                registry,
                buckets: registry.map((g) => ({ id: g.bucket_id, private: g.private })),
                isAdministrator: true,
                onSave: save,
                onCreate: createGroup,
                onRemove: removeGroup,
                lockBucket: true,
              }),
              h(UploadRoutes, {
                routes,
                registry,
                onSave: saveRoute,
                preferenceClient: getAccessClient(),
              }),
              h(
                'div',
                { className: 'file-admin-actions' },
                h('a', { href: '/files.html' }, 'Open files'),
                h(
                  'button',
                  { disabled: busy, onClick: cleanup },
                  busy ? 'Cleaning…' : 'Clean up interrupted uploads',
                ),
              ),
            )
        : h(
            React.Fragment,
            null,
            h(
              'p',
              { className: 'files-boundary' },
              'Live files attach to saved Supabase records. Local sample bills are not listed here.',
            ),
            targets.length
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'fabric-fields file-record-picker' },
                    h(
                      'label',
                      null,
                      'Document type',
                      h(
                        'select',
                        { value: target.key, onChange: (e) => setKey(e.target.value) },
                        targets.map((t) => h('option', { key: t.key, value: t.key }, t.label)),
                      ),
                    ),
                    h(
                      'label',
                      { id: 'saved-record-label' },
                      'Saved record',
                      h(Select, {
                        'aria-labelledby': 'saved-record-label',
                        classNamePrefix: 'employee-select',
                        options: records.map((r) => ({
                          value: r.id,
                          label: `${r.label} · #${r.id}`,
                        })),
                        value: selected,
                        onChange: setSelected,
                        onInputChange: (value, meta) => {
                          if (meta.action === 'input-change') setQuery(value);
                        },
                        isLoading: loading,
                        placeholder: 'Search a saved record…',
                        noOptionsMessage: () => (loading ? 'Loading…' : 'No saved records found'),
                      }),
                    ),
                  ),
                  selected &&
                    h(FilePanel, {
                      store,
                      registry,
                      targetKey: target.key,
                      recordId: selected.value,
                      recordLabel: selected.label,
                      targetDefinition: target,
                      canRead: true,
                      canWrite:
                        target.enabled && access.permissions?.[target.resource]?.edit === true,
                    }),
                )
              : h('p', null, 'No attachment-enabled screens are available to your role.'),
          ),
    ),
  );
}
createRoot(document.getElementById(admin ? 'file-admin-root' : 'files-root')).render(
  h(WorkspaceGate, { render: (access) => h(FilesWorkspace, { access }) }),
);
