import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { versionsForMapping } from './relationships.js';
const h = React.createElement;
export function labRecordRows(data, mappingId, dyerId) {
  return versionsForMapping(data, mappingId, dyerId).map((v) => {
    const lab = data.lab_dip.find((l) => l.id === v.lab_dip_id),
      status = data.lab_dip_version_status.find((s) => s.id === v.lab_dip_status_id),
      swatch = Boolean(v.attached_swatch);
    return {
      id: v.id,
      edition: lab.edition,
      version: v.version,
      date: v.date || null,
      shade: swatch ? null : v.shade_card_no || null,
      option: swatch ? null : v.shade_card_option || null,
      status: status?.status || 'Status not recorded',
    };
  });
}
const columns = [
  ['edition', 'Edition'],
  ['version', 'Version'],
  ['date', 'Date'],
  ['shade', 'Shade card no.'],
  ['option', 'Shade card option'],
  ['status', 'Lab-dip status'],
];
export function LabRecordSelect({ data, mappingId, dyerId, value, onChange, label = 'Lab dip' }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    dialog = useRef(null),
    trigger = useRef(null),
    rows = labRecordRows(data, mappingId, dyerId),
    selected = rows.find((r) => r.id === value);
  useEffect(() => {
    if (open) dialog.current.showModal();
  }, [open]);
  function close() {
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function choose(id) {
    onChange(id);
    close();
  }
  const cells = (row) =>
    columns.map(([key]) =>
      h(
        'td',
        { key },
        key === 'status'
          ? h('span', { className: 'lab-record-status' }, row[key])
          : (row[key] ?? '—'),
      ),
    );
  const filtered = rows.filter((r) =>
    Object.values(r).some((v) =>
      String(v ?? '')
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  return h(
    'section',
    { className: 'lab-record-select' },
    h(
      'div',
      { className: 'lab-record-heading' },
      h('span', null, label),
      h(
        'button',
        {
          ref: trigger,
          type: 'button',
          disabled: !mappingId || !dyerId,
          'aria-haspopup': 'dialog',
          onClick: () => setOpen(true),
        },
        selected ? 'Change record' : 'Select record',
      ),
    ),
    selected
      ? h(
          'div',
          { className: 'lab-record-table-wrap' },
          h(
            'table',
            null,
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                columns.map(([key, title]) => h('th', { key }, title)),
              ),
            ),
            h('tbody', null, h('tr', null, cells(selected))),
          ),
        )
      : h(
          'p',
          { className: 'file-help' },
          !mappingId ? 'Choose a colour mapping first.' : 'Select the matching lab-dip record.',
        ),
    open &&
      createPortal(
        h(
          'dialog',
          {
            ref: dialog,
            className: 'fabric-dialog lab-record-dialog',
            onCancel: (e) => {
              e.preventDefault();
              close();
            },
          },
          h(
            'div',
            { className: 'editor-heading' },
            h('h2', null, 'Select lab dip'),
            h('button', { type: 'button', onClick: close }, 'Close'),
          ),
          h(
            'p',
            { className: 'editor-note' },
            'Records for the selected colour and dyer. Select one row to use it.',
          ),
          h('input', {
            type: 'search',
            autoFocus: true,
            'aria-label': 'Search lab-dip records',
            placeholder: 'Search date, shade card or status…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
          h(
            'div',
            { className: 'lab-record-table-wrap' },
            h(
              'table',
              null,
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  columns.map(([key, title]) => h('th', { key }, title)),
                  h('th', null, ''),
                ),
              ),
              h(
                'tbody',
                null,
                filtered.map((row) =>
                  h(
                    'tr',
                    {
                      key: row.id,
                      'aria-selected': row.id === value,
                      onClick: () => choose(row.id),
                    },
                    cells(row),
                    h(
                      'td',
                      null,
                      h(
                        'button',
                        {
                          type: 'button',
                          'aria-label': `Select record ${row.id}`,
                          onClick: (e) => {
                            e.stopPropagation();
                            choose(row.id);
                          },
                        },
                        row.id === value ? 'Selected' : 'Select',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          !filtered.length &&
            h(
              'p',
              { className: 'empty-state' },
              rows.length
                ? 'No matching records.'
                : 'No lab-dip records for this colour and dyer. Create a lab dip first.',
            ),
        ),
        document.body,
      ),
  );
}
