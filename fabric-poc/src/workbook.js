import { pages, project } from './model.js';
const SOURCE_KEYS = {
  knitting: { id: 10, entity: 'knitting' },
  dyed: { id: 13, entity: 'dyed' },
  yarn: { id: 9, entity: 'yarn' },
};
const SHEET_NAMES = Object.fromEntries(Object.entries(pages).map(([key, p]) => [key, p.title]));
const ref = (sheet, col) => `'${SHEET_NAMES[sheet]}'!${col}2:${col}200`;
const find = (value, sheet, key, col) =>
  `IFERROR(INDEX(${ref(sheet, col)},MATCH(${value},${ref(sheet, key)},0)),"")`;
export function buildWorkbook(data) {
  const sheets = {};
  for (const [key, config] of Object.entries(pages)) {
    const rows = project(data, key),
      headers = config.columns.map((c) => c.label);
    if (key === 'knitting') headers.push('Record ID', 'Yarn source ID', 'Fabric type');
    if (key === 'dyed') headers.push('Record ID', 'Knitting source ID');
    if (key === 'yarn') headers.push('Yarn rate / kg', 'Yarn count', 'Record ID');
    const cellData = { 0: Object.fromEntries(headers.map((v, i) => [i, { v, s: 'heading' }])) };
    rows.forEach((row, i) => {
      const n = i + 2,
        cells = {};
      config.columns.forEach(
        (c, j) => (cells[j] = { v: row[c.key] ?? '', s: c.numeric ? 'number' : 'text' }),
      );
      if (key === 'knitting') {
        cells[3] = { f: `=${find('L' + n, 'yarn', 'J', 'I')}&" "&M${n}`, s: 'derived' };
        cells[9] = { f: `=${find('L' + n, 'yarn', 'J', 'A')}`, s: 'derived' };
        cells[10] = { v: row.id };
        cells[11] = { v: row.yarnId };
        cells[12] = { v: row.fabric };
      }
      if (key === 'dyed') {
        cells[1] = { f: `=${find('O' + n, 'knitting', 'K', 'D')}`, s: 'derived' };
        cells[9] = { f: `=IF(F${n}=0,"",(F${n}-G${n})/F${n}*100)`, s: 'derivedNumber' };
        const yarnId = find('O' + n, 'knitting', 'K', 'L');
        const yarnRate = find(yarnId, 'yarn', 'J', 'H');
        const knitRate = find('O' + n, 'knitting', 'K', 'I');
        cells[10] = {
          f: `=IF(F${n}=0,"",(${yarnRate}+${knitRate}+I${n})*(1+J${n}/100))`,
          s: 'derivedNumber',
        };
        cells[12] = { f: `=${find('O' + n, 'knitting', 'K', 'A')}`, s: 'derived' };
        cells[13] = { v: row.id };
        cells[14] = { v: row.knittingId };
      }
      if (key === 'yarn') {
        cells[5] = {
          f: `=SUMIF(${ref('knitting', 'L')},J${n},${ref('knitting', 'F')})`,
          s: 'derivedNumber',
        };
        cells[6] = { f: `=E${n}-F${n}`, s: 'derivedNumber' };
        cells[7] = { v: row.rate, s: 'number' };
        cells[8] = { v: row.count };
        cells[9] = { v: row.id };
      }
      if (key === 'greige') {
        cells[4] = {
          f: `=SUMIFS(${ref('knitting', 'G')},${ref('knitting', 'A')},A${n},${ref('knitting', 'D')},B${n})`,
          s: 'derivedNumber',
        };
        cells[5] = {
          f: `=SUMIFS(${ref('dyed', 'F')},${ref('dyed', 'M')},A${n},${ref('dyed', 'B')},B${n})`,
          s: 'derivedNumber',
        };
        cells[6] = { f: `=E${n}-F${n}`, s: 'derivedNumber' };
      }
      cellData[i + 1] = cells;
    });
    const columnData = Object.fromEntries(
      headers.map((h, i) => [
        i,
        { w: config.columns[i]?.width || 150, ...(i >= config.columns.length ? { hd: 1 } : {}) },
      ]),
    );
    sheets[key] = {
      id: key,
      name: config.title,
      tabColor: '#85bfea',
      rowCount: 200,
      columnCount: Math.max(20, headers.length),
      defaultRowHeight: 30,
      defaultColumnWidth: 150,
      cellData,
      columnData,
      rowData: { 0: { h: 42 } },
      freeze: { xSplit: 2, ySplit: 1, startRow: 1, startColumn: 2 },
      showGridlines: 1,
      mergeData: [],
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      rowHeader: { width: 45 },
      columnHeader: { height: 26 },
    };
  }
  return {
    id: 'fabric-library-poc',
    name: 'Fabric workspace',
    appVersion: '1.2.0',
    locale: 'enUS',
    styles: {
      heading: { bg: { rgb: '#e6f2fc' }, cl: { rgb: '#244e73' }, bl: 1, ht: 1, tb: 3 },
      number: { ht: 3 },
      text: { ht: 1 },
      derived: { cl: { rgb: '#526c82' } },
      derivedNumber: { cl: { rgb: '#526c82' }, ht: 3, n: { pattern: '0.00' } },
    },
    sheetOrder: Object.keys(pages),
    sheets,
  };
}
// Read source records using stable hidden IDs; sorting must not change identity.
export function readSourceChanges(snapshot, data) {
  const next = structuredClone(data);
  for (const [key, spec] of Object.entries(SOURCE_KEYS)) {
    const fields =
      key === 'knitting'
        ? { gsm: 4, consumption: 5, quantity: 6, rolls: 7, rate: 8 }
        : key === 'dyed'
          ? { gross: 5, billed: 6, final: 7, rate: 8 }
          : { quantity: 4 };
    const found = new Set();
    for (const [r, cells] of Object.entries(snapshot.sheets[key]?.cellData || {})) {
      if (+r === 0) continue;
      const id = cells[spec.id]?.v;
      if (!id) continue;
      if (found.has(id)) throw Error('Duplicate record identity in ' + key);
      found.add(id);
      const original = next[spec.entity].find((row) => row.id === id);
      if (!original) throw Error('Unknown source record ' + id);
      for (const [field, col] of Object.entries(fields)) {
        const cell = cells[col];
        if (cell?.f) throw Error('Source numeric inputs must be numbers, not formulas.');
        const v = cell?.v;
        if (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)))
          throw Error(original.bill + ': ' + field + ' must be numeric.');
        original[field] = Number(v);
      }
    }
    if (found.size !== next[spec.entity].length)
      throw Error('Source records were deleted or lost their identity in ' + key + '.');
  }
  return next;
}
