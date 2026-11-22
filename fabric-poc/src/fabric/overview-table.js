import { createElement as h, useEffect, useId, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownUp, Filter, LayoutGrid, Search, SlidersHorizontal } from 'lucide-react';
import { useGridPreferences } from './grid-preferences.js';
import { GridSearch, useGridSearch } from './grid-toolbar.js';
import './overview-table.css';

const getRowId = (record) => String(record.id);
const filters = {
  contains: (value, term) => value.includes(term),
  is: (value, term) => value === term,
  'is not': (value, term) => value !== term,
};
const text = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();
export const matchesOverviewRules = (record, rules) =>
  rules.every(
    ({ id, operator, value }) =>
      !text(value) || (filters[operator] ?? filters.contains)(text(record[id]), text(value)),
  );
const filterRules = (row, key, rules) =>
  matchesOverviewRules(
    { [key]: row.getValue(key) },
    rules.map((rule) => ({ ...rule, id: key })),
  );

function Rules({ kind, columns, rules, onChange }) {
  const isFilter = kind === 'Filter';
  const isSort = kind === 'Sort';
  const update = (index, patch) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const fieldOptions = (id) =>
    columns.filter(
      (column) => isFilter || column.id === id || !rules.some((rule) => rule.id === column.id),
    );
  const next = fieldOptions()[0];
  const limit = isFilter ? 20 : isSort ? 5 : 3;
  return h(
    'div',
    null,
    isFilter && h('p', null, 'Match all rules. Search works alongside these filters.'),
    rules.map(({ id, operator, value, desc }, index) =>
      h(
        'div',
        { key: index, className: 'overview-rule' },
        h(
          'select',
          {
            'aria-label': kind + ' field ' + (index + 1),
            value: id,
            onChange: (event) => update(index, { id: event.target.value }),
          },
          fieldOptions(id).map((column) =>
            h('option', { key: column.id, value: column.id }, column.columnDef.header),
          ),
        ),
        isFilter &&
          h(
            'select',
            {
              'aria-label': 'Filter operator ' + (index + 1),
              value: operator,
              onChange: (event) => update(index, { operator: event.target.value }),
            },
            Object.keys(filters).map((option) => h('option', { key: option }, option)),
          ),
        isFilter &&
          h('input', {
            'aria-label': 'Filter value ' + (index + 1),
            value,
            onChange: (event) => update(index, { value: event.target.value }),
          }),
        isSort &&
          h(
            'select',
            {
              'aria-label': 'Sort direction ' + (index + 1),
              value: desc ? 'desc' : 'asc',
              onChange: (event) => update(index, { desc: event.target.value === 'desc' }),
            },
            h('option', { value: 'asc' }, 'Ascending'),
            h('option', { value: 'desc' }, 'Descending'),
          ),
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Remove ' + kind.toLowerCase() + ' rule ' + (index + 1),
            onClick: () => onChange(rules.filter((_, i) => i !== index)),
          },
          '×',
        ),
      ),
    ),
    next &&
      rules.length < limit &&
      h(
        'button',
        {
          type: 'button',
          onClick: () =>
            onChange([
              ...rules,
              {
                id: next.id,
                ...(isFilter ? { operator: 'contains', value: '' } : isSort ? { desc: false } : {}),
              },
            ]),
        },
        kind === 'Group' ? '+ Add grouping level' : '+ Add ' + kind.toLowerCase() + ' rule',
      ),
  );
}

function ColumnSettings({ table }) {
  const columns = table.getAllLeafColumns();
  return columns.map((column, index) => {
    const label = column.columnDef.header;
    const width = table.getState().columnSizing[column.id];
    function move(offset) {
      const order = columns.map(({ id }) => id);
      [order[index], order[index + offset]] = [order[index + offset], order[index]];
      table.setColumnOrder(order);
    }
    return h(
      'div',
      { key: column.id, className: 'overview-column-setting' },
      h(
        'label',
        null,
        h('input', {
          type: 'checkbox',
          checked: column.getIsVisible(),
          disabled: !column.getCanHide(),
          onChange: column.getToggleVisibilityHandler(),
        }),
        label,
      ),
      h('input', {
        key: width ?? 'auto',
        type: 'number',
        'aria-label': label + ' width in pixels',
        placeholder: 'Auto',
        min: 48,
        max: 1600,
        defaultValue: width ?? '',
        onBlur: ({ target }) => {
          const next = target.valueAsNumber;
          if (target.value === '' && !target.validity.badInput) column.resetSize();
          else if (Number.isInteger(next) && target.validity.valid) {
            table.setColumnSizing((previous) => ({ ...previous, [column.id]: next }));
          } else target.value = width ?? '';
        },
      }),
      h(
        'button',
        {
          type: 'button',
          disabled: index < 2,
          'aria-label': 'Move ' + label + ' left',
          onClick: () => move(-1),
        },
        '↑',
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: index === 0 || index === columns.length - 1,
          'aria-label': 'Move ' + label + ' right',
          onClick: () => move(1),
        },
        '↓',
      ),
    );
  });
}

export function OverviewTable({
  client,
  grid,
  title,
  records,
  columns,
  onOpen,
  opensDialog = true,
  canOpen,
  toolbar,
  searchLabel = 'Search ' + title,
  getSearchText,
  onSearch,
  defaultVisibility,
  initialPreferences,
  renderBody,
  tableClassName,
  externalSearch,
}) {
  const { preferences, ready, save, error } = useGridPreferences(
    client,
    grid,
    initialPreferences ?? (defaultVisibility ? { visibility: defaultVisibility } : undefined),
  );
  const [panel, setPanel] = useState(null);
  const [draft, setDraft] = useState(null);
  const dialog = useRef(null);
  const captionId = useId();
  const expanded = preferences.expanded ?? {};
  const query = useGridSearch(externalSearch ?? draft ?? preferences.search ?? '');
  useEffect(() => {
    if (draft === null || draft !== query) return;
    save({ search: query });
    setDraft(null);
  }, [draft, query, save]);
  useEffect(() => {
    if (ready && externalSearch === undefined) onSearch?.(query.trim());
  }, [onSearch, query, ready, externalSearch]);
  useEffect(() => {
    if (panel && !dialog.current.open) dialog.current.showModal();
  }, [panel]);

  const [identity] = columns;
  const ids = columns.map(({ accessorKey }) => accessorKey);
  const rules = preferences.filters ?? [];
  const grouping = preferences.grouping ?? [];
  const sorting = preferences.sorting ?? [];
  const columnFilters = ids.flatMap((id) => {
    const matches = rules.filter((rule) => rule.id === id);
    return matches.length ? [{ id, value: matches }] : [];
  });
  const table = useReactTable({
    data: records,
    autoResetAll: false,
    columns: columns.map((column, index) => ({ ...column, enableHiding: index > 0 })),
    defaultColumn: { filterFn: filterRules, minSize: 48, maxSize: 1600 },
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    groupedColumnMode: false,
    globalFilterFn: (row, id, value) => {
      const searchValue =
        getSearchText && id === identity.accessorKey ? getSearchText(row.original) : '';
      return (
        text(row.getValue(id)).includes(text(value)) || text(searchValue).includes(text(value))
      );
    },
    state: {
      globalFilter: onSearch && externalSearch === undefined ? undefined : query,
      columnFilters,
      grouping,
      sorting,
      expanded,
      columnOrder: [
        identity.accessorKey,
        ...(preferences.order ?? ids).filter((id) => id !== identity.accessorKey),
      ],
      columnVisibility: preferences.visibility ?? {},
      columnSizing: preferences.columnWidths ?? {},
    },
    onExpandedChange: (update) =>
      save({ expanded: typeof update === 'function' ? update(expanded) : update }),
    onSortingChange: (update) =>
      save({ sorting: typeof update === 'function' ? update(sorting) : update }),
    onColumnOrderChange: (order) => save({ order }),
    onColumnVisibilityChange: (update) =>
      save({ visibility: update(preferences.visibility ?? {}) }),
    onColumnSizingChange: (update) =>
      save({ columnWidths: update(preferences.columnWidths ?? {}) }),
  });
  const rows = table.getRowModel().rows;
  const visible = table.getVisibleLeafColumns();
  const widths = preferences.columnWidths ?? {};
  const fixedWidth = visible.every(({ id }) => widths[id])
    ? visible.reduce((sum, { id }) => sum + widths[id], 0)
    : undefined;
  function resizeColumn(event, column) {
    if (!ready || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const start = event.clientX;
    const width = handle.parentElement.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    handle.onpointerup = (end) => {
      handle.onpointerup = null;
      if (end.clientX !== start) {
        const next = Math.max(48, Math.min(1600, Math.round(width + end.clientX - start)));
        save({ columnWidths: { ...widths, [column.id]: next } });
      }
    };
  }
  const tools = [
    ['Filter', Filter, rules.length],
    ['Group', LayoutGrid, grouping.length],
    ['Sort', ArrowDownUp, sorting.length],
    ['Columns', SlidersHorizontal, 0],
  ];
  function changeSearch(value) {
    setDraft(value);
    if (externalSearch !== undefined) onSearch?.(value);
  }
  function clearSearch() {
    setDraft('');
    if (externalSearch !== undefined) onSearch?.('');
    save({ search: '' });
  }
  return h(
    'section',
    { className: 'erp-overview-table', 'aria-label': title + ' Overview' },
    h(
      'div',
      { className: 'erp-overview-toolbar' },
      h(
        'label',
        { className: 'erp-overview-search' },
        h(Search, { size: 16, 'aria-hidden': true }),
        h(GridSearch, {
          label: searchLabel,
          value: externalSearch ?? draft ?? preferences.search ?? '',
          onChange: changeSearch,
          sheet: false,
        }),
      ),
      tools.map(([name, Icon, count]) =>
        h(
          'button',
          {
            key: name,
            type: 'button',
            disabled: !ready,
            'aria-haspopup': 'dialog',
            className: count ? 'is-applied' : undefined,
            onClick: () => setPanel(name),
          },
          h(Icon, { size: 15, 'aria-hidden': true }),
          name,
          count > 0 && h('span', null, count),
        ),
      ),
      toolbar,
      h(
        'span',
        { className: 'erp-overview-count', role: 'status' },
        table.getFilteredRowModel().rows.length + ' records',
      ),
    ),
    error && h('p', { role: 'status' }, error),
    (query || rules.some(({ value }) => text(value))) &&
      h(
        'div',
        { className: 'erp-overview-chips' },
        query &&
          h(
            'button',
            { type: 'button', onClick: clearSearch, 'aria-label': 'Clear search' },
            'Search: ' + query + ' ×',
          ),
        rules.map(
          ({ id, operator, value }, index) =>
            text(value) &&
            h(
              'button',
              {
                key: index,
                type: 'button',
                onClick: () => save({ filters: rules.filter((_, i) => i !== index) }),
              },
              columns.find(({ accessorKey }) => accessorKey === id)?.header +
                ' ' +
                operator +
                ' ' +
                value +
                ' ×',
            ),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              clearSearch();
              save({ filters: [] });
            },
          },
          'Clear all',
        ),
      ),
    h(
      'div',
      {
        className: 'lab-record-table-wrap',
        role: 'region',
        'aria-labelledby': captionId,
        tabIndex: 0,
      },
      h(
        'table',
        {
          className: tableClassName,
          style: fixedWidth ? { width: fixedWidth, tableLayout: 'fixed' } : undefined,
        },
        h('caption', { id: captionId, className: 'erp-overview-caption' }, title),
        h(
          'colgroup',
          null,
          visible.map((column) =>
            h('col', {
              key: column.id,
              style: { width: preferences.columnWidths?.[column.id] },
            }),
          ),
        ),
        h(
          'thead',
          null,
          table.getHeaderGroups().map((group) =>
            h(
              'tr',
              { key: group.id },
              group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return h(
                  'th',
                  {
                    key: header.id,
                    scope: 'col',
                    draggable: ready && header.column.id !== identity.accessorKey,
                    onDragStart: (event) =>
                      event.dataTransfer.setData('text/plain', header.column.id),
                    onDragOver: (event) => {
                      if (header.column.id !== identity.accessorKey) event.preventDefault();
                    },
                    onDrop: (event) => {
                      event.preventDefault();
                      const source = event.dataTransfer.getData('text/plain');
                      if (
                        source === identity.accessorKey ||
                        header.column.id === identity.accessorKey ||
                        !ids.includes(source)
                      )
                        return;
                      const order = table.getAllLeafColumns().map(({ id }) => id);
                      const destination = order.indexOf(header.column.id);
                      order.splice(order.indexOf(source), 1);
                      order.splice(destination, 0, source);
                      table.setColumnOrder(order);
                    },
                    'aria-sort':
                      header.column.getSortIndex() === 0
                        ? sorted === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined,
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: !ready,
                      onClick: header.column.getToggleSortingHandler(),
                    },
                    flexRender(header.column.columnDef.header, header.getContext()),
                    h(
                      'span',
                      { 'aria-hidden': true },
                      sorted ? (sorted === 'asc' ? ' ↑' : ' ↓') : ' ↕',
                    ),
                  ),
                  h('span', {
                    className: 'overview-resize',
                    'aria-hidden': true,
                    onPointerDown: (event) => resizeColumn(event, header.column),
                  }),
                );
              }),
            ),
          ),
        ),
        renderBody
          ? renderBody({ table, preferences, save })
          : h(
              'tbody',
              null,
              rows.length === 0 &&
                h('tr', null, h('td', { colSpan: visible.length }, 'No matching records')),
              rows.map((row) => {
                if (row.getIsGrouped())
                  return h(
                    'tr',
                    { key: row.id, className: 'overview-group' },
                    h(
                      'td',
                      { colSpan: visible.length },
                      h(
                        'button',
                        {
                          type: 'button',
                          'aria-expanded': row.getIsExpanded(),
                          onClick: row.getToggleExpandedHandler(),
                          style: { marginInlineStart: row.depth * 16 },
                        },
                        row.getIsExpanded() ? '▾ ' : '▸ ',
                        String(row.groupingValue ?? '—'),
                        ' · ',
                        row.getLeafRows().filter((child) => !child.getIsGrouped()).length,
                      ),
                    ),
                  );
                const openable = onOpen && (canOpen?.(row.original) ?? true);
                return h(
                  'tr',
                  {
                    key: row.id,
                    className: openable ? 'overview-open-row' : undefined,
                    onClick: openable
                      ? (event) => {
                          if (
                            !event.target.closest(
                              'a,button,input,select,textarea,summary,[role="button"]',
                            )
                          )
                            onOpen(row.original.id);
                        }
                      : undefined,
                  },
                  row.getVisibleCells().map((cell) => {
                    const value = flexRender(cell.column.columnDef.cell, cell.getContext());
                    return h(
                      'td',
                      { key: cell.id },
                      openable && cell.column.id === identity.accessorKey
                        ? h(
                            'button',
                            {
                              type: 'button',
                              'aria-haspopup': opensDialog ? 'dialog' : undefined,
                              onClick: () => onOpen(row.original.id),
                            },
                            value,
                          )
                        : value,
                    );
                  }),
                );
              }),
            ),
      ),
    ),
    h(
      'dialog',
      {
        ref: dialog,
        className: 'fabric-dialog overview-controls-dialog',
        'aria-label': panel,
        onClose: () => setPanel(null),
      },
      panel &&
        h(
          'header',
          null,
          h(
            'h2',
            null,
            panel === 'Columns'
              ? 'Customize columns'
              : panel === 'Group'
                ? 'Group your view'
                : panel + ' records',
          ),
          h('form', { method: 'dialog' }, h('button', { 'aria-label': 'Close dialog' }, '×')),
        ),
      panel === 'Columns' && h(ColumnSettings, { table }),
      panel === 'Filter' &&
        h(Rules, {
          kind: panel,
          columns: table.getAllLeafColumns().filter((column) => column.getCanFilter()),
          rules,
          onChange: (value) => save({ filters: value }),
        }),
      panel === 'Sort' &&
        h(Rules, {
          kind: panel,
          columns: table.getAllLeafColumns().filter((column) => column.getCanSort()),
          rules: sorting,
          onChange: (value) => save({ sorting: value }),
        }),
      panel === 'Group' &&
        h(Rules, {
          kind: panel,
          columns: table.getAllLeafColumns().filter((column) => column.getCanGroup()),
          rules: grouping.map((id) => ({ id })),
          onChange: (value) => {
            save({ expanded: {}, grouping: value.map(({ id }) => id) });
          },
        }),
    ),
  );
}
