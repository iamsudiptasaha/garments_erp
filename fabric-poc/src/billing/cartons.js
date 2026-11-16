import { BillingOverview, BillingRelatedRecord } from './overview.js';
import { PackingDetail } from './packing-lists.js';
import { createElement as h, useMemo, useState } from 'react';
import { FinishedGoodsEditor as DocumentDialog } from '../finished-goods/sheet-view.js';
import { useGridSearch } from '../fabric/grid-toolbar.js';
import {
  BillingPagination,
  BillingRecordWorkspace,
  BillingStatus,
  BillingTable,
  useBillingQuery,
} from './record-workspace.js';

const columns = [
  { key: 'carton_number', label: 'Carton' },
  { key: 'packing_list_number', label: 'Packing list' },
  { key: 'invoice_number', label: 'Invoice' },
  { key: 'transport', label: 'Transport' },
  { key: 'status', label: 'Status' },
];
const allocationColumns = [
  { key: 'item', label: 'Billed item' },
  { key: 'size', label: 'Size' },
  { key: 'unit', label: 'Unit' },
  { key: 'available', label: 'Available to pack' },
  { key: 'quantity', label: 'Pack quantity' },
];
const contentColumns = [
  { key: 'item', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'pieces', label: 'Pieces', numeric: true },
];

export function CartonContents({ client, list, id }) {
  const args = useMemo(() => ({ p_list_id: list, p_carton_id: id }), [list, id]);
  const { data, error } = useBillingQuery(client, 'erp_portal_carton_workspace', args);
  if (!data)
    return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading carton contents…');
  return h(BillingTable, { columns: contentColumns, rows: data.contents });
}

const noLists = [];

function CartonForm({
  client,
  carton,
  lists,
  onClose,
  refresh,
  editable = true,
  deleting = false,
}) {
  const [list, setList] = useState(carton?.packing_id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const args = useMemo(
    () => ({ p_list_id: list || null, p_carton_id: carton?.id ?? null }),
    [list, carton?.id],
  );
  const lookup = useBillingQuery(client, 'erp_portal_carton_workspace', args);
  const allocations = list && lookup.data?.allocations;
  const options =
    carton && !lists.some(({ id }) => id === carton.packing_id)
      ? [{ id: carton.packing_id, label: carton.packing_list_number }, ...lists]
      : lists;

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const lines = new Map();
    if (!deleting) {
      for (const row of allocations ?? []) {
        const pieces = Number(form.get('qty-' + (row.billed_piece_id ?? row.line_id)));
        if (!pieces) continue;
        if (!row.billed_piece_id) lines.set(row.line_id, { line_id: row.line_id, sets: pieces });
        else {
          const line = lines.get(row.line_id) ?? { line_id: row.line_id, pieces: [] };
          line.pieces.push({ billed_piece_id: row.billed_piece_id, pieces });
          lines.set(row.line_id, line);
        }
      }
      if (!lines.size) {
        setError('Allocate at least one billed quantity.');
        return;
      }
    }
    setBusy(true);
    setError('');
    const result = await client.rpc('erp_portal_save_carton', {
      p_request_id: crypto.randomUUID(),
      p_packing_list_id: list,
      p_carton_id: carton?.id ?? null,
      p_barcode: form.get('barcode') ?? carton?.barcode ?? null,
      p_allocations: [...lines.values()],
    });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else {
      onClose();
      refresh();
    }
  }

  return h(
    'form',
    { onSubmit: save },
    deleting
      ? h(
          'p',
          null,
          'Delete ' +
            carton.carton_number +
            ' and release its packed quantities?' +
            (carton.transport_id ? ' This also removes its planned transport assignment.' : ''),
        )
      : h(
          'section',
          { className: 'fabric-line' },
          h(
            'div',
            { className: 'fabric-fields' },
            h(
              'label',
              null,
              'Packing list',
              h(
                'select',
                {
                  'aria-label': 'Packing list',
                  value: list,
                  required: true,
                  disabled: !editable || Boolean(carton?.transport_id),
                  onChange: (event) => setList(event.target.value),
                },
                h('option', { value: '' }, 'Select packing list'),
                options.map(({ id, label }) => h('option', { value: id, key: id }, label)),
              ),
            ),
            h(
              'label',
              null,
              'Barcode',
              h('input', { name: 'barcode', defaultValue: carton?.barcode, readOnly: !editable }),
            ),
          ),
          h('h3', null, editable ? 'Allocate billed quantities' : 'Carton contents'),
          lookup.error && h('p', { role: 'alert' }, lookup.error),
          !editable && h(CartonContents, { client, list, id: carton.id }),
          editable &&
            allocations &&
            h(BillingTable, {
              key: list,
              columns: allocationColumns,
              rows: allocations
                .filter((row) => editable || row.quantity > 0)
                .map((row) => ({ ...row, id: row.billed_piece_id ?? row.line_id })),
              render: (row, key) =>
                key === 'quantity' && editable
                  ? h('input', {
                      type: 'number',
                      min: 0,
                      max: row.available,
                      step: 1,
                      'aria-label':
                        'Pack quantity for ' + row.item + (row.size ? ' · ' + row.size : ''),
                      name: 'qty-' + row.id,
                      defaultValue: row.quantity,
                    })
                  : row[key],
            }),
        ),
    error && h('p', { role: 'alert' }, error),
    (editable || deleting) &&
      h(
        'button',
        { type: 'submit', className: 'primary', disabled: busy || (!deleting && !allocations) },
        deleting ? 'Delete carton' : 'Save carton',
      ),
  );
}

export function BillingCartons({
  client,
  capabilities,
  canCreate,
  canEdit,
  canDelete,
  openInvoice,
  canViewPacking,
  openTransport,
}) {
  const [search, setSearch] = useState('');
  const [opened, setOpened] = useState(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const query = useGridSearch(search.trim().toLowerCase());
  const args = useMemo(() => ({ p_offset: offset }), [offset]);
  const { data, error } = useBillingQuery(client, 'erp_portal_carton_workspace', args, revision);
  const rows = useMemo(
    () =>
      data?.cartons.slice(0, 50).map((row) => ({
        ...row,
        transport: row.transport_id ? 'TR-' + row.transport_id.padStart(4, '0') : null,
      })),
    [data],
  );
  const sheetRows = useMemo(
    () =>
      rows?.filter((row) =>
        [row.carton_number, row.invoice_number, row.packing_list_number, row.transport].some(
          (value) => value?.toLowerCase().includes(query),
        ),
      ),
    [rows, query],
  );
  const refresh = () => setRevision((value) => value + 1);
  function editor(carton, label, editable, disabled = false, deleting = false, onDismiss) {
    const title = deleting
      ? 'Delete carton'
      : !carton
        ? 'Add carton'
        : editable
          ? 'Edit carton'
          : 'Carton details';
    return h(
      DocumentDialog,
      { record: Boolean(carton) || disabled, defer: !onDismiss, label, title, disabled, onDismiss },
      (onClose) =>
        h(CartonForm, {
          client,
          carton,
          lists: data?.packing_lists ?? noLists,
          onClose,
          refresh,
          editable,
          deleting,
        }),
    );
  }
  const editable = (row) => Boolean(canEdit && row && row.status !== 'Dispatched');
  const paged = offset > 0 || data?.cartons.length > 50;
  return h(
    BillingRecordWorkspace,
    {
      title: 'Cartons',
      subtitle: 'Carton contents and transport assignments.',
      page: 'billing-cartons',
      columns,
      rows: sheetRows,
      client,
      capabilities,
      search,
      setSearch,
      paged,
      add: canCreate && data && editor(null, 'Add carton', true),
      selectedActions: (row) =>
        h(
          'div',
          { className: 'fabric-actions' },
          editor(row, 'Open selected document', false, !row),
          canEdit && editor(row, 'Edit selected document', true, !editable(row)),
        ),
      footer: h(BillingPagination, {
        offset,
        onChange: setOffset,
        hasNext: data?.cartons.length > 50,
      }),
    },
    error
      ? h('p', { role: 'alert' }, error)
      : !rows
        ? h('p', { role: 'status' }, 'Loading cartons…')
        : h(
            'div',
            null,
            paged && h('p', null, 'Search applies to this page.'),
            h(BillingOverview, {
              client,
              page: 'billing-cartons',
              title: 'Cartons',
              columns,
              rows,
              onOpen: (id) => setOpened(rows.find((row) => row.id === id)),
              actions: canDelete
                ? (row) => row.status !== 'Dispatched' && editor(row, 'Delete', false, false, true)
                : undefined,
              render: (row, key) => {
                if (key === 'packing_list_number' && canViewPacking)
                  return h(
                    DocumentDialog,
                    {
                      record: true,
                      defer: true,
                      label: row.packing_list_number,
                      title: 'Packing list details',
                    },
                    () => h(PackingDetail, { client, id: row.packing_id, openInvoice }),
                  );
                if (key === 'invoice_number')
                  return h(BillingRelatedRecord, {
                    value: row[key],
                    id: row.billing_id,
                    open: openInvoice,
                  });
                if (key === 'transport')
                  return h(BillingRelatedRecord, {
                    value: row[key],
                    id: row.transport_id,
                    open: openTransport,
                  });
                if (key === 'status') return h(BillingStatus, { value: row.status });
                return row[key];
              },
            }),
            opened &&
              editor(opened, opened.carton_number, editable(opened), false, false, () =>
                setOpened(null),
              ),
          ),
  );
}
