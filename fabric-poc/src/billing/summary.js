import { createElement as h, useEffect, useMemo, useState } from 'react';
import { useGridSearch } from '../fabric/grid-toolbar.js';
import { BillingPagination, BillingRecordWorkspace, BillingTable } from './record-workspace.js';

const stockColumns = [
  { key: 'style', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'produced', label: 'Recorded stock-in', numeric: true },
  { key: 'available', label: 'Available pieces', numeric: true },
];
const activityColumns = [
  { key: 'label', label: 'Status' },
  { key: 'count', label: 'Invoices' },
  { key: 'next', label: 'Next step' },
];
const statuses = [
  ['draft', 'Draft', 'Finalize or cancel'],
  ['finalized', 'Finalized', 'Pack and dispatch'],
  ['dispatched', 'Dispatched', 'Review or verify returns'],
  ['cancelled', 'Cancelled', 'View retained record'],
];
const cards = [
  ['original_value', 'Original billed value', 'Finalized and dispatched invoices'],
  ['verified_credit', 'Verified return credits', 'Before GST'],
  ['taxable_value', 'Net billed value', 'Taxable value after verified returns'],
];
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export function BillingSummary({ client, capabilities, openInvoices, createInvoice }) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const query = useGridSearch(search.trim());
  useEffect(() => {
    let current = true;
    setError('');
    setData(null);
    client
      .rpc('erp_portal_billing_summary', { p_search: query, p_offset: offset })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else setData(data);
      });
    return () => {
      current = false;
    };
  }, [client, offset, query]);
  const rows = useMemo(() => data?.stock.slice(0, 50), [data]);
  return h(
    BillingRecordWorkspace,
    {
      title: 'Billing Summary',
      subtitle: 'Invoice activity, verified credits and fulfilment.',
      page: 'billing-summary',
      columns: stockColumns,
      rows,
      client,
      capabilities,
      search,
      setSearch: (value) => {
        setSearch(value);
        setOffset(0);
      },
      paged: offset > 0 || data?.stock.length > 50,
      add:
        createInvoice &&
        h(
          'button',
          { type: 'button', className: 'primary', onClick: () => createInvoice() },
          'New invoice',
        ),
      footer: h(BillingPagination, {
        offset,
        onChange: setOffset,
        hasNext: data?.stock.length > 50,
      }),
    },
    error
      ? h('p', { role: 'alert' }, error)
      : !data
        ? h('p', { role: 'status' }, 'Loading billing summary…')
        : h(
            'div',
            null,
            h(
              'div',
              { className: 'overview-grid' },
              cards.map(([key, title, caption]) =>
                h(
                  'article',
                  { key, className: 'overview-card' },
                  h('span', { className: 'card-kicker' }, title),
                  h('h2', null, money.format(data.totals[key])),
                  h('p', { className: 'card-subtitle' }, caption),
                ),
              ),
            ),
            h(
              'section',
              { className: 'fabric-line' },
              h('h2', null, 'Invoice activity'),
              h(BillingTable, {
                columns: activityColumns,
                rows: statuses.map(([id, label, next]) => ({
                  id,
                  label,
                  next,
                  count: data.statuses[id] ?? 0,
                })),
              }),
              openInvoices &&
                h('button', { type: 'button', onClick: openInvoices }, 'View invoices'),
            ),
            h(
              'section',
              { className: 'fabric-line' },
              h('h2', null, 'Available physical stock'),
              h(BillingTable, { columns: stockColumns, rows }),
            ),
          ),
  );
}
