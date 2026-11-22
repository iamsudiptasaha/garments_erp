import { receiptQuantity, transferableHeads } from './transferable-records.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { OverviewTable } from '../fabric/overview-table.js';
import { FabricSheet } from '../fabric/sheet.js';
import { RecordPageHeading, RecordPageActions, RecordPageStatus } from '../fabric/record-page.js';
import { useGridSearch } from '../fabric/grid-toolbar.js';
import { useSaveReview, ReviewForm } from '../fabric/save-review.js';
import { RecordSelect } from '../fabric/record-select.js';
const h = React.createElement;
const columns = [
  ['sku', 'Receipt SKU'],
  ['material', 'Material'],
  ['status', 'Current status'],
  ['worker', 'Current worker'],
  ['item', 'Garment item'],
  ['quantity', 'Receipt quantity'],
  ['unit', 'Unit'],
  ['lastMovement', 'Last movement'],
];
const spec = {
  title: 'Transferable Materials',
  readonly: true,
  columns: columns.map(([key, label]) => ({ key, label })),
};
export function TransferableMaterials({ data, actor, can, client, onMovement, onRefresh }) {
  const [view, setView] = useState('overview'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(null),
    [open, setOpen] = useState(null),
    [notice, setNotice] = useState(
      client
        ? 'Live Supabase records · saved changes are shared'
        : 'Connect to Supabase to record transferable movements.',
    );
  const search = useGridSearch(query);
  const heads = useMemo(() => transferableHeads(data), [data]);
  const rows = useMemo(
    () =>
      heads.map((r) => ({
        ...r,
        documentId: r.id,
        worker: r.worker || '—',
        item: r.item || '—',
        lastMovement: r.movement_at
          ? new Date(r.movement_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          : 'No movements',
      })),
    [heads],
  );
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(search.toLowerCase())),
      ),
    [rows, search],
  );
  useEffect(() => setSelected(null), [search, view, rows]);
  const valid = selected && filtered.some((r) => r.id === selected.id) && query === search;
  return h(
    React.Fragment,
    null,
    h(RecordPageHeading, {
      eyebrow: 'RAW MATERIAL INVENTORY / TRANSFERABLE MATERIALS',
      title: spec.title,
      description: 'Receipt-level custody and complete movement history',
      view,
      action: null,
      onView: (v) => {
        setView(v);
        setQuery('');
        setSelected(null);
      },
    }),
    h(RecordPageStatus, { notice, onRefresh }),
    view === 'overview'
      ? h(OverviewTable, {
          key: actor + ':transferableMaterials',
          client,
          grid: 'overview-transferableMaterials',
          title: spec.title,
          records: rows,
          columns: columns.map(([accessorKey, header]) => ({
            accessorKey,
            header,
            ...(accessorKey === 'status'
              ? {
                  cell: ({ getValue }) =>
                    h('span', { className: 'erp-overview-status' }, getValue()),
                }
              : {}),
          })),
          onOpen: (id) => setOpen(id),
        })
      : h(
          React.Fragment,
          null,
          h(
            RecordPageActions,
            {
              view,
              label: 'Search Transferable Materials',
              placeholder: 'Search transferable materials…',
              value: query,
              onSearch: setQuery,
            },
            h(
              'button',
              { disabled: !valid, onClick: () => setOpen(selected.id) },
              'Open selected record',
            ),
          ),
          h(FabricSheet, {
            key: actor + ':transferableMaterials',
            client,
            page: 'transferableMaterials',
            spec,
            records: filtered,
            preferences: {},
            onSelect: setSelected,
            onNotice: setNotice,
            capabilities: { format: can('format'), export: can('export'), print: can('print') },
          }),
        ),
    open &&
      heads.some((r) => r.id === open) &&
      h(HeadDialog, {
        key: open,
        head: heads.find((r) => r.id === open),
        data,
        canCreate: !!onMovement && can('create'),
        onClose: () => setOpen(null),
        onSave: async (payload) => {
          await onMovement(payload);
          setNotice('Movement saved to Supabase. Receipt identity and quantity preserved.');
        },
      }),
  );
}
function HeadDialog({ head, data, canCreate, onClose, onSave }) {
  const dialog = useRef(null),
    review = useSaveReview();
  const [action, setAction] = useState(''),
    [worker, setWorker] = useState(''),
    [item, setItem] = useState(''),
    [employee, setEmployee] = useState(''),
    [remarks, setRemarks] = useState(''),
    [error, setError] = useState('');
  const workers = data.transferable_workers || [],
    items = data.transferable_items || [],
    employees = data.employee || [];
  const nameOf = (rows, id) => rows.find((r) => r.id === id)?.name || '—';
  const latest = () => head;
  const status = () => head.status;
  const ordered = () => head.events;
  useEffect(() => dialog.current.showModal(), []);
  function prepare() {
    setError('');
    if (!employee) {
      setError('Choose the employee recording this movement.');
      return;
    }
    if (action === 'Transfer' && (!worker || !item)) {
      setError('Choose a job worker and garment item.');
      return;
    }
    const type = data.transferable_item_movement_type.find((r) => r.type === action);
    const reviewed = {
      p_receipt_id: head.id,
      p_expected_movement_id: head.last_movement_id,
      p_receipt_updated_at: head.updated_at,
      p_type_id: type.id,
      p_job_worker_id: action === 'Transfer' ? worker : null,
      p_item_id: action === 'Transfer' ? item : null,
      p_employee_id: employee || null,
      p_remarks: remarks,
    };
    review.prepare(
      reviewed,
      [
        ['Receipt', head.sku],
        ['Material', head.material],
        ['Receipt quantity', receiptQuantity(head)],
        ['Current status', status(head)],
        ['Movement', action],
        [
          'Job worker',
          action === 'Transfer'
            ? nameOf(workers, worker)
            : action === 'Return'
              ? nameOf(workers, latest(head)?.job_worker_id)
              : '—',
        ],
        [
          'Garment item',
          action === 'Transfer'
            ? nameOf(items, item)
            : action === 'Return'
              ? nameOf(items, latest(head)?.item_id)
              : '—',
        ],
        ['Recorded by', nameOf(employees, employee)],
        ['Remarks', remarks],
      ],
      async (p) => {
        await onSave(p);
        setAction('');
        setRemarks('');
      },
      'Review ' + action.toLowerCase(),
    );
  }
  const actions = head.allowed_actions || [];
  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog',
      onCancel: (e) => {
        if (review.busy) e.preventDefault();
        else onClose();
      },
      'aria-labelledby': 'transferable-receipt-' + head.id,
    },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('h2', { id: 'transferable-receipt-' + head.id }, head.material),
        h(
          'div',
          { className: 'lab-path' },
          h('strong', null, head.sku),
          h('span', null, receiptQuantity(head)),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: onClose,
          'aria-label': 'Close receipt',
          autoFocus: true,
          disabled: review.busy,
        },
        'Close',
      ),
    ),
    h(
      'section',
      { 'aria-label': 'Current custody', className: 'fabric-line' },
      h(
        'div',
        { className: 'lab-path' },
        h(
          'span',
          {
            className:
              'lab-status' +
              (status(head) === 'Discarded'
                ? ' failed'
                : status(head) === 'In Stock'
                  ? ' accepted'
                  : ''),
          },
          status(head),
        ),
        !action &&
          actions.map((type) =>
            h(
              'button',
              {
                key: type,
                className: type === actions[0] ? 'primary' : undefined,
                disabled: !canCreate,
                onClick: () => setAction(type),
              },
              type,
            ),
          ),
      ),
      status(head) === 'Transferred' &&
        h(
          'div',
          { className: 'lab-version-row' },
          h(
            'span',
            null,
            h('strong', null, 'Worker: '),
            nameOf(workers, latest(head)?.job_worker_id),
          ),
          h(
            'span',
            null,
            h('strong', null, 'Garment item: '),
            nameOf(items, latest(head)?.item_id),
          ),
          h(
            'span',
            null,
            h('strong', null, 'Transferred: '),
            new Date(head.movement_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          ),
        ),
      !canCreate &&
        h(
          'p',
          { className: 'editor-note' },
          'View access only. Movement create permission is required.',
        ),
    ),
    error && h('p', { className: 'form-error', role: 'alert' }, error),
    action &&
      h(
        ReviewForm,
        { review, onSubmit: prepare },
        h('h3', null, action),
        h(
          'div',
          { className: 'fabric-fields' },
          action === 'Transfer' &&
            h(RecordSelect, {
              label: 'Job worker',
              value: worker,
              options: workers.map((r) => ({ value: r.id, label: r.name })),
              onChange: setWorker,
            }),
          action === 'Transfer' &&
            h(RecordSelect, {
              label: 'Garment item',
              value: item,
              options: items.map((r) => ({ value: r.id, label: r.name })),
              onChange: setItem,
            }),
          h(RecordSelect, {
            label: 'Recorded by employee',
            required: true,
            value: employee,
            options: employees.map((r) => ({ value: r.id, label: r.name })),
            onChange: setEmployee,
          }),
          h(
            'label',
            null,
            h('span', null, ['Discard', 'Restore'].includes(action) ? 'Reason' : 'Remarks'),
            h('input', {
              value: remarks,
              required: ['Discard', 'Restore'].includes(action),
              onChange: (e) => setRemarks(e.target.value),
            }),
          ),
        ),
        h(
          'div',
          { className: 'editor-actions' },
          h('button', { type: 'button', onClick: () => setAction('') }, 'Cancel movement'),
          h('button', { className: 'primary', type: 'submit' }, 'Review'),
        ),
      ),
    h('h3', null, 'Movement history'),
    h(
      'p',
      { className: 'editor-note' },
      'Chronological · Asia/Kolkata · immutable receipt history',
    ),
    head.events.length
      ? h(
          'div',
          { className: 'lab-record-table-wrap' },
          h(
            'table',
            { className: 'lab-record-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['Date / time', 'Movement', 'Worker', 'Garment item', 'Employee', 'Remarks'].map(
                  (x) => h('th', { key: x }, x),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              ordered(head).map((e) =>
                h(
                  'tr',
                  { key: e.id },
                  h(
                    'td',
                    null,
                    new Date(e.movement_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                  ),
                  h('td', null, e.type),
                  h('td', null, e.worker || '—'),
                  h('td', null, e.item || '—'),
                  h('td', null, e.employee || '—'),
                  h('td', null, e.remarks || '—'),
                ),
              ),
            ),
          ),
        )
      : h('p', null, 'No movements yet.'),
    h(
      'p',
      { className: 'editor-note' },
      status(head) === 'Transferred'
        ? 'Return before transferring to another worker or discarding.'
        : status(head) === 'Discarded'
          ? 'Restore before another transfer.'
          : 'Transfer or discard this receipt.',
    ),
  );
}
