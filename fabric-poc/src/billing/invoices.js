import { ReturnEntry } from './returns.js';
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { GridSearch, useGridSearch } from '../fabric/grid-toolbar.js';
import { BillingOverview, BillingViewActions, useBillingOverviewSearch } from './overview.js';
import { FinishedGoodsEditor as DocumentDialog } from '../finished-goods/sheet-view.js';
import { InvoiceEditor } from './invoice-editor.js';
import { PackingDetail } from './packing-lists.js';
import { BillingStatus, BillingTable, useBillingQuery } from './record-workspace.js';

const columns = [
  ['invoice', 'Invoice'],
  ['invoice_date', 'Invoice date'],
  ['buyer', 'Buyer'],
  ['source', 'Source'],
  ['mode', 'Sale mode'],
  ['status', 'Status'],
  ['original_value', 'Original value'],
  ['verified_credit', 'Verified credits'],
];
const spec = {
  title: 'Invoices',
  columns: columns.map(([key, label]) => ({
    key,
    label,
    numeric: key === 'original_value' || key === 'verified_credit',
  })),
};
const statuses = ['draft', 'finalized', 'dispatched', 'cancelled'];
const pageSize = 50;
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const capitalize = (value) => value[0].toUpperCase() + value.slice(1);
const invoiceLabel = (number, id) => number || `Draft ${id}`;

const lineColumns = [
  { key: 'item', label: 'Invoice item' },
  { key: 'style', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'quantity', label: 'Billed pieces' },
  { key: 'price', label: 'Billed price' },
];

function InvoiceEditRecord({ client, id, onClose, onSaved }) {
  const args = useMemo(() => ({ p_billing_id: id }), [id]);
  const { data, error } = useBillingQuery(client, 'erp_portal_invoice', args);
  if (!data) return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading invoice…');
  if (!['draft', 'finalized'].includes(data.status))
    return h('p', { role: 'alert' }, 'This invoice is no longer editable.');
  return h(InvoiceEditor, { client, details: data, onClose, onSaved });
}

function PackingEntry({ client, invoice, onClose, onSaved }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const result = await client.rpc('erp_portal_create_packing_list', {
      p_request_id: crypto.randomUUID(),
      p_billing_id: invoice.id,
      p_date: form.get('date'),
      p_location: form.get('location').trim(),
    });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else {
      onClose();
      onSaved();
    }
  }
  return h(
    'form',
    { onSubmit: create },
    h(
      'div',
      { className: 'fabric-fields' },
      h('label', null, 'Invoice', h('input', { readOnly: true, value: invoice.invoice_number })),
      h('label', null, 'Packing date', h('input', { type: 'date', name: 'date', required: true })),
      h('label', null, 'Location', h('input', { name: 'location', required: true })),
    ),
    error && h('p', { role: 'alert' }, error),
    h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Create packing list'),
  );
}

function InvoicePacking({ client, invoice, canCreate }) {
  const [revision, setRevision] = useState(0);
  const args = useMemo(() => ({ p_billing_id: invoice.id }), [invoice.id]);
  const { data, error } = useBillingQuery(client, 'erp_portal_packing_lists', args, revision);
  if (error) return h('p', { role: 'alert' }, error);
  if (!data) return null;
  if (data.length) {
    const list = data[0];
    return h(
      DocumentDialog,
      { title: 'Packing list details', label: list.packing_list_number, record: true, defer: true },
      () => h(PackingDetail, { client, id: list.id }),
    );
  }
  return (
    canCreate &&
    h(
      DocumentDialog,
      { title: 'Create packing list', label: 'Create packing list', defer: true },
      (onClose) =>
        h(PackingEntry, {
          client,
          invoice,
          onClose,
          onSaved: () => setRevision((value) => value + 1),
        }),
    )
  );
}

function InvoiceReturn({ client, id, label, onClose, onSaved }) {
  const args = useMemo(() => ({ p_invoice_id: id }), [id]);
  const { data, error } = useBillingQuery(client, 'erp_portal_return_workspace', args);
  if (!data) return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading return…');
  return h(ReturnEntry, {
    client,
    records: { ...data, invoices: [{ id, label }] },
    invoiceId: id,
    onClose,
    refresh: () => onSaved(id),
  });
}

function InvoiceReturnHistory({ client, id }) {
  const args = useMemo(() => ({ p_invoice_id: id }), [id]);
  const { data, error } = useBillingQuery(client, 'erp_portal_return_workspace', args);
  if (error) return h('p', { role: 'alert' }, error);
  const rows = data?.returns.flatMap((record) =>
    record.parts.map((part) => ({
      ...part,
      id: record.id + ':' + part.id,
      number: 'RET-' + record.id.padStart(4, '0'),
      price: money.format(part.price),
      credit: money.format(part.credit),
    })),
  );
  if (!rows?.length) return null;
  return h(
    'section',
    { className: 'fabric-line' },
    h('h2', null, 'Verified returns'),
    h(BillingTable, {
      rows,
      columns: [
        { key: 'number', label: 'Return' },
        { key: 'item', label: 'ERP item' },
        { key: 'pieces', label: 'Pieces' },
        { key: 'price', label: 'Confirmed price' },
        { key: 'credit', label: 'Credit' },
      ],
    }),
  );
}

function InvoiceDetail({
  client,
  id,
  onBack,
  canEdit,
  canViewPacking,
  canCreatePacking,
  onSaved,
  canCreateReturn,
  canViewReturns,
  openPO,
}) {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    client.rpc('erp_portal_invoice', { p_billing_id: id }).then(({ data, error }) => {
      if (!current) return;
      if (error || !data) setError(error?.message || 'Invoice not found.');
      else setDetails(data);
    });
    return () => {
      current = false;
    };
  }, [client, id]);

  const fields = details && [
    ['Status', capitalize(details.status)],
    ['Invoice date', details.invoice.invoice_date],
    ['Buyer', details.buyer],
    [
      'Buyer PO',
      details.invoice.formal_po_id
        ? openPO
          ? h(
              'button',
              {
                type: 'button',
                className: 'open-document',
                onClick: () => openPO(details.invoice.formal_po_id),
              },
              details.po_number,
            )
          : details.po_number
        : 'Ad-hoc · internal PO',
    ],
    ['Verified by', details.verified_by_employee_code],
    [
      'GST rate',
      details.invoice.gst_percentage == null ? null : details.invoice.gst_percentage + '%',
    ],
  ];
  const totals = details && [
    ['Original billed value', money.format(details.totals.original_value)],
    ['Verified return credits', money.format(details.totals.verified_credit)],
    ['Taxable value', money.format(details.totals.taxable_value)],
    [
      'GST amount',
      details.totals.gst_amount === null ? null : money.format(details.totals.gst_amount),
    ],
    [
      'Final total',
      details.totals.total_including_gst === null
        ? null
        : money.format(details.totals.total_including_gst),
    ],
  ];

  return h(
    'section',
    null,
    h('button', { type: 'button', onClick: onBack }, 'Back to invoices'),
    h(
      'header',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h(
          'h1',
          null,
          details ? invoiceLabel(details.invoice.invoice_number, id) : 'Invoice details',
        ),
        details &&
          h(
            'p',
            null,
            [
              details.buyer,
              details.invoice.formal_po_id ? 'Formal PO' : 'Ad-hoc',
              capitalize(details.mode),
            ].join(' · '),
          ),
      ),
    ),
    details &&
      canEdit &&
      ['draft', 'finalized'].includes(details.status) &&
      h(
        DocumentDialog,
        {
          title: 'Edit invoice',
          label: details.status === 'draft' ? 'Edit draft' : 'Amend invoice',
          defer: true,
        },
        (onClose) => h(InvoiceEditor, { client, details, onClose, onSaved }),
      ),
    details &&
      canViewPacking &&
      ['finalized', 'dispatched'].includes(details.status) &&
      h(InvoicePacking, {
        client,
        invoice: details.invoice,
        canCreate: canCreatePacking && details.status === 'finalized',
      }),
    details?.status === 'dispatched' &&
      canCreateReturn &&
      h(
        DocumentDialog,
        { title: 'Record return', label: 'Record return', defer: true },
        (onClose) =>
          h(InvoiceReturn, {
            client,
            id,
            label: invoiceLabel(details.invoice.invoice_number, id),
            onClose,
            onSaved,
          }),
      ),
    error && h('p', { role: 'alert' }, error),
    !details && !error && h('p', { role: 'status' }, 'Loading invoice…'),
    fields &&
      h(
        'div',
        { className: 'fabric-line' },
        h('h2', null, 'Invoice details'),
        h(
          'dl',
          { className: 'billing-meta' },
          fields.map(([label, value]) =>
            h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '—')),
          ),
        ),
      ),
    details?.lines?.length > 0 &&
      h(
        'section',
        { className: 'fabric-line' },
        h('h2', null, 'Invoice lines'),
        h(BillingTable, {
          columns: [
            { key: 'item', label: 'Item / sellable product' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'price', label: 'Unit price' },
            { key: 'value', label: 'Billed value' },
          ],
          rows: details.lines.map((line) => {
            const pieces = line.pieces ?? [];
            const standard = line.billed_units != null;
            const count = standard
              ? line.billed_units
              : pieces.reduce((sum, piece) => sum + Number(piece.billed_pieces), 0);
            const piecePrices = new Set(pieces.map(({ price_per_piece }) => price_per_piece));
            const price = standard
              ? line.unit_price
              : piecePrices.size === 1
                ? pieces[0].price_per_piece
                : null;
            const value = standard
              ? count * line.unit_price
              : pieces.reduce((sum, piece) => sum + piece.billed_pieces * piece.price_per_piece, 0);
            return {
              id: line.id,
              item: line.product_name ?? pieces[0]?.style,
              quantity: count + (standard ? ' sets' : ' pieces'),
              price: price == null ? 'By size' : money.format(price),
              value: money.format(value),
            };
          }),
        }),
        h('h3', null, 'Physical composition by size'),
        h(BillingTable, {
          columns: lineColumns,
          rows: details.lines.flatMap((line) =>
            (line.pieces ?? []).map((piece) => ({
              ...piece,
              item: line.product_name ?? piece.style,
              quantity: piece.billed_pieces,
              price: piece.price_per_piece == null ? null : money.format(piece.price_per_piece),
            })),
          ),
        }),
      ),
    totals &&
      h(
        'section',
        { className: 'fabric-line billing-totals', 'aria-label': 'Invoice totals' },
        h(
          'dl',
          null,
          totals.map(([label, value]) =>
            h('div', { key: label }, h('dt', null, label), h('dd', null, value ?? '—')),
          ),
        ),
      ),
    details?.status === 'dispatched' && canViewReturns && h(InvoiceReturnHistory, { client, id }),
  );
}

export function BillingInvoices({
  client,
  capabilities,
  invoiceToOpen,
  onInvoiceOpened,
  canCreate,
  createInvoice,
  canEdit,
  canViewPacking,
  canCreatePacking,
  formalPO,
  onFormalPOOpened,
  canCreateReturn,
  canViewReturns,
  openPO,
}) {
  const [view, setView] = useState('overview');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [invoice, setInvoice] = useState(null);
  const [selection, setSelection] = useState(null);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sheetQuery = useGridSearch(search.trim());
  const [overviewQuery, onSearch] = useBillingOverviewSearch(setPage);
  const query = view === 'sheet' ? sheetQuery : overviewQuery;
  useEffect(() => {
    if (invoiceToOpen) {
      setInvoice(invoiceToOpen);
      onInvoiceOpened();
    }
  }, [invoiceToOpen, onInvoiceOpened]);

  useEffect(() => {
    let current = true;
    setError('');
    setSelection(null);
    setData(null);
    client
      .rpc('erp_portal_invoice_list', {
        p_search: query,
        p_status: status || null,
        p_limit: pageSize + 1,
        p_offset: page * pageSize,
      })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else setData(data);
      });
    return () => {
      current = false;
    };
  }, [client, query, status, page, revision]);

  const records = useMemo(
    () =>
      (data || []).slice(0, pageSize).map((record) => ({
        ...record,
        invoice: invoiceLabel(record.invoice_number, record.id),
        source: record.po_number || 'Ad-hoc',
        mode: capitalize(record.mode),
        status: capitalize(record.status),
      })),
    [data],
  );

  if (formalPO !== null && formalPO !== undefined && canCreate)
    return h(
      'section',
      null,
      h(
        'div',
        { className: 'editor-heading' },
        h('h1', null, 'New invoice'),
        h('button', { type: 'button', onClick: onFormalPOOpened }, 'Back to invoices'),
      ),
      h(InvoiceEditor, { client, formalPO, onClose: onFormalPOOpened, onSaved: saved }),
    );

  function saved(id) {
    setInvoice(id);
    setRevision((value) => value + 1);
  }
  if (invoice)
    return h(InvoiceDetail, {
      key: invoice + ':' + revision,
      client,
      id: invoice,
      onBack: () => setInvoice(null),
      onSaved: saved,
      canEdit,
      canViewPacking,
      canCreatePacking,
      canCreateReturn,
      canViewReturns,
      openPO,
    });
  const statusFilter = h(
    'select',
    {
      'aria-label': 'Invoice status',
      value: status,
      onChange: (event) => {
        setSelection(null);
        setStatus(event.target.value);
        setPage(0);
      },
    },
    h('option', { value: '' }, 'All statuses'),
    statuses.map((value) => h('option', { key: value, value }, capitalize(value))),
  );
  const add =
    canCreate &&
    createInvoice &&
    h(
      'button',
      { type: 'button', className: 'primary', onClick: () => createInvoice() },
      'New invoice',
    );
  return h(
    'section',
    null,
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('h1', null, 'Invoices'),
        h('p', null, 'Create drafts and track finalized invoices, dispatch and returns.'),
      ),
      h(BillingViewActions, {
        view,
        title: 'Invoices',
        add,
        onChange: (next) => {
          setSelection(null);
          if (overviewQuery !== sheetQuery) setPage(0);
          setView(next);
        },
      }),
    ),
    view === 'sheet' &&
      h(
        'div',
        { className: 'fabric-actions' },
        h(GridSearch, {
          label: 'Search invoice number, buyer or PO',
          value: search,
          onChange: (value) => {
            setSelection(null);
            setSearch(value);
            setPage(0);
          },
        }),
        statusFilter,
        add,
        canEdit &&
          h(
            DocumentDialog,
            {
              record: true,
              defer: true,
              title: 'Edit invoice',
              label: 'Edit selected document',
              disabled: !selection || !['Draft', 'Finalized'].includes(selection.status),
            },
            (onClose) =>
              h(InvoiceEditRecord, { client, id: selection.id, onClose, onSaved: saved }),
          ),
        h(
          'button',
          {
            type: 'button',
            disabled: !selection,
            onClick: () => setInvoice(selection.id),
          },
          'Open selected invoice',
        ),
      ),
    (error || notice) && h('p', { role: error ? 'alert' : 'status' }, error || notice),
    !data && !error && h('p', { role: 'status' }, 'Loading invoices…'),
    view === 'sheet'
      ? data &&
          h(FabricSheet, {
            client,
            page: 'billing-invoices',
            spec,
            records,
            capabilities,
            onNotice: setNotice,
            onSelect: setSelection,
            paged: page > 0 || data.length > pageSize,
          })
      : h(BillingOverview, {
          client,
          page: 'billing-invoices',
          title: 'Invoices',
          columns: spec.columns,
          hidden: ['mode', 'verified_credit'],
          rows: data ? records : undefined,
          onOpen: setInvoice,
          opensDialog: false,
          onSearch,
          searchLabel: 'Search invoice number, buyer or PO',
          toolbar: statusFilter,
          render: (row, key) =>
            key === 'status'
              ? h(BillingStatus, { value: row.status })
              : key === 'original_value' || (key === 'verified_credit' && row[key])
                ? money.format(row[key])
                : key === 'verified_credit'
                  ? '—'
                  : row[key],
        }),
    view === 'sheet' && data && !records.length && h('p', null, 'No invoices found.'),
    (page > 0 || (data?.length ?? 0) > pageSize) &&
      h(
        'div',
        { className: 'fabric-actions' },
        h(
          'button',
          { type: 'button', disabled: page === 0, onClick: () => setPage(page - 1) },
          'Previous',
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: (data?.length ?? 0) <= pageSize,
            onClick: () => setPage(page + 1),
          },
          'Next',
        ),
      ),
  );
}
