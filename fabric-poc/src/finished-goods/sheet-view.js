import { createElement as h, useMemo, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';

export function FinishedGoodsSheetView({ page, title, columns, rows, capabilities, children }) {
  const [view, setView] = useState('overview');
  const [preferences, setPreferences] = useState({});
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
    h(
      'div',
      { className: 'sheet-exports', role: 'group', 'aria-label': title + ' view' },
      ['overview', 'sheet'].map((mode) =>
        h(
          'button',
          {
            key: mode,
            type: 'button',
            'aria-pressed': view === mode,
            onClick: () => {
              setNotice('');
              setView(mode);
            },
          },
          mode === 'overview' ? 'Overview' : 'Sheet',
        ),
      ),
    ),
    notice && h('p', { role: 'status' }, notice),
    view === 'overview'
      ? children
      : h(FabricSheet, {
          page: 'finished-goods-' + page,
          spec,
          records,
          preferences,
          capabilities,
          onPreferences: (patch) =>
            setPreferences((current) => ({
              ...current,
              ...patch,
              layout: {
                ...patch.layout,
                zoomRatio: patch.styles ? current.layout?.zoomRatio : patch.layout?.zoomRatio,
              },
            })),
          onSelect: () => {},
          onNotice: setNotice,
        }),
  );
}
