import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_simple.min.css';
import { seed, clone, project, applyChanges } from './model.js';
import './tabulator-demo.css';
const $ = (s) => document.querySelector(s);
let data = clone(seed),
  restoring = false,
  view = 'sheet';
function message(text, error = false) {
  $('#message').textContent = text;
  $('#message').className = error ? 'error' : '';
}
const numeric = (field, title, sum = false) => ({
  field,
  title,
  editor: 'number',
  editorParams: { min: 0, step: 'any' },
  validator: ['required', 'numeric', 'min:0'],
  sorter: 'number',
  hozAlign: 'right',
  width: 155,
  ...(sum ? { bottomCalc: 'sum', bottomCalcParams: { precision: 2 } } : {}),
});
function headerMenu() {
  return [
    {
      label: 'Hide this column',
      action: (e, col) => {
        col.hide();
        renderColumnMenu();
      },
    },
  ];
}
const table = new Tabulator('#tabulator-grid', {
  index: 'id',
  data: project(data, 'knitting'),
  height: 440,
  layout: 'fitDataStretch',
  renderHorizontal: 'basic',
  movableColumns: true,
  resizableRows: true,
  frozenRows: [],
  selectableRange: true,
  selectableRangeColumns: false,
  selectableRangeRows: true,
  selectableRangeClearCells: false,
  rowHeader: {
    formatter: 'rownum',
    width: 44,
    hozAlign: 'center',
    frozen: true,
    resizable: false,
    headerSort: false,
    headerFilter: false,
    headerMenu: false,
    cssClass: 'row-number',
    download: false,
    print: false,
  },
  editTriggerEvent: 'dblclick',
  validationMode: 'blocking',
  history: true,
  clipboard: true,
  clipboardCopyRowRange: 'range',
  clipboardPasteParser: 'range',
  clipboardPasteAction: 'range',
  clipboardCopyConfig: { rowHeaders: false, columnHeaders: false, columnCalcs: false },
  printAsHtml: true,
  printStyled: true,
  printRowRange: 'active',
  printHeader: '<h2>Knitting bills</h2><p>Fabric workspace · Sample records</p>',
  printConfig: { rowHeaders: false, columnCalcs: true },
  columnDefaults: {
    headerFilter: 'input',
    headerFilterPlaceholder: 'Filter…',
    resizable: 'header',
    headerMenu,
  },
  columns: [
    { field: 'bill', title: 'Knitting bill', width: 145, bottomCalc: () => 'Totals' },
    { field: 'fabricName', title: 'Fabric name', width: 180 },
    { field: 'knitter', title: 'Knitter', width: 175 },
    { field: 'date', title: 'Date', width: 140 },
    numeric('gsm', 'Greige GSM'),
    numeric('consumption', 'Yarn consumed · kg', true),
    numeric('quantity', 'Knitted output · kg', true),
    numeric('rolls', 'Billed rolls', true),
    numeric('rate', 'Billed rate / kg'),
    { field: 'yarnBill', title: 'Source yarn bill', width: 150 },
  ],
  placeholder: 'No matching knitting records',
});
table.on('tableBuilt', () => {
  renderColumnMenu();
  updateCount();
});
table.on('dataFiltered', (filters, rows) => {
  $('#record-count').textContent = rows.length + ' matching records';
  if (view === 'overview') renderOverview();
});
table.on('columnVisibilityChanged', renderColumnMenu);
table.on('renderComplete', updateCount);
table.on('cellEdited', (cell) => {
  if (restoring) return;
  const field = cell.getField(),
    row = cell.getRow().getData();
  try {
    data = applyChanges(data, 'knitting', [
      { id: row.id, key: field, value: Number(cell.getValue()) },
    ]);
    message('Sample value updated. Business quantity checks passed.');
  } catch (e) {
    restoring = true;
    cell.restoreOldValue();
    table.recalc();
    restoring = false;
    message(e.message + ' Previous value restored.', true);
  }
  if (view === 'overview') renderOverview();
});
function updateCount() {
  if (!table.initialized) return;
  $('#record-count').textContent = table.getDataCount('active') + ' matching records';
}
function renderColumnMenu() {
  if (!table.initialized) return;
  const root = $('#column-options');
  root.replaceChildren();
  table
    .getColumns()
    .filter((c) => c.getField())
    .forEach((col) => {
      const label = document.createElement('label'),
        checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = col.isVisible();
      checkbox.onchange = () => {
        if (
          !checkbox.checked &&
          table.getColumns().filter((c) => c.getField() && c.isVisible()).length === 1
        ) {
          checkbox.checked = true;
          return;
        }
        col.toggle();
      };
      label.append(checkbox, document.createTextNode(col.getDefinition().title));
      root.append(label);
    });
}
$('#search').oninput = (e) => {
  const text = e.target.value.toLowerCase();
  if (!text) table.clearFilter();
  else
    table.setFilter((row) =>
      [row.bill, row.fabricName, row.knitter, row.yarnBill].some((v) =>
        String(v).toLowerCase().includes(text),
      ),
    );
};
$('#freeze-rows').onchange = (e) => {
  const n = Number(e.target.value);
  table.getRows().forEach((row) => {
    if (row.isFrozen()) row.unfreeze();
  });
  table
    .getRows('active')
    .slice(0, n)
    .forEach((row) => row.freeze());
  message(n ? 'First ' + n + ' matching row(s) frozen using Tabulator.' : 'Rows unfrozen.');
};
$('#csv').onclick = () =>
  table.download('csv', 'knitting-bills-tabulator.csv', { bom: true }, 'active');
$('#preview-print').onclick = () => {
  const html = table.getHtml('active', true, { columnCalcs: true, rowHeaders: false }, 'print');
  $('#printed-table').innerHTML = html;
  $('#print-preview').showModal();
};
const print = () => table.print('active', true, { rowHeaders: false, columnCalcs: true });
$('#print-table').onclick = print;
$('#print-from-preview').onclick = () => {
  $('#print-preview').close();
  print();
};
function renderOverview() {
  const root = $('#overview-content');
  root.replaceChildren();
  table.getData('active').forEach((row) => {
    const card = document.createElement('article');
    card.className = 'card';
    const small = document.createElement('small');
    small.textContent = row.bill + ' · ' + row.knitter;
    const h = document.createElement('h2');
    h.textContent = row.fabricName;
    const strong = document.createElement('strong');
    strong.className = 'measure';
    strong.textContent = row.quantity.toLocaleString() + ' kg';
    const p = document.createElement('p');
    p.textContent = 'Knitted output';
    card.append(small, h, strong, p);
    root.append(card);
  });
}
function changeView(next) {
  view = next;
  $('#sheet-content').hidden = next !== 'sheet';
  $('#overview-content').hidden = next !== 'overview';
  $('#sheet').setAttribute('aria-pressed', String(next === 'sheet'));
  $('#overview').setAttribute('aria-pressed', String(next === 'overview'));
  if (next === 'overview') renderOverview();
  else table.redraw();
}
$('#sheet').onclick = () => changeView('sheet');
$('#overview').onclick = () => changeView('overview');
