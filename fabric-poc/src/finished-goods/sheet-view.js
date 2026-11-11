import { createElement as h, useMemo, useRef, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';

export function FinishedGoodsEditor({ label, title, children, record = false }) {
  const dialog = useRef(null);
  return h(
    'div',
    { className: record ? undefined : 'fabric-actions fg-create-actions' },
    h(
      'button',
      {
        type: 'button',
        className: record ? 'open-document' : 'primary',
        onClick: () => dialog.current.showModal(),
      },
      label,
    ),
    h(
      'dialog',
      { ref: dialog, className: 'fabric-dialog', 'aria-label': title },
      h(
        'div',
        { className: 'editor-heading' },
        h('h2', null, title),
        h('button', { type: 'button', onClick: () => dialog.current.close() }, 'Close'),
      ),
      children(() => dialog.current.close()),
    ),
  );
}

export function FinishedGoodsCards({ title, columns, rows, headline = columns[0][0], actions }) {
  return h(
    'div',
    { className: 'overview-grid' },
    rows.map((row, index) =>
      h(
        'article',
        { className: `overview-card tone-${index % 4}`, key: row.id ?? row.size_id ?? row.item_id },
        h('div', { className: 'card-top' }, h('span', { className: 'card-kicker' }, title)),
        h('h2', null, row[headline] ?? '—'),
        h(
          'dl',
          { className: 'fg-card-fields' },
          columns
            .filter(([key]) => key !== headline)
            .map(([key, label]) =>
              h('div', { key }, h('dt', null, label), h('dd', null, row[key] ?? '—')),
            ),
        ),
        actions?.(row),
      ),
    ),
  );
}

export function FinishedGoodsSheetView({
  page,
  title,
  columns,
  rows,
  capabilities,
  view,
  children,
}) {
  const preferences = useRef({});
  const [notice, setNotice] = useState('');
  const spec = useMemo(
    () => ({
      title,
      columns: columns.map(([key, label]) => ({
        key,
        label,
        numeric: rows.some((row) => typeof row[key] === 'number'),
      })),
    }),
    [columns, rows, title],
  );
  const records = useMemo(
    () =>
      rows.map((row) => ({
        ...Object.fromEntries(columns.map(([key]) => [key, row[key] ?? ''])),
        id: row.id ?? row.size_id ?? row.item_id,
      })),
    [columns, rows],
  );

  return h(
    'div',
    null,
    view === 'sheet' && notice && h('p', { role: 'status' }, notice),
    view === 'overview'
      ? children
      : h(FabricSheet, {
          page: 'finished-goods-' + page,
          spec,
          records,
          preferences: preferences.current,
          capabilities,
          onPreferences: (patch) => {
            const current = preferences.current;
            preferences.current = {
              ...current,
              ...patch,
              layout: {
                ...current.layout,
                ...patch.layout,
                zoomRatio: patch.styles
                  ? current.layout?.zoomRatio
                  : (patch.layout?.zoomRatio ?? current.layout?.zoomRatio),
              },
            };
          },
          onSelect: () => {},
          onNotice: setNotice,
        }),
  );
}
