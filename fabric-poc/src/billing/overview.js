import { createElement as h, useCallback, useState } from 'react';
import { OverviewTable } from '../fabric/overview-table.js';
import { WorkspaceViewToggle } from '../fabric/view-toggle.js';

const emptyRows = [];

export function BillingViewActions({ title, view, onChange, add }) {
  return h(
    'div',
    { className: 'erp-overview-heading-actions' },
    h(WorkspaceViewToggle, { label: title + ' view', view, onChange }),
    view === 'overview' && add,
  );
}

export function useBillingOverviewSearch(resetPage) {
  const [query, setQuery] = useState('');
  const onSearch = useCallback(
    (value) => {
      if (value === query) return;
      setQuery(value);
      resetPage(0);
    },
    [query, resetPage],
  );
  return [query, onSearch];
}

export function BillingRelatedRecord({ value, id, open }) {
  if (!value || !id || !open) return value ?? '—';
  return h(
    'button',
    { type: 'button', className: 'open-document', onClick: () => open(id) },
    value,
  );
}

export function BillingOverview({
  client,
  page,
  title,
  columns,
  rows,
  render = (row, key) => row[key],
  onOpen,
  opensDialog,
  onSearch,
  searchLabel,
  toolbar,
  actions,
  hidden = [],
}) {
  const fields = columns.map(({ key, label, numeric }) => ({
    accessorKey: key,
    header: label,
    sortDescFirst: false,
    ...(numeric && { sortingFn: (a, b, id) => Number(a.getValue(id)) - Number(b.getValue(id)) }),
    cell: ({ row }) => render(row.original, key) ?? '—',
  }));
  if (actions)
    fields.push({
      accessorKey: 'action',
      header: 'Action',
      enableSorting: false,
      enableGrouping: false,
      enableColumnFilter: false,
      cell: ({ row }) => actions(row.original),
    });
  return h(OverviewTable, {
    client,
    grid: 'overview-' + page,
    title,
    records: rows ?? emptyRows,
    columns: fields,
    defaultVisibility: Object.fromEntries(hidden.map((key) => [key, false])),
    onOpen,
    opensDialog,
    onSearch,
    searchLabel,
    toolbar,
  });
}
