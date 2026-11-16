import { createElement as h } from 'react';
import { OverviewTable } from '../fabric/overview-table.js';

const hiddenColumns = {
  sizes: ['produced', 'adjusted', 'returned', 'held', 'sold'],
  variations: [
    'item_type',
    'sold',
    'returned_sets',
    'held',
    'ordered',
    'delivered',
    'available_percent',
  ],
};

const numericColumns = new Set([
  'pieces',
  'delta',
  'base_price',
  'stock_value',
  'total_produced',
  'produced',
  'adjusted',
  'returned',
  'held',
  'sold',
  'available',
  'produced_sets',
  'returned_sets',
  'ordered',
  'delivered',
  'capacity',
  'available_percent',
  'price_per_piece',
]);

const related = {
  style_code: ['productionItems'],
  item: ['productionItems'],
  employee: ['employees'],
  product: ['finishedProducts', 'products'],
  type: ['finishedProducts', 'priceTypes'],
};

export function FinishedGoodsOverview({
  client,
  screen,
  title,
  columns,
  rows,
  link,
  searchLabel,
  onSearch,
  onOpen,
  canOpen,
  onCosting,
}) {
  const fields = columns.map(([accessorKey, header]) => ({
    accessorKey,
    header,
    sortDescFirst: false,
    ...(numericColumns.has(accessorKey) && {
      sortingFn: (a, b, key) => Number(a.getValue(key)) - Number(b.getValue(key)),
    }),
    cell: ({ getValue }) => {
      const value = getValue() ?? '—';
      if (accessorKey === 'status') return h('span', { className: 'erp-overview-status' }, value);
      const target =
        screen === 'variations' && accessorKey === 'style_code'
          ? ['finishedProducts', 'products']
          : related[accessorKey];
      return target && link ? link(value, ...target) : value;
    },
  }));
  if (onCosting)
    fields.push({
      accessorKey: 'costing',
      header: 'Costing history',
      enableSorting: false,
      enableGrouping: false,
      enableColumnFilter: false,
      cell: ({ row }) =>
        h(
          'button',
          {
            type: 'button',
            className: 'open-document',
            disabled: !row.original.components?.length,
            onClick: () => onCosting(row.original),
          },
          'Costing history',
        ),
    });
  return h(OverviewTable, {
    client,
    grid: 'overview-finished-goods-' + screen,
    title,
    records: rows.map((row) => ({ ...row, id: row.id ?? row.size_id ?? row.item_id })),
    columns: fields,
    defaultVisibility: Object.fromEntries((hiddenColumns[screen] ?? []).map((key) => [key, false])),
    searchLabel,
    onSearch,
    onOpen,
    canOpen,
  });
}
