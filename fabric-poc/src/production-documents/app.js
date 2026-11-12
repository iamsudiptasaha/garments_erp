import { getAccessClient } from '../access/client.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { worksheetSearchDelay } from '../fabric/grid-toolbar.js';
import '../colours/styles.css';
import './styles.css';
import { challanDocuments } from './live.js';
const h = React.createElement;
const documentMaxAge = 60_000;
const documentActions = ['view', 'create', 'edit', 'delete', 'format', 'print', 'export'];

export function ProductionDocumentWorkspace({ page, can, changes }) {
  const [visited, setVisited] = useState({});
  useEffect(() => {
    if (!page || visited[page] || !can('view', page)) return;
    setVisited((previous) => ({ ...previous, [page]: true }));
  }, [page, visited, can]);
  return ['productionChallans', 'jobWorkerBills'].map((key) =>
    (visited[key] || page === key) && can('view', key)
      ? h(ProductionDocuments, {
          key: key + documentActions.map((action) => Number(can(action, key))).join(''),
          billing: key === 'jobWorkerBills',
          visible: page === key,
          changes,
        })
      : null,
  );
}

function ProductionDocuments({ billing, visible, changes }) {
  const host = useRef(null);
  const editor = useRef(null);
  const controller = useRef(null);
  const [screen, setScreen] = useState({});
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState(null);
  const title = billing ? 'Worker bills' : 'Challans';
  const presentation = screen.presentation || 'overview';
  const sheet = presentation === 'sheet';
  const spec = useMemo(
    () => ({ title, columns: billing ? billColumns : columns }),
    [billing, title],
  );
  const sheetRows = useMemo(() => {
    if (billing) return screen.matches;
    const data = screen.snapshot;
    return screen.matches?.map((record) => ({
      ...record,
      worker: data.workers.find(([id]) => id === record.worker)?.[1] || '',
      employee: record.employeeName,
      lineCount: record.lines.length,
    }));
  }, [billing, screen.matches, screen.snapshot]);
  useLayoutEffect(() => {
    const instance = mountDocuments(
      host.current,
      editor.current,
      billing,
      changes,
      setScreen,
      setSelection,
    );
    controller.current = instance;
    return instance.dispose;
  }, [billing, changes]);
  useLayoutEffect(() => {
    controller.current.setVisible(visible);
  }, [visible, billing, changes]);
  const permissions = screen.snapshot?.permissions || {};
  return h(
    'section',
    {
      ref: host,
      hidden: !visible,
      className: 'production-documents',
      'aria-label': 'Production documents',
    },
    h(
      'div',
      { hidden: screen.view === 'form' || screen.view === 'detail' },
      h(
        'header',
        { className: 'fabric-page-header' },
        h(
          'div',
          null,
          h('p', { className: 'eyebrow' }, 'PRODUCTION / ' + title.toUpperCase()),
          h('h1', null, title),
        ),
        h(
          'div',
          { className: 'fabric-view-toggle', 'aria-label': title + ' view' },
          ['overview', 'sheet'].map((mode) =>
            h(
              'button',
              {
                key: mode,
                type: 'button',
                'aria-pressed': presentation === mode,
                'data-action': 'view:' + mode,
              },
              mode === 'overview' ? 'Overview' : 'Sheet',
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'fabric-actions' + (sheet ? ' worksheet-actions' : '') },
        h('input', {
          type: 'search',
          'aria-label': 'Search ' + title.toLowerCase(),
          'data-search': '',
          placeholder: 'Search ' + title.toLowerCase() + '…',
        }),
        permissions.create &&
          h(
            'button',
            { type: 'button', className: 'primary', 'data-action': billing ? 'new-bill' : 'new' },
            billing ? '+ New worker bill' : '+ New challan',
          ),
        sheet &&
          h(
            'div',
            { 'data-sheet-actions': '' },
            h(
              'button',
              { type: 'button', 'data-action': 'open-selected', disabled: !selection },
              billing ? 'Open selected bill' : 'Open selected challan',
            ),
            permissions.edit &&
              h(
                'button',
                { type: 'button', 'data-action': 'edit-selected', disabled: !selection },
                billing ? 'Edit selected bill' : 'Edit selected document',
              ),
          ),
      ),
      screen.error &&
        h(
          'div',
          null,
          h('p', { className: 'form-error', role: 'alert' }, screen.error),
          h('button', { type: 'button', 'data-action': 'retry' }, 'Retry'),
        ),
      !screen.snapshot &&
        !screen.error &&
        h('p', { role: 'status' }, 'Loading production documents…'),
      screen.snapshot &&
        h(
          'div',
          { hidden: sheet },
          h(DocumentCards, { billing, matches: screen.matches, workers: screen.snapshot.workers }),
        ),
      screen.snapshot &&
        screen.sheetVisited &&
        h(
          'div',
          { hidden: !sheet },
          h('p', { className: 'fabric-status', role: 'status' }, notice),
          h(FabricSheet, {
            page: billing ? 'workerBills' : 'productionChallans',
            client: getAccessClient(),
            spec,
            records: sheetRows,
            onSelect: (record) => controller.current.select(record),
            onNotice: setNotice,
            capabilities: {
              format: permissions.format,
              export: permissions.export,
              print: permissions.print,
            },
          }),
        ),
    ),
    h('div', { ref: editor }),
  );
}

function DocumentCards({ billing, matches, workers }) {
  if (!matches.length)
    return h(
      'p',
      { className: 'fabric-status' },
      'No matching ' + (billing ? 'worker bills' : 'challans'),
    );
  const subtitle = (text) => h('p', { className: 'card-subtitle' }, text);
  return h(
    'div',
    { className: 'overview-grid lab-cards' },
    matches.map((record, index) =>
      h(
        'article',
        { key: record.key, className: 'overview-card lab-card tone-' + (index % 4) },
        h(
          'button',
          {
            className: 'lab-card-open',
            type: 'button',
            'aria-haspopup': 'dialog',
            'data-action': (billing ? 'bill:' : 'open:') + record.key,
          },
          h('span', { className: 'card-kicker' }, billing ? 'Worker bill' : 'Challan'),
          h('h2', null, record.id),
          billing
            ? subtitle(record.worker + ' · ' + record.challan)
            : subtitle(
                [
                  record.date || 'Date unavailable',
                  record.employeeName || 'Issuer unavailable',
                  workers.find(([id]) => id === record.worker)?.[1] || '',
                ].join(' · '),
              ),
          billing &&
            subtitle(
              (record.invoiceNumber || 'No invoice number') +
                ' · ' +
                (record.date || 'No bill date'),
            ),
          h(
            'span',
            { className: 'lab-status' },
            billing ? '₹' + record.rate : record.lines.length + ' job lines',
          ),
          h(
            'p',
            { className: 'lab-card-hint' },
            billing
              ? record.assignment + ' · View bill →'
              : record.lines.filter((line) => line.billed).length +
                  ' billed lines · View challan →',
          ),
        ),
      ),
    ),
  );
}

const columns = [
  { key: 'id', label: 'Challan' },
  { key: 'date', label: 'Issue date' },
  { key: 'employee', label: 'Issued by' },
  { key: 'worker', label: 'Job worker' },
  { key: 'lineCount', label: 'Job lines' },
];
const billColumns = [
  { key: 'id', label: 'Worker bill' },
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'date', label: 'Bill date' },
  { key: 'attachmentName', label: 'Bill attachment' },
  { key: 'worker', label: 'Job worker' },
  { key: 'challan', label: 'Challan' },
  { key: 'assignment', label: 'Job variant' },
  { key: 'rate', label: 'Billed rate' },
];
function mountDocuments(root, editor, billing, changes, update, updateSelection) {
  const api = challanDocuments();
  const listeners = new AbortController();
  const optionsForEvents = { signal: listeners.signal };
  let visible = false,
    freshUntil = 0,
    pending,
    version = 0,
    snapshot,
    matches,
    error;
  let jobs = {},
    workers = [],
    employees = [],
    records = [],
    stockIn = {},
    bills = [],
    permissions = {},
    busy = false;
  const line = () => ({ job: '', part: '', variant: '', cells: {}, description: '', rate: '' });
  const workerName = (id) => workers.find((worker) => worker[0] === id)?.[1] || '';
  function load() {
    if (pending) return pending;
    const ticket = version;
    pending = api
      .read(billing)
      .then((data) => {
        if (listeners.signal.aborted || ticket !== version) return false;
        snapshot = data;
        ({ jobs, workers, employees, records, stockIn, bills, permissions } = data);
        freshUntil = Date.now() + documentMaxAge;
        error = '';
        renderResults();
        return true;
      })
      .catch((problem) => {
        if (listeners.signal.aborted || ticket !== version) return false;
        if (problem.code === '42501') {
          snapshot = null;
          permissions = {};
          editor.replaceChildren();
          for (const dialog of root.querySelectorAll('dialog')) dialog.close();
          view = billing ? 'billing' : 'list';
          select(null);
        }
        error = problem.message;
        publish();
        return false;
      })
      .finally(() => {
        if (ticket === version) pending = null;
      });
    return pending;
  }
  function invalidate() {
    freshUntil = 0;
    version++;
    pending = null;
  }
  function invalidateDocuments() {
    if (listeners.signal.aborted) return;
    invalidate();
    changes.dispatchEvent(new CustomEvent('changed', { detail: billing }));
  }
  changes.addEventListener(
    'changed',
    (event) => {
      if (event.detail === billing) return;
      invalidate();
      if (visible) void load();
    },
    optionsForEvents,
  );
  let view = billing ? 'billing' : 'list',
    presentation = 'overview',
    search = '',
    sheetVisited = false,
    sheetSearchTimer,
    selected,
    draft,
    origin,
    sheetSelection;
  function select(record) {
    sheetSelection = sheetSearchTimer ? null : record?.key;
    updateSelection(sheetSelection);
  }
  function publish() {
    update({ view, presentation, sheetVisited, snapshot, matches, error });
  }
  const e = (s = '') =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const button = (action, label, primary = false) =>
    `<button type="button" class="${primary ? 'primary' : ''}" data-action="${action}">${e(label)}</button>`;
  const options = (values, current) =>
    values
      .map(
        ([v, t]) => `<option value="${e(v)}" ${v === current ? 'selected' : ''}>${e(t)}</option>`,
      )
      .join('');
  const table = (head, body) =>
    `<div class="lab-record-table-wrap"><table><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const input = (label, field, value, type = 'text', extra = '') =>
    `<label><span>${label}</span><input type="${type}" data-field="${field}" value="${e(value)}" ${extra}></label>`;
  function matchingRecords() {
    return records.filter((r) =>
      [
        r.id,
        r.employeeName,
        workerName(r.worker),
        ...r.lines.flatMap((l) => [l.job, l.part, jobs[l.job]?.[2], l.description, l.variant]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  }
  function billItem(item) {
    const challan = records.find((record) => record.key === item.challan);
    const line = challan.lines.find((line) => line.id === item.line);
    const [style, part] = line.part.split(' · ');
    return {
      number: challan.id,
      worker: challan.worker,
      style,
      part,
      variant: line.variant,
      quantities: jobs[line.job][4]
        .filter((size) => size in line.cells[line.variant])
        .map((size) => size + ': ' + line.cells[line.variant][size])
        .join(' · '),
      description: line.description,
      challanRate: line.rate,
    };
  }
  function billRecords() {
    return bills
      .map((bill) => {
        const items = bill.items.map(billItem);
        return {
          ...bill,
          id: bill.number,
          attachmentName: bill.attachment?.name || '',
          worker: workerName(items[0]?.worker),
          challan: [...new Set(items.map((item) => item.number))].join(', '),
          assignment: items
            .map((item) => `${item.style} · ${item.part} · ${item.variant}`)
            .join(' / '),
          rate: bill.items.map((item) => item.rate).join(' / '),
          ...(items.length > 1
            ? {
                displayValues: {
                  challan: items.map((item) => item.number),
                  assignment: items.map((item) => `${item.style} · ${item.part} · ${item.variant}`),
                  rate: bill.items.map((item) => item.rate),
                },
              }
            : {}),
        };
      })
      .filter((bill) =>
        [bill.id, bill.invoiceNumber, bill.worker, bill.challan, bill.assignment]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
      );
  }
  function renderResults() {
    if (snapshot) matches = billing ? billRecords() : matchingRecords();
    select(null);
    publish();
  }
  function formLine(l, i) {
    const job = jobs[l.job];
    return `<section class="fabric-line" data-line="${i}">
      <div class="line-heading"><h3>Job-variant line ${i + 1}</h3>${button('remove:' + i, 'Remove')}</div>
      <div class="fabric-fields">
        <label><span>Job variant</span><button type="button" aria-label="Select job variant" aria-haspopup="dialog" data-action="pick-variant:${i}" ${draft.worker && !l.billed ? '' : 'disabled'}>${e(l.job ? `${l.part} · ${l.variant} (${job[5]})` : draft.worker ? 'Select job variant' : 'Select a job worker first')}</button></label>
      </div>
      <div class="fabric-fields">${input('Description', 'description', l.description)}${input('Challan rate', 'rate', l.rate, 'number', 'min="0" step="any"')}</div>
      ${l.variant ? table(job[4], `<tr>${job[4].map((size) => `<td>${e(l.cells[l.variant]?.[size] || '—')}</td>`).join('')}</tr>`) : ''}
      ${l.variant ? '<p>Issued quantities use the full recorded stock-in by size.</p>' : ''}
    </section>`;
  }
  function detailLine(l) {
    const job = jobs[l.job];
    const quantities = table(
      ['Size', 'Issued pieces'],
      job[4]
        .filter((size) => size in l.cells[l.variant])
        .map((size) => `<tr><td>${e(size)}</td><td>${e(l.cells[l.variant][size])}</td></tr>`)
        .join(''),
    );
    return `<section class="lab-detail"><div class="editor-heading"><h3>${e(l.part)} · ${e(l.variant)}</h3>${button('job:' + l.job, job[5])}<span class="print-only">${e(job[5])}</span></div>
      <p>${e(job[1])} · ${e(workerName(job[2]))}</p>
      <dl class="lab-submission-fields"><div><dt>Description</dt><dd>${e(l.description) || '—'}</dd></div><div><dt>Challan rate</dt><dd>${e(l.rate) || '—'}</dd></div></dl>
      ${quantities}</section>`;
  }
  function detail() {
    return `<dialog class="fabric-dialog lab-progress-dialog" data-challan-detail aria-labelledby="challan-detail-title">
      <div class="editor-heading"><div><small>PRODUCTION / CHALLANS</small><h2 id="challan-detail-title">${e(selected.id)}</h2></div>${button('list', 'Close')}</div>
      <div class="lab-expanded">
        <dl class="lab-submission-fields"><div><dt>Job worker</dt><dd>${e(workerName(selected.worker))}</dd></div><div><dt>Issue date</dt><dd>${e(selected.date) || '—'}</dd></div><div><dt>Issued by</dt><dd>${e(selected.employeeName) || '—'}</dd></div></dl>
        <h2>Job lines</h2>${selected.lines.map(detailLine).join('')}
        <div class="editor-actions">${permissions.print ? button('print', 'Print challan') : ''}${permissions.edit ? button('edit', 'Edit challan', true) : ''}${permissions.delete && !selected.lines.some((line) => line.billed) ? button('delete', 'Delete challan') : ''}</div>
      </div>
    </dialog>`;
  }
  function heading(title, actions = '') {
    return `<header class="fabric-page-header"><div><p class="eyebrow">PRODUCTION / ${view === 'billing' ? 'WORKER BILLS' : 'CHALLANS'}</p><h1>${e(title)}</h1></div>${actions}</header>`;
  }
  function render() {
    if (listeners.signal.aborted) return;
    editor.innerHTML =
      view === 'list' || view === 'billing'
        ? ''
        : view === 'form'
          ? `${heading(draft.id ? 'Edit challan' : 'New challan')}
        <form><div class="fabric-fields"><label><span>Job worker</span><select aria-label="Job worker" data-field="worker" required>${options([['', 'Select a job worker'], ...workers], draft.worker)}</select></label>${input('Issue date', 'date', draft.date, 'date')}<label><span>Issuing employee</span><select data-field="employee">${options([['', 'Select employee'], ...employees], draft.employee)}</select></label></div>
        ${draft.lines.map(formLine).join('')}
        ${button('add', 'Add job line')}<p role="alert" class="form-error"></p>
        <div class="editor-actions">${button('cancel', 'Cancel')}<button class="primary" type="submit">Save challan</button></div></form>`
          : detail();
    publish();
    if (view === 'detail') {
      const dialog = root.querySelector('[data-challan-detail]');
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        view = 'list';
        render();
      });
      if (visible) dialog.showModal();
    }
  }
  root.addEventListener(
    'input',
    ({ target: t }) => {
      if (t.hasAttribute('data-search')) {
        search = t.value;
        if (presentation === 'sheet') {
          select(null);
          clearTimeout(sheetSearchTimer);
          sheetSearchTimer = setTimeout(() => {
            sheetSearchTimer = null;
            renderResults();
          }, worksheetSearchDelay);
        } else renderResults();
        return;
      }
      if (view !== 'form') return;
      const row = t.closest('[data-line]');
      const model = row ? draft.lines[Number(row.dataset.line)] : draft;
      if (t.dataset.field && !['worker', 'assignment'].includes(t.dataset.field))
        model[t.dataset.field] = t.value;
    },
    optionsForEvents,
  );
  root.addEventListener(
    'change',
    ({ target: t }) => {
      if (t.dataset.field === 'worker') {
        if (draft.lines.some((line) => line.job && jobs[line.job][2] !== t.value)) {
          t.value = draft.worker;
          editor.querySelector('[role="alert"]').textContent =
            'Remove the selected job lines before changing the job worker.';
          return;
        }
        draft.worker = t.value;
        render();
        root.querySelector('[data-action^="pick-variant:"]')?.focus();
      }
    },
    optionsForEvents,
  );
  function showDialog(
    markup,
    className = 'fabric-dialog',
    parent = root.querySelector('[data-challan-detail]') || root,
    titleId = 'production-document-dialog-title',
  ) {
    const dialog = document.createElement('dialog');
    dialog.className = className;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.innerHTML = markup;
    parent.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    return dialog;
  }
  const dialogHeader = (title) =>
    `<div class="editor-heading"><h2 id="production-document-dialog-title">${e(title)}</h2><form method="dialog"><button>Close</button></form></div>`;
  function pickVariant(index) {
    if (draft.lines[index].billed) return;
    const choices = Object.entries(jobs)
      .filter(([, job]) => job[2] === draft.worker)
      .flatMap(([id, job]) =>
        job[3]
          .filter((variant) => Object.keys(stockIn[id][variant]).length)
          .map((variant) => ({ id, variant, labels: [...job[0].split(' · '), variant, job[5]] })),
      );
    const dialog = showDialog(
      `${dialogHeader('Select job variant')}<input type="search" aria-label="Search job variants" placeholder="Search item, part, variant or job"><div data-picker-results></div>`,
      'fabric-dialog lab-record-dialog',
    );
    const search = dialog.querySelector('input');
    const results = dialog.querySelector('[data-picker-results]');
    const refresh = () => {
      const matches = choices.filter((choice) =>
        choice.labels.join(' ').toLowerCase().includes(search.value.trim().toLowerCase()),
      );
      results.innerHTML = table(
        ['Item', 'Item part', 'Variant', 'Job', ''],
        matches
          .map(
            (choice) =>
              `<tr>${choice.labels.map((label) => `<td>${e(label)}</td>`).join('')}<td><button type="button" data-choice="${choices.indexOf(choice)}" aria-label="Select ${e(choice.labels.join(' · '))}">Select</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="5">No matching job variants</td></tr>',
      );
    };
    search.addEventListener('input', refresh);
    results.addEventListener('click', (event) => {
      const choice = choices[event.target.closest('[data-choice]')?.dataset.choice];
      if (!choice) return;
      const { id: job, variant } = choice;
      const existing = draft.lines[index];
      const quantities =
        existing.id && existing.job === job ? existing.cells[variant] : stockIn[job][variant];
      Object.assign(existing, {
        job,
        variant,
        part: jobs[job][0],
        cells: { [variant]: { ...quantities } },
      });
      dialog.close();
      render();
      root.querySelector(`[data-action="pick-variant:${index}"]`)?.focus();
    });
    refresh();
    search.focus();
  }
  function editBill(bill) {
    const items = (bill?.items || []).map((item) => ({ ...item }));
    const dialog = showDialog(`${dialogHeader(bill ? 'Edit worker bill' : 'New worker bill')}
      <form data-bill-form><div class="fabric-fields">
      <label><span>Job worker</span><select name="worker" required>${options([['', 'Select job worker'], ...workers], items.length ? billItem(items[0]).worker : '')}</select></label>
      <label><span>Invoice number</span><input name="invoiceNumber" value="${e(bill?.invoiceNumber)}"></label>
      <label><span>Bill date</span><input type="date" name="date" value="${e(bill?.date)}"></label>
      <label><span>Bill attachment</span><input type="file" name="attachment" ${permissions.edit ? '' : 'disabled'}></label>
      ${bill?.attachment ? `<label><span>Current attachment · ${e(bill.attachment.name)}</span><span><input type="checkbox" name="removeAttachment" ${permissions.edit ? '' : 'disabled'}> Remove attachment</span></label>` : ''}
      </div><h3>Bill items</h3><div data-bill-items></div>
      <button type="button" data-add-bill-item>+ Select challan item</button>
      <p data-bill-error class="form-error" role="alert" hidden></p>
      <div class="editor-actions"><button class="primary">Save worker bill</button></div></form>`);
    const worker = dialog.querySelector('[name=worker]');
    const rows = dialog.querySelector('[data-bill-items]');
    const add = dialog.querySelector('[data-add-bill-item]');
    const error = dialog.querySelector('[data-bill-error]');
    const showError = (message) => {
      error.textContent = message;
      error.hidden = !message;
    };
    const refresh = () => {
      add.disabled = !worker.value;
      rows.innerHTML = items.length
        ? table(
            [
              'No.',
              'Challan',
              'Item style code',
              'Item part',
              'Variant',
              'Challan item details',
              'Billed price',
              '',
            ],
            items
              .map((item, index) => {
                const info = billItem(item);
                return `<tr><td>${index + 1}</td><td>${e(info.number)}</td><td>${e(info.style)}</td><td>${e(info.part)}</td><td>${e(info.variant)}</td>
          <td>${e(info.quantities)}${info.description ? `<br>${e(info.description)}` : ''}${info.challanRate ? `<br>Challan rate ₹${e(info.challanRate)}` : ''}</td>
          <td><input type="number" min="0" step="any" required aria-label="Billed price for item ${index + 1}" data-item-rate="${index}" value="${e(item.rate)}"></td>
          <td><button type="button" data-remove-bill-item="${index}">Remove</button></td></tr>`;
              })
              .join(''),
          )
        : '<p class="fabric-status">No challan items selected.</p>';
    };
    worker.addEventListener('change', () => {
      if (items.some((item) => billItem(item).worker !== worker.value)) {
        worker.value = billItem(items[0]).worker;
        showError('Remove the selected bill items before changing the job worker.');
        return;
      }
      showError('');
      refresh();
    });
    rows.addEventListener('input', (event) => {
      if (event.target.matches('[data-item-rate]'))
        items[Number(event.target.dataset.itemRate)].rate = event.target.value;
    });
    rows.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-bill-item]');
      if (!remove) return;
      items.splice(Number(remove.dataset.removeBillItem), 1);
      showError('');
      refresh();
    });
    add.addEventListener('click', () =>
      pickBillItem(
        worker.value,
        items,
        (item) => {
          items.push(item);
          showError('');
          refresh();
        },
        dialog,
        bill,
      ),
    );
    dialog.querySelector('[data-bill-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!items.length) {
        showError('Select at least one challan item.');
        return;
      }
      if (items.some((item) => challanLineAlreadyBilled(item, bill))) {
        showError('A selected challan item already belongs to another worker bill.');
        return;
      }
      const data = new FormData(event.target);
      const file = data.get('attachment');
      if (busy) return;
      const submit = event.target.querySelector('button.primary');
      busy = submit.disabled = true;
      try {
        const key = await api.save(true, bill?.key ? 'edit' : 'create', {
          key: bill?.key,
          revision: bill?.revision,
          lines: items,
          invoiceNumber: data.get('invoiceNumber'),
          date: data.get('date') || null,
          removeAttachment: !file.name && data.has('removeAttachment'),
        });
        if (listeners.signal.aborted) return;
        invalidateDocuments();
        if (file.name) {
          try {
            await api.attach(key, file);
          } catch (error) {
            await load();
            bill = bills.find((row) => row.key === key) || bill;
            throw Error('Bill saved. Attachment upload failed: ' + error.message, { cause: error });
          }
        }
        await load();
        dialog.close();
      } catch (error) {
        showError(error.message);
      } finally {
        busy = submit.disabled = false;
      }
    });
    refresh();
  }
  function challanLineAlreadyBilled(item, bill) {
    return bills.some(
      (other) =>
        other !== bill &&
        other.items.some((line) => line.challan === item.challan && line.line === item.line),
    );
  }
  function pickBillItem(worker, items, onPick, parent, bill) {
    const choices = records
      .filter((record) => record.worker === worker)
      .flatMap((record) =>
        record.lines.map((line) => ({ challan: record.key, line: line.id, rate: '' })),
      )
      .filter(
        (item) =>
          !challanLineAlreadyBilled(item, bill) &&
          !items.some((line) => line.challan === item.challan && line.line === item.line),
      );
    const picker = showDialog(
      `<div class="editor-heading"><h2 id="challan-item-picker-title">Select challan item</h2><form method="dialog"><button>Close</button></form></div>
      <input type="search" aria-label="Search challan items" placeholder="Search challan, style code, part or variant"><div data-challan-items></div>`,
      'fabric-dialog lab-record-dialog',
      parent,
      'challan-item-picker-title',
    );
    const search = picker.querySelector('input');
    const results = picker.querySelector('[data-challan-items]');
    const refresh = () => {
      const rows = choices
        .map((item, index) => {
          const info = billItem(item);
          const cells = [info.number, info.style, info.part, info.variant];
          if (!cells.join(' ').toLowerCase().includes(search.value.trim().toLowerCase())) return '';
          return `<tr>${cells.map((value) => `<td>${e(value)}</td>`).join('')}<td><button type="button" data-choice="${index}" aria-label="Select ${e(cells.join(' · '))}">Select</button></td></tr>`;
        })
        .join('');
      results.innerHTML = table(
        ['Challan number', 'Item style code', 'Item part', 'Variant', ''],
        rows || '<tr><td colspan="5">No matching challan items</td></tr>',
      );
    };
    search.addEventListener('input', refresh);
    results.addEventListener('click', (event) => {
      const choice = choices[event.target.closest('[data-choice]')?.dataset.choice];
      if (!choice) return;
      picker.close();
      onPick(choice);
      [...parent.querySelectorAll('[data-item-rate]')].at(-1)?.focus();
    });
    refresh();
    search.focus();
  }
  function viewBill(bill) {
    const dialog = showDialog(
      `${dialogHeader(bill.number)}
      <div class="lab-expanded"><dl class="lab-submission-fields">
      <div><dt>Job worker</dt><dd>${e(workerName(bill.items[0] && billItem(bill.items[0]).worker))}</dd></div>
      <div><dt>Invoice number</dt><dd>${e(bill.invoiceNumber) || '—'}</dd></div>
      <div><dt>Bill date</dt><dd>${e(bill.date) || '—'}</dd></div>
      <div><dt>Bill attachment</dt><dd>${bill.attachment ? button('attachment', bill.attachment.name) : 'No attachment'}</dd></div></dl>
      <h3>Bill items</h3>${table(
        [
          'No.',
          'Challan number',
          'Item style code',
          'Item part',
          'Variant',
          'Challan item details',
          'Billed price',
        ],
        bill.items
          .map((item, index) => {
            const info = billItem(item);
            return `<tr><td>${index + 1}</td><td>${e(info.number)}</td><td>${e(info.style)}</td><td>${e(info.part)}</td><td>${e(info.variant)}</td><td>${e(info.quantities)}${info.description ? `<br>${e(info.description)}` : ''}${info.challanRate ? `<br>Challan rate ₹${e(info.challanRate)}` : ''}</td><td>₹${e(item.rate)}</td></tr>`;
          })
          .join(''),
      )}<div class="editor-actions">${permissions.edit ? button('edit-bill:' + bill.key, 'Edit bill', true) : ''}${permissions.delete ? button('delete-bill:' + bill.key, 'Delete bill') : ''}</div></div>`,
      'fabric-dialog lab-progress-dialog',
    );
    dialog.querySelector('[data-action="attachment"]')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const file = await api.openAttachment(bill.attachment);
        if (file.url) location.assign(file.url);
      } catch (error) {
        window.alert(error.message);
      }
    });
    dialog
      .querySelector('[data-action^="edit-bill"]')
      ?.addEventListener('click', () => dialog.close());
  }
  root.addEventListener(
    'click',
    async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      let [cmd, arg] = action.split(':');
      if (busy) return;
      if (cmd === 'edit-selected' && (!permissions.edit || !sheetSelection)) return;
      if (cmd === 'open-selected' && !sheetSelection) return;
      if (cmd === 'delete' || cmd === 'delete-bill') {
        const billing = cmd === 'delete-bill';
        const record = billing ? bills.find((b) => b.key === arg) : selected;
        if (
          !record ||
          !window.confirm('Delete this ' + (billing ? 'worker bill' : 'challan') + '?')
        )
          return;
        busy = true;
        try {
          await api.save(billing, 'delete', { key: record.key, revision: record.revision });
          invalidateDocuments();
          await load();
          if (billing) event.target.closest('dialog')?.close();
          view = billing ? 'billing' : 'list';
          render();
        } catch (error) {
          window.alert(error.message);
        } finally {
          busy = false;
        }
        return;
      }
      if (cmd === 'pick-variant') {
        pickVariant(Number(arg));
        return;
      }
      if (
        view === 'billing' &&
        (cmd === 'new-bill' || cmd === 'edit-bill' || cmd === 'edit-selected')
      ) {
        const bill =
          cmd === 'new-bill' ? null : bills.find((b) => b.key === (arg || sheetSelection));
        if (cmd === 'new-bill' || bill) editBill(bill);
        return;
      }
      if (view === 'billing' && cmd === 'open-selected') {
        cmd = 'bill';
        arg = sheetSelection;
      }
      if (cmd === 'bill') {
        const bill = bills.find((b) => b.key === arg);
        if (bill) viewBill(bill);
        return;
      }
      if (cmd === 'job') {
        showDialog(
          `${dialogHeader(jobs[arg][5])}<p>${[jobs[arg][0], jobs[arg][1], workerName(jobs[arg][2])].map(e).join(' · ')}</p>`,
        );
        return;
      }
      if (cmd === 'print') {
        window.print();
        return;
      }
      if (cmd === 'list') view = 'list';
      if (cmd === 'view') {
        presentation = arg;
        sheetVisited ||= arg === 'sheet';
        if (sheetSearchTimer) {
          clearTimeout(sheetSearchTimer);
          sheetSearchTimer = null;
          renderResults();
        } else publish();
        return;
      }
      if (cmd === 'retry') {
        void load();
        return;
      }
      if (cmd === 'open' || cmd === 'open-selected' || cmd === 'edit-selected') {
        selected = records.find((r) => r.key === (arg || sheetSelection));
        if (!selected) return;
        view = 'detail';
      }
      if (cmd === 'new') {
        origin = 'list';
        draft = {
          date: new Date().toLocaleDateString('sv-SE'),
          employee: '',
          worker: '',
          lines: [line()],
        };
        view = 'form';
      }
      if (cmd === 'edit' || cmd === 'edit-selected') {
        origin = 'detail';
        draft = structuredClone(selected);
        view = 'form';
      }
      if (cmd === 'cancel') view = origin;
      if (cmd === 'add') draft.lines.push(line());
      if (cmd === 'remove') {
        if (draft.lines[Number(arg)].billed) {
          editor.querySelector('[role="alert"]').textContent =
            'Keep lines referenced by worker bills.';
          return;
        }
        draft.lines.splice(Number(arg), 1);
      }
      render();
      if (cmd === 'add')
        root.querySelector('[data-line]:last-of-type [data-action^="pick-variant:"]')?.focus();
    },
    optionsForEvents,
  );
  root.addEventListener(
    'submit',
    async (event) => {
      if (view !== 'form' || event.target.method === 'dialog') return;
      event.preventDefault();
      if (busy) return;
      const error = editor.querySelector('[role="alert"]');
      const problem = !draft.lines.length
        ? 'Add at least one job line.'
        : draft.lines
            .map((l, i) => {
              if (
                !draft.worker ||
                jobs[l.job]?.[2] !== draft.worker ||
                l.part !== jobs[l.job][0] ||
                !jobs[l.job][3].includes(l.variant)
              )
                return `Select a valid job, part and variant on line ${i + 1}.`;
              const original = records
                .find((record) => record.key === draft.key)
                ?.lines.find((line) => line.id === l.id && line.job === l.job);
              const expected = original?.cells[l.variant] || stockIn[l.job][l.variant];
              const issued = l.cells[l.variant] || {};
              if (
                Object.keys(issued).length !== Object.keys(expected).length ||
                Object.entries(expected).some(([size, quantity]) => issued[size] !== quantity)
              ) {
                return `Line ${i + 1} must match the full stock-in by size.`;
              }
              return '';
            })
            .find(Boolean);
      if (problem) {
        error.textContent = problem;
        return;
      }
      const submit = event.submitter;
      busy = true;
      if (submit) submit.disabled = true;
      try {
        const key = await api.save(false, draft.key ? 'edit' : 'create', {
          key: draft.key,
          revision: draft.revision,
          date: draft.date || null,
          employee: draft.employee || null,
          lines: draft.lines.map((l) => ({
            id: l.id,
            assignment: l.job,
            rate: l.rate || null,
            description: l.description,
            quantities: l.cells[l.variant],
          })),
        });
        invalidateDocuments();
        const loaded = await load();
        if (listeners.signal.aborted) return;
        selected = loaded && records.find((record) => record.key === key);
        view = selected && visible ? 'detail' : 'list';
        render();
      } catch (problem) {
        error.textContent = problem.message;
      } finally {
        busy = false;
        if (submit) submit.disabled = false;
      }
    },
    optionsForEvents,
  );
  return {
    select,
    setVisible(next) {
      visible = next;
      if (next) {
        if (Date.now() >= freshUntil) void load();
        return;
      }
      for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
      if (view === 'detail') {
        view = 'list';
        render();
      }
    },
    dispose() {
      listeners.abort();
      clearTimeout(sheetSearchTimer);
    },
  };
}
