import { getAccessClient } from '../access/client.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import {
  liveRecordNotice,
  RecordPageActions,
  RecordPageEmpty,
  RecordPageHeading,
  RecordPageStatus,
} from '../fabric/record-page.js';
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
  useLayoutEffect(() => {
    if (visible && screen.view === 'detail') {
      const dialog = editor.current.querySelector('[data-challan-detail]');
      if (dialog && !dialog.open) dialog.showModal();
    }
  }, [visible, screen.view]);
  useLayoutEffect(() => {
    if (screen.focus) editor.current.querySelector(screen.focus)?.focus();
  }, [screen]);
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
      h(RecordPageHeading, {
        eyebrow: 'PRODUCTION / ' + title.toUpperCase(),
        title,
        description: billing
          ? 'Review worker bills and their linked challan lines.'
          : 'Review issued challans and their job-variant lines.',
        view: presentation,
        viewLabel: title + ' view',
        onView: (mode) => controller.current.changeView(mode),
      }),
      h(
        RecordPageActions,
        {
          view: presentation,
          label: 'Search ' + title.toLowerCase(),
          placeholder: 'Search ' + title.toLowerCase() + '…',
          value: screen.search || '',
          onSearch: (value) => controller.current.changeSearch(value),
        },
        permissions.create &&
          h(
            'button',
            { type: 'button', className: 'primary', 'data-action': billing ? 'new-bill' : 'new' },
            billing ? '+ New worker bill' : '+ New challan',
          ),
        sheet &&
          h(
            React.Fragment,
            null,
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
      h(RecordPageStatus, {
        notice: notice || (screen.snapshot ? liveRecordNotice : ''),
        onRefresh: () => controller.current.refresh(),
      }),
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
          screen.matches.length
            ? h(DocumentCards, {
                billing,
                matches: screen.matches,
                workers: screen.snapshot.workers,
              })
            : h(RecordPageEmpty, {
                query: screen.search,
                prompt: permissions.create
                  ? 'Add the first document to get started.'
                  : 'No documents are available.',
              }),
        ),
      screen.snapshot &&
        screen.sheetVisited &&
        h(
          'div',
          { hidden: !sheet },
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
    h('div', { ref: editor }, screen.editor),
  );
}

function DocumentCards({ billing, matches, workers }) {
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
  function publish(focus) {
    update({
      view,
      presentation,
      sheetVisited,
      snapshot,
      matches,
      error,
      search,
      focus,
      editor: view === 'form' ? form() : view === 'detail' ? detail() : null,
    });
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
  const actionButton = (action, label, props = {}) =>
    h('button', { type: 'button', 'data-action': action, ...props }, label);
  const field = (label, control) => h('label', null, h('span', null, label), control);
  const textField = (label, name, value, props) =>
    field(label, h('input', { 'data-field': name, defaultValue: value, ...props }));
  const selectField = (label, name, value, choices, required) =>
    field(
      label,
      h(
        'select',
        { 'aria-label': label, 'data-field': name, defaultValue: value, required },
        choices.map(([id, name]) => h('option', { key: id, value: id }, name)),
      ),
    );
  const cells = (tag, values) =>
    values.map((value, index) =>
      h(tag, { key: index, scope: tag === 'th' ? 'col' : undefined }, value),
    );
  const quantitiesTable = (headers, rows) =>
    h(
      'div',
      { className: 'lab-record-table-wrap' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, cells('th', headers))),
        h(
          'tbody',
          null,
          rows.map((row, index) => h('tr', { key: index }, cells('td', row))),
        ),
      ),
    );
  const lineKeys = new WeakMap();
  let nextLineKey = 0;
  function formLine(l, i) {
    if (!lineKeys.has(l)) lineKeys.set(l, nextLineKey++);
    const job = jobs[l.job];
    return h(
      'section',
      { key: lineKeys.get(l), className: 'fabric-line', 'data-line': i },
      h(
        'div',
        { className: 'line-heading' },
        h('h3', null, 'Job-variant line ' + (i + 1)),
        actionButton('remove:' + i, 'Remove'),
      ),
      h(
        'div',
        { className: 'fabric-fields' },
        field(
          'Job variant',
          actionButton(
            'pick-variant:' + i,
            job
              ? `${l.part} · ${l.variant} (${job[5]})`
              : draft.worker
                ? 'Select job variant'
                : 'Select a job worker first',
            {
              'aria-label': 'Select job variant',
              'aria-haspopup': 'dialog',
              disabled: !draft.worker || l.billed,
            },
          ),
        ),
      ),
      h(
        'div',
        { className: 'fabric-fields' },
        textField('Description', 'description', l.description),
        textField('Challan rate', 'rate', l.rate, { type: 'number', min: 0, step: 'any' }),
      ),
      l.variant &&
        quantitiesTable(job[4], [job[4].map((size) => l.cells[l.variant]?.[size] || '—')]),
      l.variant && h('p', null, 'Issued quantities use the full recorded stock-in by size.'),
    );
  }
  function form() {
    return h(
      React.Fragment,
      null,
      h(RecordPageHeading, {
        eyebrow: 'PRODUCTION / CHALLANS',
        title: draft.id ? 'Edit challan' : 'New challan',
      }),
      h(
        'form',
        null,
        h(
          'div',
          { className: 'fabric-fields' },
          selectField(
            'Job worker',
            'worker',
            draft.worker,
            [['', 'Select a job worker'], ...workers],
            true,
          ),
          textField('Issue date', 'date', draft.date, { type: 'date' }),
          selectField('Issuing employee', 'employee', draft.employee, [
            ['', 'Select employee'],
            ...employees,
          ]),
        ),
        draft.lines.map(formLine),
        actionButton('add', 'Add job line'),
        h('p', { role: 'alert', className: 'form-error' }),
        h(
          'div',
          { className: 'editor-actions' },
          actionButton('cancel', 'Cancel'),
          h('button', { className: 'primary', type: 'submit' }, 'Save challan'),
        ),
      ),
    );
  }
  const fields = (entries) =>
    h(
      'dl',
      { className: 'lab-submission-fields' },
      entries.map(([label, value]) =>
        h('div', { key: label }, h('dt', null, label), h('dd', null, value)),
      ),
    );
  function detailLine(l) {
    const job = jobs[l.job];
    return h(
      'section',
      { key: l.id, className: 'lab-detail' },
      h(
        'div',
        { className: 'editor-heading' },
        h('h3', null, l.part + ' · ' + l.variant),
        actionButton('job:' + l.job, job[5]),
        h('span', { className: 'print-only' }, job[5]),
      ),
      h('p', null, job[1] + ' · ' + workerName(job[2])),
      fields([
        ['Description', l.description || '—'],
        ['Challan rate', (l.rate ?? '') === '' ? '—' : l.rate],
      ]),
      quantitiesTable(
        ['Size', 'Issued pieces'],
        job[4]
          .filter((size) => size in l.cells[l.variant])
          .map((size) => [size, l.cells[l.variant][size]]),
      ),
    );
  }
  function detail() {
    return h(
      'dialog',
      {
        className: 'fabric-dialog lab-progress-dialog',
        'data-challan-detail': '',
        'aria-labelledby': 'challan-detail-title',
        onCancel: (event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          view = 'list';
          publish();
        },
      },
      h(
        'div',
        { className: 'editor-heading' },
        h(
          'div',
          null,
          h('small', null, 'PRODUCTION / CHALLANS'),
          h('h2', { id: 'challan-detail-title' }, selected.id),
        ),
        actionButton('list', 'Close'),
      ),
      h(
        'div',
        { className: 'lab-expanded' },
        fields([
          ['Job worker', workerName(selected.worker)],
          ['Issue date', selected.date || '—'],
          ['Issued by', selected.employeeName || '—'],
        ]),
        h('h2', null, 'Job lines'),
        selected.lines.map(detailLine),
        h(
          'div',
          { className: 'editor-actions' },
          permissions.print && actionButton('print', 'Print challan'),
          permissions.edit && actionButton('edit', 'Edit challan', { className: 'primary' }),
          permissions.delete &&
            !selected.lines.some((line) => line.billed) &&
            actionButton('delete', 'Delete challan'),
        ),
      ),
    );
  }
  root.addEventListener(
    'input',
    ({ target: t }) => {
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
        editor.querySelector('[role="alert"]').textContent = '';
        draft.worker = t.value;
        publish('[data-action^="pick-variant:"]');
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
      publish(`[data-action="pick-variant:${index}"]`);
    });
    refresh();
    search.focus();
  }
  function reviewSave(form, title, rows, save) {
    const section = document.createElement('section');
    section.className = 'fabric-line';
    section.setAttribute('aria-label', title);
    section.innerHTML = `<h3 tabindex="-1">${e(title)}</h3><dl class="fabric-fields">${rows
      .map(
        ([label, value]) =>
          `<div><dt>${e(label)}</dt><dd style="overflow-wrap:anywhere">${e(value === '' ? '—' : (value ?? '—'))}</dd></div>`,
      )
      .join('')}</dl><p class="form-error" role="alert"></p>
      <div class="editor-actions"><button type="button">Back to edit</button><button type="button" class="primary">Confirm save</button></div>`;
    const [back, confirm] = section.querySelectorAll('button');
    const restore = () => {
      section.remove();
      form.hidden = false;
      form.querySelector('button.primary')?.focus();
    };
    back.addEventListener('click', restore);
    confirm.addEventListener('click', async () => {
      if (busy) return;
      busy = back.disabled = confirm.disabled = true;
      section.querySelector('[role="alert"]').textContent = '';
      try {
        await save(restore);
      } catch (failure) {
        section.querySelector('[role="alert"]').textContent = failure.message;
      } finally {
        busy = back.disabled = confirm.disabled = false;
      }
    });
    form.hidden = true;
    form.after(section);
    section.querySelector('h3').focus();
  }
  const changed = (before, after, editing) =>
    editing && String(before ?? '') !== String(after ?? '')
      ? (before || '—') + ' → ' + (after || '—')
      : after;
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
  function editBill(bill) {
    const items = (bill?.items || []).map((item) => ({ ...item }));
    const dialog = showDialog(`${dialogHeader(bill ? 'Edit worker bill' : 'New worker bill')}
      <form data-bill-form><div class="fabric-fields">
      <label><span>Job worker</span><select name="worker" required>${options([['', 'Select job worker'], ...workers], items.length ? billItem(items[0]).worker : '')}</select></label>
      <label><span>Invoice number</span><input name="invoiceNumber" value="${e(bill?.invoiceNumber)}"></label>
      <label><span>Bill date</span><input type="date" name="date" value="${e(bill?.date)}"></label>
      <label><span>Bill attachment</span><input type="file" name="attachment" ${permissions.edit ? '' : 'disabled'}></label>
      ${bill?.attachment ? `<div class="fabric-actions"><span>Current attachment · ${e(bill.attachment.name)}</span>${button('attachment', 'View bill attachment')}<label><input type="checkbox" name="removeAttachment" ${permissions.edit ? '' : 'disabled'}> Remove attachment</label></div>` : ''}
      </div><h3>Bill items</h3><div data-bill-items></div>
      <button type="button" data-add-bill-item>+ Select challan item</button>
      <p data-bill-error class="form-error" role="alert" hidden></p>
      <div class="editor-actions"><button class="primary">Review worker bill</button></div></form>`);
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
    bindBillAttachment(dialog, bill);
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
      if (event.target.hidden) return;
      const payload = {
        key: bill?.key,
        revision: bill?.revision,
        lines: structuredClone(items),
        invoiceNumber: data.get('invoiceNumber'),
        date: data.get('date') || null,
        removeAttachment: !file.name && data.has('removeAttachment'),
      };
      const reviewRows = [
        ['Job worker', workerName(worker.value)],
        ['Invoice number', changed(bill?.invoiceNumber, payload.invoiceNumber, bill)],
        ['Bill date', changed(bill?.date, payload.date, bill)],
        [
          'Attachment',
          file.name
            ? (bill?.attachment ? 'Replace with ' : 'Upload ') +
              file.name +
              ' (' +
              file.size +
              ' bytes)'
            : payload.removeAttachment
              ? 'Remove ' + bill?.attachment?.name
              : bill?.attachment?.name,
        ],
        ...payload.lines.flatMap((item) => {
          const info = billItem(item);
          const before = bill?.items.find(
            (row) => row.line === item.line && row.challan === item.challan,
          );
          return [
            ['Challan / item', [info.number, info.style, info.part, info.variant].join(' · ')],
            ['Issued quantities', info.quantities],
            ['Description', info.description],
            ['Billed rate', changed(before?.rate, item.rate, before)],
          ];
        }),
        ...(bill?.items ?? [])
          .filter(
            (item) =>
              !payload.lines.some((row) => row.line === item.line && row.challan === item.challan),
          )
          .map((item) => [
            'Remove item',
            [billItem(item).number, billItem(item).variant].join(' · '),
          ]),
      ];
      const uploadRequest = file.name ? crypto.randomUUID() : null;
      const previousAttachmentId = bill?.attachment?.id ?? null;
      let savedKey;
      let attachmentSaved = false;
      reviewSave(event.target, 'Review worker bill', reviewRows, async () => {
        savedKey ??= await api.save(true, payload.key ? 'edit' : 'create', payload);
        if (file.name && !attachmentSaved) {
          try {
            await api.attach(savedKey, file, uploadRequest, previousAttachmentId);
            attachmentSaved = true;
          } catch (failure) {
            await load();
            bill = bills.find((row) => row.key === savedKey) ?? bill;
            throw Error('Bill saved. Attachment upload failed: ' + failure.message);
          }
        }
        await load();
        dialog.close();
        invalidateDocuments();
      });
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
  function bindBillAttachment(dialog, bill) {
    dialog.querySelector('[data-action="attachment"]')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const tab = window.open('about:blank', '_blank');
      if (!tab) {
        window.alert('Allow pop-ups to view the private file.');
        return;
      }
      tab.opener = null;
      try {
        const file = await api.openAttachment(bill.key, bill.attachment);
        tab.location.replace(file.url);
      } catch (error) {
        tab.close();
        window.alert(error.message);
      }
    });
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
    bindBillAttachment(dialog, bill);
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
          publish();
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
      if (cmd === 'add' || cmd === 'remove') editor.querySelector('[role=alert]').textContent = '';
      if (cmd === 'add') draft.lines.push(line());
      if (cmd === 'remove') {
        if (draft.lines[Number(arg)].billed) {
          editor.querySelector('[role="alert"]').textContent =
            'Keep lines referenced by worker bills.';
          return;
        }
        draft.lines.splice(Number(arg), 1);
      }
      publish(
        cmd === 'add' ? '[data-line]:last-of-type [data-action^="pick-variant:"]' : undefined,
      );
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
        publish();
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
    refresh: load,
    changeView(mode) {
      presentation = mode;
      sheetVisited ||= mode === 'sheet';
      clearTimeout(sheetSearchTimer);
      sheetSearchTimer = null;
      renderResults();
    },
    changeSearch(value) {
      search = value;
      clearTimeout(sheetSearchTimer);
      select(null);
      if (presentation === 'sheet') {
        sheetSearchTimer = setTimeout(() => {
          sheetSearchTimer = null;
          renderResults();
        }, worksheetSearchDelay);
        publish();
      } else {
        sheetSearchTimer = null;
        renderResults();
      }
    },
    setVisible(next) {
      visible = next;
      if (next) {
        if (Date.now() >= freshUntil) void load();
        return;
      }
      for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
      if (view === 'detail') {
        view = 'list';
        publish();
      }
    },
    dispose() {
      listeners.abort();
      clearTimeout(sheetSearchTimer);
    },
  };
}
