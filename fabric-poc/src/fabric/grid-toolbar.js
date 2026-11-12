import { createElement as h, useEffect, useState } from 'react';

export const worksheetSearchDelay = 250;

export function WorksheetToolbar({ label, value, onChange, children }) {
  return h(
    'div',
    { className: 'fabric-actions worksheet-actions' },
    h(GridSearch, { label, value, onChange }),
    children,
  );
}

export function GridSearch({ label, value, onChange, placeholder = label, sheet = true }) {
  return h('input', {
    className: sheet ? 'erp-grid-search' : undefined,
    type: 'search',
    'aria-label': label,
    placeholder,
    value,
    onChange: (event) => onChange(event.target.value),
  });
}

export function useGridSearch(value) {
  const [query, setQuery] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(value), worksheetSearchDelay);
    return () => clearTimeout(timeout);
  }, [value]);
  return query;
}

export function GridSort({ columns, sort, onSort, rowCount, paged }) {
  return h(
    'div',
    { className: 'fabric-sort' },
    h(
      'label',
      null,
      paged ? 'Sort this page by ' : 'Sort complete rows by ',
      h(
        'select',
        {
          'aria-label': 'Sort column',
          value: sort.key,
          onChange: (event) => onSort({ ...sort, key: event.target.value }),
        },
        columns.map(({ key, label }) => h('option', { key, value: key }, label)),
      ),
    ),
    h(
      'select',
      {
        'aria-label': 'Sort direction',
        value: sort.direction,
        onChange: (event) => onSort({ ...sort, direction: event.target.value }),
      },
      h('option', { value: 'asc' }, 'Ascending'),
      h('option', { value: 'desc' }, 'Descending'),
    ),
    h('span', null, rowCount === 1 ? '1 row' : rowCount + ' rows'),
  );
}

export function GridColumns({ columns, visible, widths, onChange }) {
  const [selected, setSelected] = useState(columns[0].key);
  const index = columns.findIndex(({ key }) => key === selected);
  const shown = visible.some(({ key }) => key === selected);
  function move(offset) {
    const order = columns.map(({ key }) => key);
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    onChange({ order });
  }
  function resize(event) {
    const value = event.target.valueAsNumber;
    if (event.target.value && (!Number.isInteger(value) || value < 48 || value > 1600)) {
      event.target.value = widths[selected] ?? '';
      return;
    }
    onChange({ columnWidths: { ...widths, [selected]: event.target.value ? value : null } });
  }
  return h(
    'details',
    { className: 'erp-grid-columns' },
    h('summary', null, 'Columns'),
    h(
      'div',
      { className: 'erp-grid-column-controls' },
      h(
        'select',
        {
          'aria-label': 'Column to configure',
          value: selected,
          onChange: (event) => setSelected(event.target.value),
        },
        columns.map(({ key, label }) => h('option', { key, value: key }, label)),
      ),
      h('button', { type: 'button', disabled: index <= 0, onClick: () => move(-1) }, 'Move left'),
      h(
        'button',
        { type: 'button', disabled: index >= columns.length - 1, onClick: () => move(1) },
        'Move right',
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: shown && visible.length === 1,
          onClick: () =>
            onChange({
              hidden: columns
                .filter(({ key }) =>
                  key === selected ? shown : !visible.some((column) => column.key === key),
                )
                .map(({ key }) => key),
            }),
        },
        shown ? 'Hide column' : 'Show column',
      ),
      h(
        'label',
        null,
        'Width (px) ',
        h('input', {
          key: selected + ':' + (widths[selected] ?? ''),
          type: 'number',
          min: 48,
          max: 1600,
          placeholder: 'Auto',
          defaultValue: widths[selected] ?? '',
          onBlur: resize,
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          },
        }),
      ),
    ),
  );
}
