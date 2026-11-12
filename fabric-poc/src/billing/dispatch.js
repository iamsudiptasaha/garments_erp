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

function TransportEntry({ client, data, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await client.rpc('erp_portal_create_transport', {
      p_request_id: crypto.randomUUID(),
      p_transporter_id: fields.get('carrier'),
      p_docket: fields.get('docket').trim(),
      p_date: fields.get('date'),
      p_cartons: fields.getAll('carton'),
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
    { onSubmit: save },
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
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'editor-actions' },
      h(
        'button',
        { type: 'submit', className: 'primary', disabled: busy || !data.available_cartons.length },
        'Save transport',
      ),
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
        .filter(
          (row) =>
            (!status || row.status === status) &&
            [row.number, row.carrier, row.docket_number].some((value) =>
              value?.toLowerCase().includes(query),
            ),
        ),
    [data, status, query],
  );
  const current = rows?.find(({ id }) => id === selected);
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
    canCreate &&
    data &&
    h(DocumentDialog, { defer: true, label: 'New transport', title: 'New transport' }, (onClose) =>
      h(TransportEntry, { client, data, onClose, onSaved: refresh }),
    );
  const paged = offset > 0 || data?.transports.length > 50;

  return h(
    BillingRecordWorkspace,
    {
      title: 'Dispatch / Transport',
      subtitle: 'Assign cartons and confirm pickup when invoice packing is complete.',
      page: 'billing-dispatch',
      columns,
      rows,
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
            h(
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
            paged && h('p', null, 'Search and status filters apply to this page.'),
            h(BillingTable, {
              columns: [...columns, { key: 'action', label: 'Action' }],
              rows,
              render: (row, key) =>
                key === 'number'
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'open-document',
                        onClick: () => setSelected(row.id),
                      },
                      row.number,
                    )
                  : key === 'action'
                    ? pickup(row)
                    : key === 'status'
                      ? h(BillingStatus, { value: row.status })
                      : row[key],
            }),
          ),
  );
}
