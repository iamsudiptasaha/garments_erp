import './styles.css';
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { WorksheetToolbar } from '../fabric/grid-toolbar.js';
import { BillingViewActions } from './overview.js';

export function BillingStatus({ value }) {
  const accepted = ['Verified', 'Dispatched', 'Packed'].includes(value);
  const style = accepted ? ' accepted' : value === 'Cancelled' ? ' failed' : '';
  return h('span', { className: 'lab-status' + style }, value);
}

export function BillingTable({ columns, rows, render = (row, key) => row[key] }) {
  return h(
    'div',
    { className: 'lab-record-table-wrap billing-table-frame' },
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          columns.map(({ key, label }) => h('th', { key, scope: 'col' }, label)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((row) =>
          h(
            'tr',
            { key: row.id },
            columns.map(({ key }) => h('td', { key }, render(row, key) ?? '—')),
          ),
        ),
      ),
    ),
  );
}

export function BillingRecordWorkspace({
  title,
  subtitle,
  page,
  columns,
  rows,
  client,
  capabilities,
  search,
  onViewChange,
  setSearch,
  add,
  selectedActions,
  children,
  paged,
  footer,
}) {
  const [view, setView] = useState('overview');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const spec = useMemo(() => ({ title, columns }), [title, columns]);
  const selectedRow = rows?.find(({ id }) => id === selected);

  return h(
    'section',
    null,
    h(
      'div',
      { className: 'editor-heading' },
      h('div', null, h('h1', null, title), h('p', null, subtitle)),
      h(BillingViewActions, {
        title,
        add,
        view,
        onChange: (next) => {
          setSelected(null);
          setView(next);
          onViewChange?.(next);
        },
      }),
    ),
    view === 'sheet' &&
      h(
        WorksheetToolbar,
        {
          label: 'Search ' + title.toLowerCase(),
          value: search,
          onChange: (value) => {
            setSelected(null);
            setSearch(value);
          },
        },
        add,
        selectedActions?.(selectedRow),
      ),
    notice && h('p', { role: 'status' }, notice),
    view === 'overview'
      ? children
      : rows &&
          h(FabricSheet, {
            client,
            page,
            spec,
            records: rows,
            capabilities,
            paged,
            onSelect: (row) => setSelected(row?.id ?? null),
            onNotice: setNotice,
          }),
    view === 'sheet' && rows && !rows.length && h('p', null, 'No matching records.'),
    footer,
  );
}

export function BillingPagination({ offset, onChange, hasNext }) {
  return (
    (offset > 0 || hasNext) &&
    h(
      'div',
      { className: 'fabric-actions' },
      h(
        'button',
        { type: 'button', disabled: offset === 0, onClick: () => onChange(offset - 50) },
        'Previous',
      ),
      h(
        'button',
        { type: 'button', disabled: !hasNext, onClick: () => onChange(offset + 50) },
        'Next',
      ),
    )
  );
}

export function useBillingQuery(client, method, args, revision = 0) {
  const [result, setResult] = useState({});
  useEffect(() => {
    let current = true;
    setResult({});
    client.rpc(method, args).then(({ data, error }) => {
      if (current) setResult({ data, error: error?.message });
    });
    return () => {
      current = false;
    };
  }, [client, method, args, revision]);
  return result;
}
