import { inventoryPages } from '../inventory/catalog.js';

const defaults = {
  materialStock: ['sku', 'name', 'left', 'unit', 'status', 'reconcile'],
  materialMovements: ['date', 'direction', 'sku', 'name', 'quantity', 'unit'],
  materials: ['name', 'category', 'unit', 'supplier'],
  materialSuppliers: ['name', 'purpose', 'transport'],
  materialOrders: ['bill', 'supplier', 'ordered', 'lineCount'],
  materialReceipts: ['sku', 'date', 'name', 'quantity', 'unit', 'supplier'],
  materialIssues: ['date', 'sku', 'name', 'quantity', 'unit', 'type'],
  materialCategories: ['name', 'type'],
  materialUnits: ['name', 'description'],
  materialIssueTypes: ['name', 'remarks'],
};

const labels = {
  status: 'Status',
  reconcile: 'Actions',
  ordered: 'Ordered by unit',
  lineCount: 'Line items',
  contact: 'Company contact',
};
const optionalColumns = {
  materialOrders: ['name', 'received', 'pending', 'excess'],
  materialSuppliers: ['contact', 'orders'],
};
export const inventoryOverview = Object.fromEntries(
  Object.entries(defaults).map(([page, visible]) => {
    const remaining =
      optionalColumns[page] ??
      inventoryPages[page].columns.map(({ key }) => key).filter((key) => !visible.includes(key));
    return [
      page,
      {
        columns: [...visible, ...remaining],
        visibility: Object.fromEntries(remaining.map((key) => [key, false])),
        labels,
      },
    ];
  }),
);

const quantityByUnit = (rows, key) => {
  const totals = new Map();
  for (const row of rows) totals.set(row.unit, (totals.get(row.unit) ?? 0) + row[key]);
  return [...totals]
    .map(([unit, total]) =>
      [total.toLocaleString(undefined, { maximumFractionDigits: 2 }), unit]
        .filter(Boolean)
        .join(' '),
    )
    .join(' · ');
};

export function inventoryDocument({ id, rows }) {
  return {
    id,
    bill: rows[0].bill,
    supplier: rows[0].supplier,
    name: [...new Set(rows.map((line) => line.name))].join(', '),
    ordered: quantityByUnit(rows, 'quantity'),
    received: quantityByUnit(rows, 'received'),
    pending: quantityByUnit(rows, 'pending'),
    excess: quantityByUnit(rows, 'excess'),
    lineCount: rows.length,
    rows,
  };
}

const targets = {
  materials: {
    category: 'materialCategories',
    unit: 'materialUnits',
    supplier: 'materialSuppliers',
  },
  materialSuppliers: { contact: 'materialContacts', purpose: 'contactCategories' },
  materialOrders: { supplier: 'materialSuppliers' },
  materialStock: { supplier: 'materialSuppliers' },
  materialReceipts: {
    supplier: 'materialSuppliers',
    order: 'materialOrders',
    employee: 'employees',
  },
  materialIssues: { sku: 'materialReceipts', issuer: 'employees' },
};
const stockPages = new Set([
  'materialStock',
  'materialReceipts',
  'materialIssues',
  'materialMovements',
]);
export function inventoryOverviewTarget(page, key, record) {
  if (stockPages.has(page)) {
    const fabric = record.category === 'Dyed fabric' && record.batch !== '—';
    if (key === 'name') return fabric ? 'dyed' : 'materials';
    if (key === 'batch') return 'dyed';
    if (key === 'unit' && !fabric) return 'materialUnits';
    if (key === 'category' && !fabric) return 'materialCategories';
  }
  if (page === 'materialMovements') {
    if (key === 'sku')
      return record.direction === 'Received' ? 'materialReceipts' : 'materialIssues';
    if (key === 'party') return record.direction === 'Received' ? 'materialSuppliers' : 'employees';
  }
  if (page === 'materialIssues' && key === 'type' && record.reconciliation !== 'Marked reconciled')
    return 'materialIssueTypes';
  return targets[page]?.[key];
}
