import React from 'react';
import { createRoot } from 'react-dom/client';
import { FabricSheet } from '../fabric/sheet.js';
import '../colours/styles.css';
import { challanDocuments } from './live.js';
import { pages } from '../fabric/catalog.js';
(() => {
  const root = document.getElementById('challan-review');
  const api = challanDocuments();
  let jobs = {},
    workers = [],
    employees = [],
    records = [],
    stockIn = {},
    bills = [],
    permissions = {},
    busy = false,
    revision = 0;
  const line = () => ({ job: '', part: '', variant: '', cells: {}, description: '', rate: '' });
  const workerName = (id) => workers.find((worker) => worker[0] === id)?.[1] || '';
  async function load(billing) {
    const ticket = ++revision;
    const data = await api.read(billing);
    if (ticket !== revision) return false;
    document.getElementById('challans-nav').hidden = !data.pages.challans;
    document.getElementById('worker-bills-nav').hidden = !data.pages.billing;
    ({ jobs, workers, employees, records, stockIn, bills, permissions } = data);
    return true;
  }
  let view = 'list',
    presentation = 'overview',
    search = '',
    selected,
    draft,
    origin,
    sheetRoot,
    sheetSelection;
  const productionNav = document.getElementById('production-pages');
  for (const [key, page] of Object.entries(pages).filter(
    ([, page]) => page.section === 'production' && !page.hiddenNavigation,
  )) {
    const link = document.createElement('a');
    link.href = '/fabric.html?live=1#' + key;
    link.textContent = page.title;
    productionNav.before(link);
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
  const columns = [
    { key: 'id', label: 'Challan' },
    { key: 'date', label: 'Issue date' },
    { key: 'employee', label: 'Issued by' },
    { key: 'worker', label: 'Job worker' },
    { key: 'lineCount', label: 'Job lines' },
  ];
  const challanPreferences = { sort: { key: 'id', direction: 'asc' } };
  const billPreferences = { sort: { key: 'id', direction: 'asc' } };
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
  const sheetPreferences = () => (view === 'billing' ? billPreferences : challanPreferences);
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
  const sheetMeasure = document.createElement('canvas').getContext('2d');
  function fitSheetColumns(columns, rows, available) {
    const minimums = columns.map((column) => {
      sheetMeasure.font = 'bold 15px Arial';
      let width = sheetMeasure.measureText('↑ ' + column.label).width;
      sheetMeasure.font = '15px Arial';
      for (const row of rows) {
        for (const value of row.displayValues?.[column.key] || [row[column.key] ?? '']) {
          width = Math.max(width, sheetMeasure.measureText(String(value)).width);
        }
      }
      return Math.max(92, Math.ceil(width) + 24);
    });
    const minimumWidth = minimums.reduce((sum, width) => sum + width, 0);
    const extra = Math.max(0, available - minimumWidth);
    return columns.map((column, index) => ({
      ...column,
      width: minimums[index] + Math.floor((extra * minimums[index]) / minimumWidth),
    }));
  }
  function renderResults() {
    sheetRoot?.unmount();
    sheetRoot = null;
    const results = root.querySelector('[data-results]');
    const billing = view === 'billing';
    const matches = billing ? billRecords() : matchingRecords();
    const sheetColumns = billing ? billColumns : columns;
    const preferences = sheetPreferences();
    if (!matches.length) {
      results.innerHTML = `<p class="fabric-status">No matching ${billing ? 'worker bills' : 'challans'}</p>`;
      return;
    }
    if (presentation === 'overview') {
      results.innerHTML = `<div class="overview-grid lab-cards">${matches
        .map(
          (record, index) => `
        <article class="overview-card lab-card tone-${index % 4}">
          <button class="lab-card-open" type="button" aria-haspopup="dialog" data-action="${billing ? 'bill' : 'open'}:${e(record.key)}">
            ${
              billing
                ? `<span class="card-kicker">Worker bill</span><h2>${e(record.id)}</h2>
            <p class="card-subtitle">${e(record.worker)} · ${e(record.challan)}</p>
            <p class="card-subtitle">${e(record.invoiceNumber || 'No invoice number')} · ${e(record.date || 'No bill date')}</p>
            <span class="lab-status">₹${e(record.rate)}</span>
            <p class="lab-card-hint">${e(record.assignment)} · View bill →</p>`
                : `            <span class="card-kicker">Challan</span><h2>${e(record.id)}</h2>
            <p class="card-subtitle">${e(record.date || 'Date unavailable')} · ${e(record.employeeName || 'Issuer unavailable')} · ${e(workerName(record.worker))}</p>
            <span class="lab-status">${record.lines.length} job lines</span>
            <p class="lab-card-hint">${record.lines.filter((line) => line.billed).length} billed lines · View challan →</p>`
            }
          </button>
        </article>`,
        )
        .join('')}</div>`;
      return;
    }
    results.innerHTML = `<div class="fabric-actions" data-sheet-actions>
      <button type="button" data-action="edit-selected" disabled>${billing ? 'Edit selected bill' : 'Edit selected document'}</button>
      <button type="button" data-action="open-selected" disabled>${billing ? 'Open selected bill' : 'Open selected challan'}</button>
    </div>
    <div class="fabric-sort"><label>Sort complete rows by
      <select aria-label="Sort column" data-sort="key">${options(
        sheetColumns.map((c) => [c.key, c.label]),
        preferences.sort.key,
      )}</select>
    </label><select aria-label="Sort direction" data-sort="direction">${options(
      [
        ['asc', 'Ascending'],
        ['desc', 'Descending'],
      ],
      preferences.sort.direction,
    )}</select>
    <span>${matches.length} rows</span></div>
    <p class="fabric-status" data-sheet-notice role="status"></p><div data-sheet></div>`;
    const actions = results.querySelector('[data-sheet-actions]');
    sheetSelection = null;
    const host = results.querySelector('[data-sheet]');
    const sheetRows = billing
      ? matches
      : matches.map((r) => ({
          ...r,
          worker: workerName(r.worker),
          employee: r.employeeName,
          lineCount: r.lines.length,
        }));
    // Leave space for row headers, the vertical scrollbar and the sheet border.
    const fitted = fitSheetColumns(sheetColumns, sheetRows, host.clientWidth - 56);
    sheetRoot = createRoot(host);
    sheetRoot.render(
      React.createElement(FabricSheet, {
        page: billing ? 'workerBills' : 'productionChallans',
        spec: { title: billing ? 'Worker bills' : 'Challans', columns: fitted },
        records: sheetRows,
        preferences,
        onPreferences: (changes) => {
          if (
            !preferences.layout?.widths &&
            changes.layout?.widths &&
            fitted.every((column, index) => changes.layout.widths[index] === column.width)
          ) {
            const layout = { ...changes.layout };
            delete layout.widths;
            Object.assign(preferences, changes, { layout });
          } else Object.assign(preferences, changes);
        },
        onSelect: (record) => {
          sheetSelection = record?.key;
          for (const control of actions.querySelectorAll('button'))
            control.disabled =
              !record || (control.dataset.action === 'edit-selected' && !permissions.edit);
        },
        onNotice: (message) => {
          results.querySelector('[data-sheet-notice]').textContent = message;
        },
        capabilities: {
          format: permissions.format,
          export: permissions.export,
          print: permissions.print,
        },
      }),
    );
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
    sheetRoot?.unmount();
    sheetRoot = null;
    const billing = view === 'billing';
    const title = billing ? 'Worker bills' : 'Challans';
    root.innerHTML =
      view === 'list' || billing
        ? `${heading(title, `<div class="fabric-view-toggle" aria-label="${title} view">${['overview', 'sheet'].map((mode) => `<button type="button" aria-pressed="${presentation === mode}" data-action="view:${mode}">${mode === 'overview' ? 'Overview' : 'Sheet'}</button>`).join('')}</div>`)}
      <div class="fabric-actions"><input type="search" aria-label="Search ${title.toLowerCase()}" data-search placeholder="Search ${title.toLowerCase()}…" value="${e(search)}">${permissions.create ? (billing ? button('new-bill', '+ New worker bill', true) : button('new', '+ New challan', true)) : ''}</div>
      <p class="form-error" role="alert"></p><div data-results></div>`
        : view === 'form'
          ? `${heading(draft.id ? 'Edit challan' : 'New challan')}
        <form><div class="fabric-fields"><label><span>Job worker</span><select aria-label="Job worker" data-field="worker" required>${options([['', 'Select a job worker'], ...workers], draft.worker)}</select></label>${input('Issue date', 'date', draft.date, 'date')}<label><span>Issuing employee</span><select data-field="employee">${options([['', 'Select employee'], ...employees], draft.employee)}</select></label></div>
        ${draft.lines.map(formLine).join('')}
        ${button('add', 'Add job line')}<p role="alert" class="form-error"></p>
        <div class="editor-actions">${button('cancel', 'Cancel')}<button class="primary" type="submit">Save challan</button></div></form>`
          : detail();
    if (view === 'list' || billing) renderResults();
    if (view === 'detail') {
      const dialog = root.querySelector('[data-challan-detail]');
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        view = 'list';
        render();
      });
      dialog.showModal();
    }
  }
  root.addEventListener('input', ({ target: t }) => {
    if (t.hasAttribute('data-search')) {
      search = t.value;
      renderResults();
      return;
    }
    if (view !== 'form') return;
    const row = t.closest('[data-line]');
    const model = row ? draft.lines[Number(row.dataset.line)] : draft;
    if (t.dataset.field && !['worker', 'assignment'].includes(t.dataset.field))
      model[t.dataset.field] = t.value;
  });
  root.addEventListener('change', ({ target: t }) => {
    if (t.dataset.sort) {
      sheetPreferences().sort[t.dataset.sort] = t.value;
      renderResults();
      root.querySelector(`[data-sort="${t.dataset.sort}"]`)?.focus();
      return;
    }
    if (t.dataset.field === 'worker') {
      if (draft.lines.some((line) => line.job && jobs[line.job][2] !== t.value)) {
        t.value = draft.worker;
        root.querySelector('[role="alert"]').textContent =
          'Remove the selected job lines before changing the job worker.';
        return;
      }
      draft.worker = t.value;
      render();
      root.querySelector('[data-action^="pick-variant:"]')?.focus();
    }
  });
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
        await load(true);
        bill = bills.find((row) => row.key === key);
        if (file.name) {
          try {
            await api.attach(key, file);
          } catch (error) {
            throw Error('Bill saved. Attachment upload failed: ' + error.message, { cause: error });
          }
          await load(true);
        }
        dialog.close();
        render();
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
  root.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    let [cmd, arg] = action.split(':');
    if (busy) return;
    if (cmd === 'delete' || cmd === 'delete-bill') {
      const billing = cmd === 'delete-bill';
      const record = billing ? bills.find((b) => b.key === arg) : selected;
      if (!record || !window.confirm('Delete this ' + (billing ? 'worker bill' : 'challan') + '?'))
        return;
      busy = true;
      try {
        await api.save(billing, 'delete', { key: record.key, revision: record.revision });
        await load(billing);
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
      editBill(cmd === 'new-bill' ? null : bills.find((b) => b.key === (arg || sheetSelection)));
      return;
    }
    if (view === 'billing' && cmd === 'open-selected') {
      cmd = 'bill';
      arg = sheetSelection;
    }
    if (cmd === 'bill') {
      viewBill(bills.find((b) => b.key === arg));
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
    if (cmd === 'view') presentation = arg;
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
        root.querySelector('[role="alert"]').textContent = 'Keep lines referenced by worker bills.';
        return;
      }
      draft.lines.splice(Number(arg), 1);
    }
    render();
    if (cmd === 'add')
      root.querySelector('[data-line]:last-of-type [data-action^="pick-variant:"]')?.focus();
  });
  root.addEventListener('submit', async (event) => {
    if (view !== 'form' || event.target.method === 'dialog') return;
    event.preventDefault();
    if (busy) return;
    const error = root.querySelector('[role="alert"]');
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
      await load(false);
      selected = records.find((record) => record.key === key);
      view = 'detail';
      render();
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  });
  async function navigate() {
    const billing = location.hash === '#worker-bills';
    view = billing ? 'billing' : 'list';
    search = '';
    presentation = 'overview';
    document.getElementById('challans-nav').removeAttribute('aria-current');
    document.getElementById('worker-bills-nav').removeAttribute('aria-current');
    document
      .getElementById(billing ? 'worker-bills-nav' : 'challans-nav')
      .setAttribute('aria-current', 'page');
    document.title = billing ? 'Worker bills' : 'Production Challans';
    sheetRoot?.unmount();
    sheetRoot = null;
    root.innerHTML = '<p role="status">Loading production documents…</p>';
    try {
      if (!(await api.authenticate())) {
        location.replace('/access.html');
        return;
      }
      if (await load(billing)) render();
    } catch (error) {
      root.innerHTML = '<p class="form-error" role="alert"></p>';
      root.querySelector('[role="alert"]').textContent = error.message;
    }
  }
  window.addEventListener('hashchange', navigate);
  let lastSheetWidth = root.clientWidth;
  new ResizeObserver(() => {
    const width = root.clientWidth;
    if (width === lastSheetWidth) return;
    lastSheetWidth = width;
    if (
      presentation === 'sheet' &&
      root.querySelector('[data-sheet]') &&
      !sheetPreferences().layout?.widths
    )
      renderResults();
  }).observe(root);
  const menu = document.querySelector('.navigation-toggle');
  const sidebar = document.getElementById('challan-sidebar');
  menu.addEventListener('click', () => {
    sidebar.hidden = !sidebar.hidden;
    document.querySelector('.fabric-shell').classList.toggle('sidebar-collapsed', sidebar.hidden);
    menu.setAttribute('aria-expanded', String(!sidebar.hidden));
    menu.querySelector('span').textContent = sidebar.hidden ? 'Show menu' : 'Hide menu';
    document
      .getElementById('menu-direction')
      .setAttribute('d', sidebar.hidden ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3');
  });
  navigate();
})();
