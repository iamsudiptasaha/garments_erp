import React from 'react';
const h = React.createElement,
  fmt = (value) =>
    typeof value === 'number'
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : (value ?? '—');
export function InventoryCard({
  group,
  spec,
  page,
  index,
  onEdit,
  onReconcile,
  editable,
  reconcilable,
}) {
  const first = group.rows[0],
    balance = page === 'materialStock',
    movement = page === 'materialMovements';
  const totals = new Map();
  if (spec.lines)
    for (const row of group.rows) totals.set(row.unit, (totals.get(row.unit) || 0) + row.quantity);
  return h(
    'article',
    { className: `overview-card tone-${index % 4}` },
    h(
      'div',
      { className: 'card-top' },
      h(
        'span',
        { className: 'card-kicker' },
        balance
          ? first.left > 0
            ? 'Available'
            : 'Closed'
          : movement
            ? first.direction
            : spec.title,
      ),
    ),
    h(
      'h2',
      null,
      balance || page === 'materialReceipts' || page === 'materialIssues' || movement
        ? first.sku
        : group.title,
    ),
    h(
      'p',
      { className: 'card-subtitle' },
      balance || movement || ['materialReceipts', 'materialIssues'].includes(page)
        ? first.name
        : first.name !== group.title
          ? first.name
          : first.supplier ||
            (spec.miscellaneous ? 'Shared contact record' : 'Inventory reference'),
    ),
    balance &&
      h(
        'p',
        { className: 'card-measure' },
        fmt(first.left),
        h('small', null, ` ${first.unit} left`),
      ),
    spec.lines &&
      h(
        'div',
        { className: 'inventory-unit-totals' },
        [...totals].map(([unit, value]) => h('strong', { key: unit }, `${fmt(value)} ${unit}`)),
      ),
    group.rows.length === 1
      ? h(
          'dl',
          { className: 'inventory-details' },
          spec.columns
            .filter(
              (c) =>
                !['name', 'sku'].includes(c.key) && !(balance && ['left', 'unit'].includes(c.key)),
            )
            .map((c) =>
              h('div', { key: c.key }, h('dt', null, c.label), h('dd', null, fmt(first[c.key]))),
            ),
        )
      : h(
          'details',
          { className: 'card-lines' },
          h('summary', null, `${group.rows.length} material lines`),
          group.rows.map((row) =>
            h(
              'div',
              { key: row.id },
              h('span', null, row.name),
              h('strong', null, `${fmt(row.quantity)} ${row.unit}`),
            ),
          ),
        ),
    editable &&
      first.reconciliation !== 'Marked reconciled' &&
      h(
        'button',
        { className: 'open-document', onClick: () => onEdit(group.id) },
        spec.lines ? 'Open document →' : 'Edit →',
      ),
    balance &&
      first.left > 0 &&
      reconcilable &&
      h(
        'button',
        { className: 'open-document', onClick: () => onReconcile(first.id) },
        'Reconcile & close →',
      ),
  );
}
