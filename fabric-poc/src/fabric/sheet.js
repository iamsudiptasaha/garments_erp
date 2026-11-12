import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import {
  buildSheet,
  capturePresentation,
  hasDataChanges,
  csvFor,
  orderedRecords,
} from '../fortune-state.js';
import { formattedReport } from './report.js';
import { useGridPreferences } from './grid-preferences.js';
import { GridColumns, GridSort } from './grid-toolbar.js';
import { fitGridColumns, gridColumns, projectBorders } from './grid-layout.js';
const h = React.createElement;
const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2];
export function FabricSheet({ page, client, preferences: defaults, ...props }) {
  const { ready, preferences, save, error } = useGridPreferences(client, page, defaults);
  return h(
    React.Fragment,
    null,
    error && h('p', { role: 'status' }, error),
    ready
      ? h(GridWorkbook, { ...props, page, preferences, onPreferences: save })
      : h('p', { role: 'status' }, 'Loading grid preferences…'),
  );
}

function GridWorkbook({
  page,
  spec,
  records,
  preferences,
  onPreferences,
  onSelect,
  onNotice,
  capabilities,
  paged,
}) {
  const book = useRef(null),
    host = useRef(null),
    state = useRef(null),
    callbacks = useRef({ onPreferences, onSelect, onNotice, capabilities });
  callbacks.current = { onPreferences, onSelect, onNotice };
  const [revision, setRevision] = useState(0);
  const [print, setPrint] = useState(null);
  const [available, setAvailable] = useState(0);
  const printDialog = useRef(null);
  const printedTable = useRef(null);
  const zoom = zoomLevels.includes(preferences.layout?.zoomRatio)
    ? preferences.layout.zoomRatio
    : 1;
  const sort = spec.columns.some(({ key }) => key === preferences.sort?.key)
    ? {
        key: preferences.sort.key,
        direction: preferences.sort.direction === 'desc' ? 'desc' : 'asc',
      }
    : { key: spec.columns[0].key, direction: 'asc' };
  const { arranged, visible } = useMemo(
    () => gridColumns(spec.columns, preferences.order, preferences.hidden),
    [spec.columns, preferences.order, preferences.hidden],
  );
  const widths =
    preferences.columnWidths ??
    Object.fromEntries(
      spec.columns.flatMap(({ key }, index) =>
        preferences.layout?.widths?.[index] ? [[key, preferences.layout.widths[index]]] : [],
      ),
    );
  const generation = useRef(0);
  const lastSheet = useRef(null);
  const latest = useRef(preferences);
  latest.current = preferences;
  const initial = useMemo(() => {
    const saved = latest.current;
    const manual =
      saved.columnWidths ??
      Object.fromEntries(
        spec.columns.map(({ key }, index) => [key, saved.layout?.widths?.[index]]),
      );
    const columns = fitGridColumns(visible, records, (available - 56) / zoom, manual);
    state.current = {
      page,
      title: spec.title,
      columns,
      records,
      styles: saved.styles || {},
      layout: {
        ...saved.layout,
        widths: Object.fromEntries(columns.map(({ width }, index) => [index, width])),
        borders: projectBorders(saved.layout?.borders, spec.columns, columns),
      },
      sort: { key: sort.key, direction: sort.direction },
    };
    lastSheet.current = null;
    return { data: [buildSheet(state.current)], key: ++generation.current };
  }, [page, spec, visible, records, sort.key, sort.direction, revision, zoom, available]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0) setAvailable(width);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (print) printDialog.current.showModal();
  }, [print]);
  useEffect(() => {
    const element = host.current;
    const sheetTarget = (e) =>
      e.target instanceof Element &&
      !!e.target.closest('.fortune-sheet-overlay,.luckysheet-rich-text-editor');
    const reject = (e) => {
      if (sheetTarget(e)) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.current.onNotice('Values are protected. Use the document form to make changes.');
      }
    };
    const keyboard = (e) => {
      const modified = e.ctrlKey || e.metaKey,
        key = e.key.toLowerCase();
      if (
        ['backspace', 'delete', 'f2', 'enter'].includes(key) ||
        (!modified && !e.altKey && e.key.length === 1) ||
        (modified && ['v', 'x', 'd', 'r'].includes(key))
      )
        reject(e);
    };
    element.addEventListener('keydown', keyboard, true);
    for (const name of ['dblclick', 'beforeinput', 'paste', 'cut', 'drop'])
      element.addEventListener(name, reject, true);
    return () => {
      element.removeEventListener('keydown', keyboard, true);
      for (const name of ['dblclick', 'beforeinput', 'paste', 'cut', 'drop'])
        element.removeEventListener(name, reject, true);
    };
  }, []);
  function change(sheets) {
    const sheet = sheets[0];
    if (!sheet?.data || sheet === lastSheet.current) return;
    const firstChange = lastSheet.current === null;
    lastSheet.current = sheet;
    if (firstChange) return;
    if (hasDataChanges(sheet, state.current)) {
      callbacks.current.onNotice(
        'Direct data change blocked. The original records have been restored.',
      );
      setRevision((x) => x + 1);
      return;
    }
    if (!capabilities.format) return;
    const previous = state.current;
    state.current = capturePresentation(sheet, previous, { sparse: true });
    const { widths: captured, borders, ...layout } = state.current.layout;
    const changedWidths = Object.fromEntries(
      previous.columns.flatMap(({ key }, index) =>
        captured[index] && captured[index] !== previous.layout.widths[index]
          ? [[key, captured[index]]]
          : [],
      ),
    );
    const hidden = spec.columns.filter(({ key }) => !visible.some((column) => column.key === key));
    const hiddenBorders = projectBorders(preferences.layout?.borders, spec.columns, hidden);
    callbacks.current.onPreferences({
      styles: state.current.styles,
      layout: {
        ...layout,
        zoomRatio: zoom,
        borders: [
          ...projectBorders(hiddenBorders, hidden, spec.columns),
          ...projectBorders(borders, visible, spec.columns),
        ],
      },
      ...(Object.keys(changedWidths).length
        ? { columnWidths: { ...widths, ...changedWidths } }
        : {}),
    });
  }
  function selection(_sheet, range) {
    const sorted = orderedRecords(state.current);
    callbacks.current.onSelect(
      range.row[0] === range.row[1] && range.row[0] > 0 ? sorted[range.row[0] - 1] : null,
    );
  }
  function configure(patch) {
    onPreferences(patch);
    onSelect(null);
    setRevision((value) => value + 1);
  }
  function download() {
    if (!capabilities.export) {
      onNotice('Your role cannot export this page.');
      return;
    }
    const url = URL.createObjectURL(
        new Blob(['\uFEFF' + csvFor(state.current)], { type: 'text/csv;charset=utf-8' }),
      ),
      link = document.createElement('a');
    link.href = url;
    link.download = `fabric-${page}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice('CSV exported. CSV contains values; use Print / PDF to retain presentation.');
  }
  function preview() {
    if (!capabilities.print) {
      onNotice('Your role cannot print this page.');
      return;
    }
    try {
      setPrint(formattedReport(book.current, state.current.columns, records.length));
    } catch (e) {
      onNotice(e.message);
    }
  }
  useEffect(() => {
    function beforePrint() {
      if (!capabilities.print || host.current?.closest('[hidden]')) return;
      try {
        const report = formattedReport(book.current, state.current.columns, records.length);
        if (printedTable.current) printedTable.current.innerHTML = report;
      } catch {
        /* No active sheet to print. */
      }
    }
    window.addEventListener('beforeprint', beforePrint);
    return () => window.removeEventListener('beforeprint', beforePrint);
  }, [spec, records, capabilities.print]);
  return h(
    React.Fragment,
    null,
    h(GridSort, {
      columns: arranged,
      sort,
      paged,
      rowCount: records.length,
      onSort: (next) => configure({ sort: next }),
    }),
    h(
      'div',
      { className: 'sheet-exports' },
      h(
        'span',
        null,
        capabilities.format ? '🔒 Values protected · formatting enabled' : '🔒 Read-only access',
      ),
      h(GridColumns, { columns: arranged, visible, widths, onChange: configure }),
      h(
        'label',
        { className: 'sheet-zoom' },
        'Zoom ',
        h(
          'select',
          {
            'aria-label': 'Sheet zoom',
            value: zoom,
            onChange: (e) =>
              configure({ layout: { ...preferences.layout, zoomRatio: Number(e.target.value) } }),
          },
          zoomLevels.map((value) =>
            h('option', { key: value, value }, `${Math.round(value * 100)}%`),
          ),
        ),
      ),
      capabilities.export && h('button', { onClick: download }, 'Export CSV'),
      capabilities.print && h('button', { onClick: preview }, 'Print / PDF'),
    ),
    records.length === 0 &&
      h('p', { className: 'fabric-status', role: 'status' }, 'No matching records.'),
    h(
      'div',
      { className: 'fabric-grid', ref: host },
      h(Workbook, {
        key: initial.key,
        ref: book,
        data: initial.data,
        lang: 'en',
        // FortuneSheet's read-only mode can loop after selection. Keep value changes
        // blocked by the input guards and hooks for both presentation roles.
        allowEdit: true,
        showToolbar: capabilities.format,
        showFormulaBar: false,
        showSheetTabs: false,
        toolbarItems: [
          'undo',
          'redo',
          '|',
          'font-size',
          'bold',
          'italic',
          'underline',
          '|',
          'font-color',
          'background',
          'border',
          '|',
          'horizontal-align',
          'text-wrap',
          '|',
          'freeze',
        ],
        cellContextMenu: capabilities.format
          ? ['copy', '|', 'set-row-height', 'set-column-width']
          : ['copy'],
        headerContextMenu: capabilities.format
          ? ['copy', '|', 'set-row-height', 'set-column-width']
          : ['copy'],
        hooks: {
          beforeUpdateCell: () => false,
          beforePaste: () => false,
          beforeAddSheet: () => false,
          beforeDeleteSheet: () => false,
          afterSelectionChange: selection,
        },
        onChange: change,
      }),
    ),
    h(
      'dialog',
      {
        ref: printDialog,
        className: 'fabric-print-dialog',
        onClose: () => setPrint(null),
      },
      h(
        'div',
        { className: 'no-print print-top' },
        h('strong', null, 'Print preview'),
        h(
          'button',
          {
            onClick: () => {
              printDialog.current.close();
              setPrint(null);
            },
          },
          'Close',
        ),
      ),
      h(
        'section',
        { className: 'fabric-print-surface' },
        h('h2', null, spec.title),
        h('p', null, `${records.length} rows · current sorting and formatting`),
        h('div', { ref: printedTable, dangerouslySetInnerHTML: { __html: print || '' } }),
      ),
      h(
        'div',
        { className: 'editor-actions no-print' },
        h('button', { className: 'primary', onClick: () => window.print() }, 'Print / Save as PDF'),
      ),
    ),
  );
}
