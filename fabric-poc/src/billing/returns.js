import { fileRecordPath } from '../access/workspace-routes.js';
import { RecordAttachmentField, useRecordAttachments } from '../files/record-attachments.js';
import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
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
  { key: 'number', label: 'Return' },
  { key: 'invoice_number', label: 'Invoice' },
  { key: 'item', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'pieces', label: 'Pieces', numeric: true },
  { key: 'price', label: 'Confirmed price', numeric: true },
  { key: 'credit', label: 'Credit', numeric: true },
  { key: 'verifier', label: 'Verified by' },
  { key: 'status', label: 'Status' },
];
const partColumns = [
  { key: 'item', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'remaining', label: 'Returnable' },
  { key: 'quantity', label: 'Qty' },
  { key: 'suggested_price', label: 'Suggested price' },
  { key: 'price', label: 'Confirmed price' },
  { key: 'price_ceiling', label: 'Price ceiling' },
];
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export function ReturnEntry({ client, records, onClose, refresh, invoiceId, canEditFiles }) {
  const attachments = useRecordAttachments(client);
  const [invoice, setInvoice] = useState(invoiceId ?? records.invoices[0]?.id ?? '');
  const [error, setError] = useState('');
  const review = useSaveReview();
  const { busy } = review;
  const [credit, setCredit] = useState(0);
  const args = useMemo(() => ({ p_invoice_id: invoice || null }), [invoice]);
  const lookup = useBillingQuery(client, 'erp_portal_return_workspace', args);
  const rows = invoice ? (lookup.data?.pieces ?? []) : [];

  function entries(form) {
    return rows
      .map((row) => ({
        row,
        quantity: Number(form.get('qty-' + row.id)),
        price: form.get('price-' + row.id),
      }))
      .filter(({ quantity }) => quantity > 0);
  }

  async function verify(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const pieces = entries(form);
    if (!pieces.length) {
      setError('Enter at least one physical piece to return.');
      return;
    }
    if (pieces.some(({ price }) => price === '')) {
      setError('Enter a confirmed price for each returned item.');
      return;
    }
    const lines = new Map();
    for (const { row, quantity, price } of pieces) {
      const line = lines.get(row.line_id) ?? {
        mode: 'piece',
        billing_item_id: row.line_id,
        reason_id: form.get('reason') || null,
        pieces_by_size: [],
      };
      line.pieces_by_size.push({ billed_piece_id: row.id, pieces: quantity, price });
      lines.set(row.line_id, line);
    }

    const payload = {
      p_billing_id: invoice,
      p_lines: [...lines.values()],
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
        ...files.rows,
        ['Invoice', records.invoices.find(({ id }) => id === invoice)?.label ?? invoice],
        [
          'Reason',
          Array.from(event.currentTarget.elements.reason.options).find(({ selected }) => selected)
            ?.text,
        ],
        ...pieces.map(({ row, quantity, price }) => [
          row.item + ' · ' + row.size,
          quantity + ' pieces × ' + money.format(Number(price)),
        ]),
        [
          'Estimated credit',
          money.format(
            pieces.reduce((sum, { quantity, price }) => sum + quantity * Number(price), 0),
          ),
        ],
      ],
      async (reviewed, requestId) => {
        await files.confirm(async () => {
          const result = await client.rpc('erp_portal_verify_return', {
            ...reviewed,
            p_request_id: requestId,
          });
          if (result.error) throw result.error;
          return result.data;
        });
        onClose();
        refresh();
      },
      'Review return',
    );
  }

  return h(
    ReviewForm,
    {
      review,
      onSubmit: verify,
      onInput: (event) =>
        setCredit(
          entries(new FormData(event.currentTarget)).reduce(
            (sum, { quantity, price }) => sum + quantity * Number(price),
            0,
          ),
        ),
    },
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Return details'),
      h(
        'div',
        { className: 'fabric-fields' },
        h(
          'label',
          null,
          'Dispatched invoice',
          h(
            'select',
            {
              'aria-label': 'Dispatched invoice',
              value: invoice,
              required: true,
              disabled: Boolean(invoiceId),
              onChange: (event) => {
                setInvoice(event.target.value);
                setCredit(0);
              },
            },
            h('option', { value: '' }, 'Select invoice'),
            records.invoices.map(({ id, label }) => h('option', { key: id, value: id }, label)),
          ),
        ),
        h(
          'label',
          null,
          'Reason',
          h(
            'select',
            { name: 'reason', 'aria-label': 'Reason' },
            h('option', { value: '' }, 'Select reason'),
            records.reasons.map(({ id, name }) => h('option', { key: id, value: id }, name)),
          ),
        ),
      ),
    ),
    lookup.error && h('p', { role: 'alert' }, lookup.error),
    rows.length > 0 &&
      h(
        'section',
        { className: 'fabric-line' },
        h('h3', null, 'Physical pieces by billed size'),
        h(BillingTable, {
          key: invoice,
          columns: partColumns,
          rows,
          render: (row, key) =>
            key === 'quantity'
              ? h('input', {
                  name: 'qty-' + row.id,
                  type: 'number',
                  step: 1,
                  min: 0,
                  max: row.remaining,
                  defaultValue: 0,
                  'aria-label': 'Pieces for ' + row.item + ' · ' + row.size,
                })
              : key === 'price'
                ? h('input', {
                    name: 'price-' + row.id,
                    type: 'number',
                    step: 'any',
                    min: 0,
                    max: row.price_ceiling,
                    defaultValue: row.suggested_price,
                    'aria-label': 'Price for ' + row.item + ' · ' + row.size,
                  })
                : key.endsWith('price') || key === 'price_ceiling'
                  ? money.format(row[key])
                  : row[key],
        }),
      ),
    lookup.data && !rows.length && h('p', null, 'No returnable pieces.'),
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Credit'),
      h('p', null, 'Remaining credit · ' + money.format(lookup.data?.remaining_credit ?? 0)),
      h('p', null, 'This return · ' + money.format(credit)),
      h('p', null, 'Verified by · ' + records.employee),
    ),
    h(RecordAttachmentField, {
      attachments,
      client,
      targetKey: 'returnBill',
      canWrite: canEditFiles,
    }),
    error && h('p', { role: 'alert' }, error),
    h(
      'button',
      { type: 'submit', className: 'primary', disabled: busy || !rows.length },
      'Review return',
    ),
  );
}

export function BillingReturns({ client, capabilities, canCreate, canEdit, openInvoice }) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const query = useGridSearch(search.trim().toLowerCase());
  const args = useMemo(() => ({ p_offset: offset }), [offset]);
  const { data, error } = useBillingQuery(client, 'erp_portal_return_workspace', args, revision);
  const rows = useMemo(
    () =>
      data?.returns
        .slice(0, 50)
        .flatMap((row) => {
          const header = {
            ...row,
            return_id: row.id,
            number: 'RET-' + row.id.padStart(4, '0'),
            status: 'Verified',
          };
          return row.parts.length
            ? row.parts.map((part) => ({ ...header, ...part, id: row.id + ':' + part.id }))
            : [header];
        })
        .filter((row) =>
          [row.number, row.invoice_number, row.item, row.verifier].some((value) =>
            value?.toLowerCase().includes(query),
          ),
        ),
    [data, query],
  );
  const refresh = () => setRevision((value) => value + 1);
  const paged = offset > 0 || data?.returns.length > 50;
  return h(
    BillingRecordWorkspace,
    {
      title: 'Returns',
      subtitle: 'Verify physical pieces against their original billed quantities.',
      page: 'billing-returns',
      columns,
      rows,
      client,
      capabilities,
      search,
      setSearch,
      paged,
      add:
        canCreate &&
        data &&
        h(
          DocumentDialog,
          { defer: true, title: 'Record return', label: 'Record return' },
          (onClose) =>
            h(ReturnEntry, { client, records: data, onClose, refresh, canEditFiles: canEdit }),
        ),
      selectedActions: (row) =>
        h(
          'div',
          { className: 'fabric-actions' },
          openInvoice &&
            h(
              'button',
              {
                type: 'button',
                disabled: !row,
                onClick: () => openInvoice(row.billing_id),
              },
              'Open selected invoice',
            ),
          row &&
            h(
              'a',
              { href: fileRecordPath('returnBill', { record: row.return_id }) },
              'Return attachments',
            ),
        ),
      footer: h(BillingPagination, {
        offset,
        onChange: setOffset,
        hasNext: data?.returns.length > 50,
      }),
    },
    error
      ? h('p', { role: 'alert' }, error)
      : !rows
        ? h('p', { role: 'status' }, 'Loading returns…')
        : h(
            'div',
            null,
            paged && h('p', null, 'Search applies to this page.'),
            h(BillingTable, {
              columns,
              rows,
              render: (row, key) =>
                (key === 'credit' || key === 'price') && row[key] != null
                  ? money.format(row[key])
                  : key === 'invoice_number' && openInvoice
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'open-document',
                          onClick: () => openInvoice(row.billing_id),
                        },
                        row.invoice_number,
                      )
                    : key === 'status'
                      ? h(BillingStatus, { value: row.status })
                      : row[key],
            }),
          ),
  );
}
