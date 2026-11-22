import { seed, clone, project, pages, validate } from './model.js';
export const columns = pages.knitting.columns;
const displayValue = (record, column) =>
  record.displayValues?.[column.key]?.join(',\n') ?? record[column.key];
const styleKeys = ['bg', 'fc', 'bl', 'it', 'un', 'cl', 'fs', 'ff', 'ht', 'vt', 'tb', 'tr'];
const cellStyle = (style) =>
  Object.fromEntries(
    styleKeys.flatMap((key) =>
      ['string', 'number'].includes(typeof style?.[key]) ? [[key, style[key]]] : [],
    ),
  );
export const defaultState = () => ({
  version: 1,
  data: clone(seed),
  styles: {},
  layout: {},
  sort: { key: 'bill', direction: 'asc' },
});
export function orderedRecords(state) {
  const rows = state.records ? [...state.records] : project(state.data, 'knitting');
  const { key, direction } = state.sort;
  const sorted = rows.sort((a, b) => {
    const x = a[key],
      y = b[key];
    return (
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true })) *
      (direction === 'desc' ? -1 : 1)
    );
  });
  if (!state.grouping) return sorted;
  const { key: groupKey, summaryKey } = state.grouping;
  const groups = [...new Set(rows.filter((r) => !r[summaryKey]).map((r) => r[groupKey]))].sort(
    (a, b) => String(a).localeCompare(String(b)),
  );
  return groups
    .flatMap((group) => [
      ...sorted.filter((r) => !r[summaryKey] && r[groupKey] === group),
      ...rows.filter((r) => r[summaryKey] === 'subtotal' && r[groupKey] === group),
    ])
    .concat(rows.filter((r) => r[summaryKey] === 'grand'));
}
export function buildSheet(state) {
  const records = orderedRecords(state),
    celldata = [],
    columns = state.columns || pages.knitting.columns;
  columns.forEach((col, c) => {
    const heading =
      (state.sort.key === col.key ? (state.sort.direction === 'desc' ? '↓ ' : '↑ ') : '') +
      col.label;
    celldata.push({
      r: 0,
      c,
      v: {
        v: heading,
        m: heading,
        ff: 'Arial',
        bg: '#e6f2ff',
        fc: '#174b79',
        bl: 1,
        fs: 11,
        ht: 1,
        ...cellStyle(state.styles.header?.[col.key]),
      },
    });
    records.forEach((record, i) => {
      const value = displayValue(record, col),
        style = cellStyle(state.styles[record.id]?.[col.key]),
        multiline = !!record.displayValues?.[col.key];
      celldata.push({
        r: i + 1,
        c,
        v: {
          v: value,
          m: String(value),
          ct: multiline
            ? {
                fa: 'General',
                t: 'inlineStr',
                s: [{ v: String(value), ff: 'Arial', fs: 11, ...style }],
              }
            : { fa: 'General', t: col.numeric ? 'n' : 's' },
          ff: 'Arial',
          bg: i % 2 ? '#f6faff' : '#ffffff',
          fs: 11,
          ...style,
          ...(multiline ? { tb: '2' } : {}),
        },
      });
    });
  });
  const rowlen = { 0: state.layout.headerHeight || 44 };
  records.forEach((r, i) => {
    const lines = Math.max(1, ...Object.values(r.displayValues || {}).map((v) => v.length));
    if (lines > 1 || state.layout.rowHeights?.[r.id])
      rowlen[i + 1] = Math.max(
        state.layout.rowHeights?.[r.id] || 36,
        lines > 1 ? lines * 22 + 14 : 36,
      );
  });
  const borderInfo = (state.layout.borders || []).flatMap((b) => {
    if (b.kind === 'cell') {
      const r =
        b.id === 'header'
          ? 0
          : records.some((x) => x.id === b.id)
            ? records.findIndex((x) => x.id === b.id) + 1
            : -1;
      return r < 0 ? [] : [{ ...b.value, value: { ...b.value.value, row_index: r } }];
    }
    const r =
      b.id === 'header'
        ? 0
        : records.some((x) => x.id === b.id)
          ? records.findIndex((x) => x.id === b.id) + 1
          : -1;
    return r < 0 ? [] : [{ ...b.value, range: [{ row: [r, r], column: b.column }] }];
  });
  return {
    name: state.title || 'Knitting bills',
    id: state.page || 'knitting-protected',
    status: 1,
    zoomRatio: state.layout.zoomRatio || 1,
    row: Math.max(18, records.length + 4),
    column: columns.length,
    defaultRowHeight: 36,
    celldata,
    config: {
      columnlen: state.layout.widths || Object.fromEntries(columns.map((c, i) => [i, c.width])),
      rowlen,
      borderInfo,
    },
    frozen: state.layout.frozen || { type: 'row' },
  };
}
export function capturePresentation(sheet, state, { sparse = false } = {}) {
  const records = orderedRecords(state),
    columns = state.columns || pages.knitting.columns,
    styles = clone(state.styles || {});
  const matrix = sheet.data || [];
  const defaults = sparse ? buildSheet({ ...state, styles: {} }).celldata : null;
  const cellAt = (r, c) => matrix[r]?.[c] ?? sheet.celldata?.find((x) => x.r === r && x.c === c)?.v;
  for (let r = 0; r <= records.length; r++) {
    const id = r === 0 ? 'header' : records[r - 1].id;
    styles[id] = { ...styles[id] };
    columns.forEach((col, c) => {
      const cell = cellAt(r, c) || {},
        style = { ...cell, ...(cell.ct?.t === 'inlineStr' ? cell.ct.s?.[0] : {}) };
      const baseline = defaults?.[c * (records.length + 1) + r].v;
      const attributes = Object.fromEntries(
        styleKeys
          .filter((k) => style[k] !== undefined && (!sparse || style[k] !== baseline[k]))
          .map((k) => [k, clone(style[k])]),
      );
      if (sparse && !Object.keys(attributes).length) delete styles[id][col.key];
      else styles[id][col.key] = attributes;
    });
    if (sparse && !Object.keys(styles[id]).length) delete styles[id];
  }
  const idAt = (r) => (r === 0 ? 'header' : records[r - 1]?.id);
  const visibleIds = new Set(['header', ...records.map((r) => r.id)]);
  const borders = clone((state.layout.borders || []).filter((b) => !visibleIds.has(b.id)));
  for (const b of sheet.config?.borderInfo || []) {
    if (b.rangeType === 'cell') {
      const id = idAt(b.value?.row_index);
      if (id) borders.push({ kind: 'cell', id, value: clone(b) });
      continue;
    }
    for (const range of b.range || [])
      for (let r = range.row[0]; r <= Math.min(range.row[1], records.length); r++) {
        const id = idAt(r);
        if (id)
          borders.push({
            kind: 'range',
            id,
            column: clone(range.column),
            value: { ...clone(b), range: undefined },
          });
      }
  }
  return {
    ...state,
    styles,
    layout: {
      zoomRatio: sheet.zoomRatio || 1,
      widths: clone(sheet.config?.columnlen || {}),
      headerHeight: sheet.config?.rowlen?.[0],
      rowHeights: {
        ...state.layout.rowHeights,
        ...Object.fromEntries(
          records
            .map((r, i) => [r.id, sheet.config?.rowlen?.[i + 1]])
            .filter(([, v]) => v !== undefined),
        ),
      },
      frozen: clone(
        sheet.frozen || { type: 'rangeBoth', range: { row_focus: -1, column_focus: -1 } },
      ),
      borders,
    },
  };
}
export function hasDataChanges(sheet, state) {
  const expected = buildSheet(state),
    records = orderedRecords(state),
    columns = state.columns || pages.knitting.columns;
  const map = new Map(expected.celldata.map((x) => [`${x.r}:${x.c}`, x.v.v]));
  const expectedInline = new Set(
    expected.celldata.filter((x) => x.v.ct?.t === 'inlineStr').map((x) => `${x.r}:${x.c}`),
  );
  const cells = sheet.data
    ? sheet.data.flatMap((row, r) => (row || []).map((v, c) => ({ r, c, v })).filter((x) => x.v))
    : sheet.celldata || [];
  if (
    cells.some(
      (x) => x.v?.f || (x.v?.ct?.t === 'inlineStr' && !expectedInline.has(`${x.r}:${x.c}`)),
    )
  )
    return true;
  const actual = new Map(
    cells.map((x) => [
      `${x.r}:${x.c}`,
      x.v?.ct?.t === 'inlineStr'
        ? (x.v.ct.s || []).map((part) => part.v || '').join('')
        : (x.v?.v ?? ''),
    ]),
  );
  for (const [key, value] of map) if (actual.get(key) !== value) return true;
  for (const [key, value] of actual)
    if (value !== '' && value != null && !map.has(key)) return true;
  return (
    (sheet.column !== undefined && sheet.column !== columns.length) ||
    (sheet.row !== undefined && sheet.row < records.length + 1)
  );
}
export function saveRecord(state, input, id) {
  const next = clone(state);
  const row = { ...input, id: id || `k-${crypto.randomUUID()}` };
  if (!row.bill?.trim() || !row.knitter?.trim() || !row.fabric?.trim() || !row.date)
    throw Error('Fill in bill, date, knitter and fabric type.');
  if (!next.data.yarn.some((y) => y.id === row.yarnId)) throw Error('Choose a source yarn bill.');
  if (id) {
    const i = next.data.knitting.findIndex((r) => r.id === id);
    if (i < 0) throw Error('Record no longer exists.');
    next.data.knitting[i] = row;
  } else next.data.knitting.push(row);
  const error = validate(next.data);
  if (error) throw Error(error);
  return next;
}
export function csvFor(state) {
  const columns = state.columns || pages.knitting.columns;
  const quote = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return [
    columns.map((c) => quote(c.label)).join(','),
    ...orderedRecords(state).map((r) =>
      columns
        .map((c) =>
          quote(
            typeof displayValue(r, c) === 'string' && /^[=+@\-\t\r]/.test(displayValue(r, c))
              ? "'" + displayValue(r, c)
              : displayValue(r, c),
          ),
        )
        .join(','),
    ),
  ].join('\r\n');
}
