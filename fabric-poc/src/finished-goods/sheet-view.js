import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { WorksheetToolbar } from '../fabric/grid-toolbar.js';

export function FinishedGoodsEditor({
  label,
  title,
  children,
  record = false,
  disabled = false,
  defer = false,
  onDismiss,
}) {
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (onDismiss && !dialog.current.open) dialog.current.showModal();
  }, [onDismiss]);
  return h(
    'div',
    { className: record ? undefined : 'fabric-actions fg-create-actions' },
    !onDismiss &&
      h(
        'button',
        {
          type: 'button',
          className: defer ? undefined : record ? 'open-document' : 'primary',
          disabled,
          onClick: () => {
            if (defer) setOpen(true);
            dialog.current.showModal();
          },
        },
        label,
      ),
    h(
      'dialog',
      {
        ref: dialog,
        className: 'fabric-dialog',
        'aria-label': title,
        onClose: onDismiss ?? (defer ? () => setOpen(false) : undefined),
      },
      h(
        'div',
        { className: 'editor-heading' },
        h('h2', null, title),
        h('button', { type: 'button', onClick: () => dialog.current.close() }, 'Close'),
      ),
      (!defer || open) && children(() => dialog.current.close()),
    ),
  );
}

export function FinishedGoodsSheetView({
  page,
  title,
  columns,
  rows,
  capabilities,
  view,
  children,
  client,
  paged,
  search,
  add,
  source,
  searchPending,
}) {
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    if (view !== 'sheet') setSelection(null);
  }, [view]);
  const spec = useMemo(
    () => ({
      title,
      columns: columns.map(([key, label]) => ({
        key,
        label,
        numeric: rows.some((row) => typeof row[key] === 'number'),
      })),
    }),
    [columns, rows, title],
  );
  const records = useMemo(
    () =>
      rows.map((row) => ({
        ...Object.fromEntries(columns.map(([key]) => [key, row[key] ?? ''])),
        id: row.id ?? row.size_id ?? row.item_id,
        source: row,
      })),
    [columns, rows],
  );
  const selected = !searchPending && records.includes(selection) ? selection.source : null;
  const action = selected && source?.resolve(selected);

  return h(
    'div',
    null,
    view === 'sheet' && notice && h('p', { role: 'status' }, notice),
    view === 'overview'
      ? children
      : h(
          'div',
          null,
          h(
            WorksheetToolbar,
            {
              ...search,
              onChange: (value) => {
                setSelection(null);
                search.onChange(value);
              },
            },
            add,
            source &&
              h(
                FinishedGoodsEditor,
                {
                  record: true,
                  label: source.label,
                  title: source.title,
                  disabled: !action,
                  defer: true,
                },
                () => action,
              ),
          ),
          h(FabricSheet, {
            page: 'finished-goods-' + page,
            spec,
            records,
            client,
            paged,
            capabilities,
            onSelect: (record) => setSelection(searchPending ? null : record),
            onNotice: setNotice,
          }),
        ),
  );
}
