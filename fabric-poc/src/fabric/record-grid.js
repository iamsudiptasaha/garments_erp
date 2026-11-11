import { Children, cloneElement, createElement as h } from 'react';
import { gridColumns } from './grid-layout.js';
import { useGridPreferences } from './grid-preferences.js';
import { GridColumns } from './grid-toolbar.js';

export function RecordGrid({ client, grid, fields, children }) {
  const { preferences, save, error, ready } = useGridPreferences(client, grid);
  const columns = fields.map(([key, label], index) => ({ key, label, index }));
  const { arranged, visible } = gridColumns(columns, preferences.order, preferences.hidden);
  const widths = preferences.columnWidths ?? {};
  const rowElements = Children.toArray(children.props.children);
  return h(
    'div',
    { className: 'erp-record-grid' },
    error && h('p', { role: 'status' }, error),
    ready &&
      h(
        'div',
        { className: 'sheet-exports' },
        h(GridColumns, { columns: arranged, visible, widths, onChange: save }),
      ),
    h(
      'div',
      { className: 'permission-scroll' },
      h(
        'table',
        { className: 'access-table' },
        h(
          'colgroup',
          null,
          visible.map(({ key }) =>
            h('col', {
              key,
              style:
                Number.isInteger(widths[key]) && widths[key] >= 48 && widths[key] <= 1600
                  ? { width: widths[key] }
                  : undefined,
            }),
          ),
          h('col', { key: 'actions' }),
        ),
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            visible.map(({ key, label }) => h('th', { scope: 'col', key }, label)),
            h('th', { scope: 'col', 'aria-label': 'Actions' }),
          ),
        ),
        h(
          'tbody',
          null,
          rowElements.map((row) => {
            const cells = Children.toArray(row.props.children);
            return cloneElement(row, undefined, [
              ...visible.map(({ index }) => cells[index]),
              cells[columns.length],
            ]);
          }),
        ),
      ),
    ),
  );
}
