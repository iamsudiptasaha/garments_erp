import { BillingStatus } from './record-workspace.js';
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { WorksheetToolbar, useGridSearch } from '../fabric/grid-toolbar.js';
import { WorkspaceViewToggle } from '../fabric/view-toggle.js';
import { FinishedGoodsEditor as DocumentDialog } from '../finished-goods/sheet-view.js';

const columns = [
  ['packing_list_number', 'Packing list'],
  ['invoice_number', 'Invoice'],
  ['date', 'Date'],
  ['location_abbr', 'Location'],
  ['status', 'Status'],
  ['carton_count', 'Cartons'],
];
const spec = {
  title: 'Packing Lists',
  columns: columns.map(([key, label]) => ({
    key,
    label,
    numeric: key === 'carton_count',
  })),
};

function table(labels, rows) {
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
          labels.map((label) => h('th', { key: label, scope: 'col' }, label)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map(({ id, values }) =>
          h(
            'tr',
            { key: id },
            values.map((value, index) => h('td', { key: labels[index] }, value ?? '—')),
          ),
        ),
      ),
    ),
  );
}

export function PackingDetail({ client, id, openInvoice }) {
  const [data, setData] = useState(null);
  const [carton, setCarton] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    client.rpc('erp_portal_packing_lists', { p_id: id }).then(({ data, error }) => {
      if (!current) return;
      if (error || !data?.length) setError(error?.message || 'Packing list not found.');
      else setData(data[0]);
    });
    return () => {
      current = false;
    };
  }, [client, id]);
  if (!data) return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading packing list…');
  return h(
    'section',
    { className: 'fabric-line' },
    h('h3', null, data.packing_list_number),
    h(
      'dl',
      { className: 'billing-meta' },
      columns
        .slice(1)
        .map(([key, label]) =>
          h('div', { key }, h('dt', null, label), h('dd', null, data[key] ?? '—')),
        ),
    ),
    openInvoice &&
      h(
        'button',
        { type: 'button', className: 'open-document', onClick: () => openInvoice(data.billing_id) },
        'Open invoice ' + data.invoice_number,
      ),
    h('h3', null, 'Packing progress'),
    table(
      ['Billed item', 'Size', 'Unit', 'Billed', 'Packed', 'To pack'],
      data.progress.map((row) => ({
        id: row.id,
        values: [row.item, row.size, row.unit, row.billed, row.packed, row.remaining],
      })),
    ),
    h('h3', null, 'Carton details'),
    carton && h('button', { type: 'button', onClick: () => setCarton(null) }, 'Show all cartons'),
    data.contents.length
      ? table(
          ['Carton', 'ERP item', 'Size', 'Pieces', 'Status'],
          data.contents
            .filter((row) => !carton || row.carton_id === carton)
            .map((row) => ({
              id: row.id,
              values: [
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'open-document',
                    onClick: () => setCarton(row.carton_id),
                  },
                  row.number,
                ),
                row.item,
                row.size,
                row.pieces,
                row.status,
              ],
            })),
        )
      : h('p', null, 'No cartons assigned.'),
  );
}

export function PackingLists({ client, capabilities, openInvoice }) {
  const [view, setView] = useState('overview');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = useGridSearch(search.trim());
  useEffect(() => {
    let current = true;
    setRows(null);
    setError('');
    client
      .rpc('erp_portal_packing_lists', { p_search: query, p_offset: offset })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else setRows(data);
      });
    return () => {
      current = false;
    };
  }, [client, query, offset]);
  const records = useMemo(() => (rows ?? []).slice(0, 50), [rows]);
  const canOpen = query === search.trim() && records.some(({ id }) => id === selected);
  return h(
    'section',
    null,
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('h1', null, 'Packing Lists'),
        h('p', null, 'Review packing progress by invoice.'),
      ),
      h(WorkspaceViewToggle, {
        label: 'Packing Lists view',
        view,
        onChange: (next) => {
          setSelected(null);
          setView(next);
        },
      }),
    ),
    h(
      WorksheetToolbar,
      {
        label: 'Search packing list, invoice or location',
        value: search,
        onChange: (value) => {
          setSelected(null);
          setSearch(value);
          setOffset(0);
        },
      },
      view === 'sheet' &&
        h(
          DocumentDialog,
          {
            record: true,
            defer: true,
            title: 'Packing list details',
            label: 'Open selected document',
            disabled: !canOpen,
          },
          () => h(PackingDetail, { key: selected, client, id: selected, openInvoice }),
        ),
    ),
    error && h('p', { role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    !rows && !error && h('p', { role: 'status' }, 'Loading packing lists…'),
    rows &&
      (view === 'sheet'
        ? h(FabricSheet, {
            client,
            page: 'billing-packing-lists',
            spec,
            records,
            capabilities,
            paged: offset > 0 || rows.length > 50,
            onSelect: (row) => setSelected(row?.id ?? null),
            onNotice: setNotice,
          })
        : table(
            columns.map(([, label]) => label),
            records.map((row) => ({
              id: row.id,
              values: [
                h(
                  DocumentDialog,
                  {
                    record: true,
                    defer: true,
                    label: row.packing_list_number,
                    title: 'Packing list details',
                  },
                  () => h(PackingDetail, { client, id: row.id, openInvoice }),
                ),
                openInvoice
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'open-document',
                        onClick: () => openInvoice(row.billing_id),
                      },
                      row.invoice_number,
                    )
                  : row.invoice_number,
                row.date,
                row.location_abbr,
                h(BillingStatus, { value: row.status }),
                row.carton_count,
              ],
            })),
          )),
    rows && !records.length && h('p', null, 'No packing lists found.'),
    (offset > 0 || rows?.length > 50) &&
      h(
        'div',
        { className: 'fabric-actions' },
        h(
          'button',
          { type: 'button', disabled: offset === 0, onClick: () => setOffset(offset - 50) },
          'Previous',
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: !rows || rows.length <= 50,
            onClick: () => setOffset(offset + 50),
          },
          'Next',
        ),
      ),
  );
}
