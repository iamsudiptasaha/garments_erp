import { BillingOverview } from './overview.js';
import { fileRecordPath } from '../access/workspace-routes.js';
import { RecordAttachmentField, useRecordAttachments } from '../files/record-attachments.js';
import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import { createElement as h, useEffect, useMemo, useState } from 'react';
import { FinishedGoodsEditor as DocumentDialog } from '../finished-goods/sheet-view.js';
import { CartonContents } from './cartons.js';
import { useGridSearch } from '../fabric/grid-toolbar.js';
import {
  BillingPagination,
  BillingRecordWorkspace,
  BillingStatus,
  BillingTable,
} from './record-workspace.js';

const columns = [
  { key: 'number', label: 'Transport' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'docket_number', label: 'Docket' },
  { key: 'appointment_date', label: 'Pickup date' },
  { key: 'carton_count', label: 'Cartons', numeric: true },
  { key: 'status', label: 'Status' },
];
const cartonColumns = [
  { key: 'number', label: 'Carton' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'packing', label: 'Invoice packing' },
];

function TransportEntry({ client, data, onClose, onSaved, canEdit }) {
  const attachments = useRecordAttachments(client);
  const review = useSaveReview();
  const { busy } = review;
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);

    const payload = {
      p_transporter_id: fields.get('carrier'),
      p_docket: fields.get('docket').trim(),
      p_date: fields.get('date'),
      p_cartons: fields.getAll('carton'),
    };
    setError('');
    let files;
    try {
      files = attachments.prepare();
    } catch (failure) {
      setError(failure.message);
      return;
    }
    review.prepare(
      payload,
      [
        ['Carrier', data.carriers.find(({ id }) => id === payload.p_transporter_id)?.name],
        ['Docket number', payload.p_docket],
        ['Pickup date', payload.p_date],
        ...files.rows,
        ...data.available_cartons
          .filter(({ id }) => payload.p_cartons.includes(id))
          .map((carton) => ['Carton', carton.number + ' · ' + carton.invoice]),
      ],
      async (reviewed, requestId) => {
        await files.confirm(async () => {
          const result = await client.rpc('erp_portal_create_transport', {
            ...reviewed,
            p_request_id: requestId,
          });
          if (result.error) throw result.error;
          if (!files.rows.length) return null;
          const workspace = await client.rpc('erp_portal_dispatch_workspace', {
            p_transport_id: result.data,
          });
          if (workspace.error) throw workspace.error;
          return workspace.data.transports[0]?.docket_id;
        });
        onClose();
        onSaved();
      },
      'Review transport',
    );
  }
  return h(
    ReviewForm,
    { review, onSubmit: save },
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Transport details'),
      h(
        'div',
        { className: 'fabric-fields' },
        h(
          'label',
          null,
          'Carrier',
          h(
            'select',
            { name: 'carrier', required: true, 'aria-label': 'Carrier' },
            h('option', { value: '' }, 'Select carrier'),
            data.carriers.map((carrier) =>
              h('option', { key: carrier.id, value: carrier.id }, carrier.name),
            ),
          ),
        ),
        h('label', null, 'Docket number', h('input', { name: 'docket', required: true })),
        h('label', null, 'Pickup date', h('input', { name: 'date', type: 'date', required: true })),
      ),
    ),
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Available cartons'),
      data.available_cartons.length
        ? data.available_cartons.map((carton) =>
            h(
              'label',
              { key: carton.id },
              h('input', { type: 'checkbox', name: 'carton', value: carton.id }),
              carton.number + ' · ' + carton.invoice,
            ),
          )
        : h('p', null, 'Add a carton to a packing list first.'),
    ),
    h(RecordAttachmentField, {
      attachments,
      client,
      targetKey: 'transportDocket',
      canWrite: canEdit,
    }),
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'editor-actions' },
      h(
        'button',
        { type: 'submit', className: 'primary', disabled: busy || !data.available_cartons.length },
        'Review transport',
      ),
    ),
  );
}

function TransportBillEntry({ client, onClose, canEdit }) {
  const review = useSaveReview();
  const attachments = useRecordAttachments(client);
  const [error, setError] = useState('');
  function save(event) {
    const fields = new FormData(event.currentTarget);
    const payload = {
      p_invoice_number: fields.get('invoice').trim(),
      p_invoice_date: fields.get('date'),
    };
    let files;
    try {
      files = attachments.prepare();
      setError('');
    } catch (failure) {
      setError(failure.message);
      return;
    }
    review.prepare(
      payload,
      [
        ['Invoice number', payload.p_invoice_number],
        ['Invoice date', payload.p_invoice_date],
        ...files.rows,
      ],
      async (reviewed, requestId) => {
        await files.confirm(async () => {
          const response = await client.rpc('erp_portal_create_transport_bill', {
            ...reviewed,
            p_request_id: requestId,
          });
          if (response.error) throw response.error;
          return response.data;
        });
        onClose();
      },
      'Review transport bill',
    );
  }
  return h(
    ReviewForm,
    { review, onSubmit: save },
    h(
      'div',
      { className: 'fabric-fields' },
      h('label', null, 'Invoice number', h('input', { name: 'invoice', required: true })),
      h('label', null, 'Invoice date', h('input', { name: 'date', type: 'date', required: true })),
    ),
    h(RecordAttachmentField, {
      attachments,
      client,
      targetKey: 'transportBill',
      canWrite: canEdit,
    }),
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'editor-actions' },
      h('button', { type: 'submit', className: 'primary' }, 'Review transport bill'),
    ),
  );
}

function Pickup({ client, transport, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function dispatch() {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await client.rpc('erp_portal_dispatch_transport', {
      p_request_id: crypto.randomUUID(),
      p_transport_id: transport.id,
    });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else {
      onClose();
      onSaved();
    }
  }
  return h(
    'section',
    { className: 'fabric-line' },
    h('h3', null, transport.number),
    h('p', null, [transport.docket_number, transport.appointment_date].filter(Boolean).join(' · ')),
    h(BillingTable, { columns: cartonColumns, rows: transport.cartons }),
    error && h('p', { role: 'alert' }, error),
    h(
      'button',
      { type: 'button', className: 'primary', disabled: busy, onClick: dispatch },
      'Dispatch cartons',
    ),
  );
}

export function BillingDispatch({
  client,
  canCreate,
  canEdit,
  capabilities,
  openInvoice,
  canViewCartons,
  transportToOpen,
  onTransportOpened,
}) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState('overview');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [openedTransport, setOpenedTransport] = useState(transportToOpen);
  useEffect(() => {
    if (transportToOpen) onTransportOpened();
  }, [transportToOpen, onTransportOpened]);
  const query = useGridSearch(search.trim().toLowerCase());

  useEffect(() => {
    let current = true;
    setData(null);
    setSelected(openedTransport);
    setError('');
    client
      .rpc('erp_portal_dispatch_workspace', { p_offset: offset, p_transport_id: openedTransport })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else setData(data);
      });
    return () => {
      current = false;
    };
  }, [client, offset, version, openedTransport]);

  const rows = useMemo(
    () =>
      data?.transports
        .slice(0, 50)
        .map((row) => ({ ...row, number: 'TR-' + row.id.padStart(4, '0') }))
        .filter((row) => !status || row.status === status),
    [data, status],
  );
  const sheetRows = useMemo(
    () =>
      rows?.filter((row) =>
        [row.number, row.carrier, row.docket_number].some((value) =>
          value?.toLowerCase().includes(query),
        ),
      ),
    [rows, query],
  );
  const current = (view === 'sheet' ? sheetRows : rows)?.find(({ id }) => id === selected);
  const refresh = () => setVersion((value) => value + 1);
  function pickup(row) {
    return (
      canEdit &&
      row?.status === 'Planned' &&
      h(
        DocumentDialog,
        { defer: true, record: true, label: 'Confirm pickup', title: 'Confirm pickup' },
        (onClose) => h(Pickup, { client, transport: row, onClose, onSaved: refresh }),
      )
    );
  }
  const add =
    data &&
    h(
      'div',
      { className: 'fabric-actions' },
      canCreate &&
        h(
          DocumentDialog,
          { defer: true, label: 'New transport', title: 'New transport' },
          (onClose) => h(TransportEntry, { client, data, onClose, onSaved: refresh, canEdit }),
        ),
      canCreate &&
        h(
          DocumentDialog,
          { defer: true, label: 'New transport bill', title: 'New transport bill' },
          (onClose) => h(TransportBillEntry, { client, onClose, canEdit }),
        ),
      h('a', { href: fileRecordPath('transportBill') }, 'Transport bill attachments'),
    );
  const paged = offset > 0 || data?.transports.length > 50;

  return h(
    BillingRecordWorkspace,
    {
      title: 'Dispatch / Transport',
      subtitle: 'Assign cartons and confirm pickup when invoice packing is complete.',
      page: 'billing-dispatch',
      columns,
      rows: sheetRows,
      onViewChange: setView,
      client,
      capabilities,
      search,
      setSearch,
      paged,
      add,
      selectedActions: (row) =>
        h(
          'div',
          { className: 'fabric-actions' },
          h(
            'button',
            { type: 'button', disabled: !row, onClick: () => setSelected(row.id) },
            'Open selected transport',
          ),
          pickup(row),
          row?.docket_number &&
            h(
              'a',
              {
                href: fileRecordPath('transportDocket', {
                  record: row.docket_id,
                  query: row.docket_number,
                }),
              },
              'Docket attachments',
            ),
        ),
      footer: h(
        'div',
        null,
        openedTransport &&
          h(
            'button',
            { type: 'button', onClick: () => setOpenedTransport(null) },
            'Back to transports',
          ),
        current &&
          h(
            'section',
            { className: 'fabric-line' },
            h('h2', null, 'Assigned cartons'),
            h(BillingTable, {
              columns: cartonColumns,
              rows: current.cartons,
              render: (carton, key) =>
                key === 'number' && canViewCartons
                  ? h(
                      DocumentDialog,
                      {
                        record: true,
                        defer: true,
                        label: carton.number,
                        title: carton.number,
                      },
                      () => h(CartonContents, { client, list: carton.packing_id, id: carton.id }),
                    )
                  : key === 'invoice' && openInvoice
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'open-document',
                          onClick: () => openInvoice(carton.billing_id),
                        },
                        carton.invoice,
                      )
                    : key === 'packing'
                      ? h(BillingStatus, { value: carton.packing })
                      : carton[key],
            }),
          ),
        h(BillingPagination, {
          offset,
          onChange: setOffset,
          hasNext: data?.transports.length > 50,
        }),
      ),
    },
    error
      ? h('p', { role: 'alert' }, error)
      : !rows
        ? h('p', { role: 'status' }, 'Loading transports…')
        : h(
            'div',
            null,
            paged && h('p', null, 'Search and status filters apply to this page.'),
            h(BillingOverview, {
              client,
              page: 'billing-dispatch',
              title: 'Dispatch / Transport',
              columns,
              rows,
              onOpen: setSelected,
              opensDialog: false,
              actions: canEdit ? pickup : undefined,
              toolbar: h(
                'label',
                null,
                'Status ',
                h(
                  'select',
                  { value: status, onChange: (event) => setStatus(event.target.value) },
                  h('option', { value: '' }, 'All statuses'),
                  h('option', null, 'Planned'),
                  h('option', null, 'Dispatched'),
                ),
              ),
              render: (row, key) =>
                key === 'status' ? h(BillingStatus, { value: row.status }) : row[key],
            }),
          ),
  );
}
