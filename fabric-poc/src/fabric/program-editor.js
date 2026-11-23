import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { getAccessClient } from '../access/client.js';
import { RichComment, RichCommentEditor } from './rich-comment.js';
import { LabRecordSelect } from './lab-record-select.js';
import { RecordSelect } from './record-select.js';
import { OverviewTable, matchesOverviewRules } from './overview-table.js';
import { FabricSheet } from './sheet.js';
import { RecordPageHeading, RecordPageActions } from './record-page.js';
import { useGridSearch } from './grid-toolbar.js';
import { batchesForVersion, previousBatchLabel, versionLabel } from './relationships.js';
import { plannerRequirements } from './planner-model.js';
import {
  programDraft,
  addPlannerRequirements,
  reconcileProgramLinks,
  saveProgram,
} from './program-model.js';

const kg = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
const button = (label, onClick, extra = {}) =>
  h('button', { type: 'button', onClick, ...extra }, label);
function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return h(
    'dialog',
    {
      ref,
      className: 'fabric-dialog',
      'aria-label': title,
      onCancel: (e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      },
    },
    h('h2', null, title),
    children,
    h('div', { className: 'editor-actions' }, button('Close', onClose)),
  );
}
function Table({ columns, children }) {
  return h(
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
          columns.map((c) => h('th', { key: c, scope: 'col' }, c)),
        ),
      ),
      h('tbody', null, children),
    ),
  );
}
function Input({ label, value, onChange, ...props }) {
  return h(
    'label',
    null,
    h('span', null, label),
    h('input', { ...props, 'aria-label': label, value, onChange: (e) => onChange(e.target.value) }),
  );
}

function ProgramOverviewRows({ table, onOpen, preferences, onRules }) {
  const rules = preferences.filters || [];
  const signature = JSON.stringify(rules);
  useEffect(() => onRules(rules), [signature]);
  const columns = table.getVisibleLeafColumns();
  const total = (records, label, key) =>
    h(
      'tr',
      { key, className: 'planner-total' },
      columns.map((c, index) =>
        h(
          'td',
          { key: c.id },
          c.id.startsWith('fabric-')
            ? kg(records.reduce((n, r) => n + Number(r[c.id] || 0), 0))
            : index === 0
              ? label
              : '',
        ),
      ),
    );
  const render = (row) =>
    row.getIsGrouped()
      ? h(
          Fragment,
          { key: row.id },
          h(
            'tr',
            { className: 'overview-group' },
            h(
              'th',
              { colSpan: columns.length },
              button(
                (row.getIsExpanded() ? '▾ ' : '▸ ') +
                  (row.groupingColumnId === 'colour'
                    ? row.original.colour
                    : String(row.groupingValue)),
                row.getToggleExpandedHandler(),
                { 'aria-expanded': row.getIsExpanded() },
              ),
            ),
          ),
          row.getIsExpanded() && row.subRows.map(render),
          total(
            row.getLeafRows().map((r) => r.original),
            'Edition subtotal',
            row.id + '-subtotal',
          ),
        )
      : h(
          'tr',
          { key: row.id },
          columns.map((c, index) =>
            h(
              'td',
              { key: c.id },
              index === 0
                ? button(String(row.original[c.id] ?? '—'), onOpen)
                : c.id.startsWith('fabric-')
                  ? row.original[c.id] == null
                    ? ''
                    : kg(row.original[c.id])
                  : row.original[c.id] || '',
            ),
          ),
        );
  return h(
    'tbody',
    null,
    table.getSortedRowModel().rows.map(render),
    total(
      table
        .getFilteredRowModel()
        .flatRows.filter((r) => !r.getIsGrouped())
        .map((r) => r.original),
      'Grand total',
      'grand',
    ),
  );
}

export function ProgramEditor({
  data,
  id,
  onSave,
  onClose,
  can = () => true,
  client: suppliedClient,
}) {
  const errorSummary = useRef(null);
  const reviewTitle = useRef(null);
  const dialog = useRef(null),
    saving = useRef(false);
  const [draft, setDraft] = useState(() => programDraft(data, id));
  const [view, setView] = useState('overview'),
    [query, setQuery] = useState(''),
    [notice, setNotice] = useState('');
  const [rules, setRules] = useState([]);
  const [snapshot, setSnapshot] = useState(null),
    [modal, setModal] = useState(null),
    [pending, setPending] = useState(null),
    [review, setReview] = useState(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(null);
  const [colour, setColour] = useState(''),
    [edition, setEdition] = useState(''),
    [version, setVersion] = useState(''),
    [picked, setPicked] = useState([]),
    [linkItem, setLinkItem] = useState(null);
  const [manualFabric, setManualFabric] = useState(''),
    [manualQuantity, setManualQuantity] = useState('');
  useEffect(() => {
    if (review) reviewTitle.current?.focus();
  }, [review]);
  const search = useGridSearch(query).toLowerCase();
  useEffect(() => {
    if (notice) errorSummary.current?.focus();
  }, [notice]);
  const client = suppliedClient ?? (data._live ? getAccessClient() : null);
  const canPlanner = can('view', 'productionItems') && can('view', 'programs');
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    if (client && canPlanner)
      client
        .rpc('erp_fabric_planner_snapshot')
        .then(({ data: result, error }) => {
          if (active) {
            if (error) setNotice(error.message);
            else setSnapshot(result);
          }
        })
        .catch((e) => {
          if (active) setNotice(e.message);
        });
    return () => {
      active = false;
    };
  }, [client, canPlanner]);
  const requirements = useMemo(() => (snapshot ? plannerRequirements(snapshot) : []), [snapshot]);
  const rawRequirements = snapshot?.requirements || [];
  const labelColour = (labId) => {
    const lab = data.lab_dip.find((l) => l.id === labId),
      mapping = data.color_map_by_brand.find((m) => m.id === lab?.color_map_by_brand_id);
    return (
      data.color_map.find((c) => c.id === mapping?.color_map_id)?.name || 'Colour not selected'
    );
  };
  const groupLabel = (g) =>
    `${labelColour(g.lab_dip_id)} · Edition ${data.lab_dip.find((l) => l.id === g.lab_dip_id)?.edition || '—'}`;
  const fabricName = (id) =>
    data.fabric_type.find((f) => f.id === id)?.name || 'Fabric not selected';
  function attempt(action) {
    try {
      action();
      setNotice('');
    } catch (e) {
      setNotice(e.message);
    }
  }
  function changeGroup(group, patch) {
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.id === group.id ? { ...g, ...patch } : g)),
    }));
  }
  function changeItem(item, patch) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
    }));
  }
  function removeItem(item) {
    setDraft((d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== item.id),
      links: d.links.filter((l) => l.dyeing_program_item_id !== item.id),
    }));
  }
  function openPlanner(item = null) {
    setLinkItem(item);
    setPicked(
      item
        ? draft.links
            .filter((l) => l.dyeing_program_item_id === item.id)
            .map((l) => l.item_part_fabric_id)
        : [],
    );
    const group = draft.groups.find((g) => g.id === item?.dyeing_program_lab_dip_id),
      lab = data.lab_dip.find((l) => l.id === group?.lab_dip_id);
    setColour(lab?.color_map_by_brand_id || '');
    setEdition(group?.lab_dip_id || '');
    setVersion(group?.lab_dip_version_id || '');
    setModal('planner');
  }
  const matrix = useMemo(() => {
    const rows = draft.items
      .map((i) => {
        const g = draft.groups.find((g) => g.id === i.dyeing_program_lab_dip_id);
        return {
          id: i.id,
          groupId: g?.id,
          edition: g?.lab_dip_id,
          fabricKey: 'fabric-' + i.fabric_type_id,
          colour: g ? groupLabel(g) : 'Choose edition',
          lab: versionLabel(data, g?.lab_dip_version_id),
          [`fabric-${i.fabric_type_id}`]: Number(i.quantity || 0),
          source: draft.links.some((l) => l.dyeing_program_item_id === i.id)
            ? 'Planner linked'
            : 'Manual',
          batch: previousBatchLabel(data, g?.batch_no),
        };
      })
      .filter((r) => matchesOverviewRules(r, rules))
      .filter(
        (r) => !search || Object.values(r).some((v) => String(v).toLowerCase().includes(search)),
      );
    const fabrics = data.fabric_type.filter((f) =>
      rows.some((r) => Object.hasOwn(r, 'fabric-' + f.id)),
    );
    const total = (rs, key) => rs.reduce((n, r) => n + Number(r[key] || 0), 0);
    const totals = (rs, label, key) => ({
      id: key,
      colour: label,
      summary: 'subtotal',
      edition: rs[0]?.edition,
      ...Object.fromEntries(fabrics.map((f) => ['fabric-' + f.id, total(rs, 'fabric-' + f.id)])),
    });
    const sheet = [...new Set(rows.map((r) => r.groupId))].flatMap((key) => {
      const rs = rows.filter((r) => r.groupId === key);
      return [...rs, totals(rs, rs[0].colour + ' subtotal', 'subtotal-' + key)];
    });
    sheet.push({ ...totals(rows, 'Grand total', 'grand'), summary: 'grand' });
    return {
      rows,
      sheet: sheet.map((row) => ({
        lab: '',
        source: '',
        batch: '',
        ...Object.fromEntries(fabrics.map((f) => ['fabric-' + f.id, ''])),
        ...row,
      })),
      columns: [
        { key: 'colour', label: 'Colour / Edition' },
        { key: 'lab', label: 'Selected version' },
        ...fabrics.map((f) => ({ key: 'fabric-' + f.id, label: f.name + ' · kg', numeric: true })),
        { key: 'source', label: 'Source' },
        { key: 'batch', label: 'Batch No.' },
      ],
    };
  }, [draft, search, data, rules]);
  const sheetSpec = useMemo(
    () => ({
      title: 'Dyeing Program',
      columns: matrix.columns,
      grouping: { key: 'edition', summaryKey: 'summary' },
    }),
    [matrix.columns],
  );
  const selectedItem = draft.items.find((i) => i.id === selected?.id);
  function prepareSave(e) {
    e.preventDefault();
    attempt(() => {
      const after = saveProgram(data, draft);
      setReview({ after, draft: structuredClone(draft) });
    });
  }
  async function confirm() {
    if (saving.current || !review) return;
    saving.current = true;
    setBusy(true);
    try {
      await onSave(review.after);
      onClose();
    } catch (e) {
      setNotice(e.message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const matching = requirements.filter(
    (r) =>
      r.labId === edition &&
      (!linkItem || r.requirement.fabric_type_id === linkItem.fabric_type_id),
  );
  const labs = data.lab_dip.filter(
    (l) => l.dyer_id === draft.header.dyer_id && (!colour || l.color_map_by_brand_id === colour),
  );
  const currentGroup = draft.groups.find((g) => g.lab_dip_id === edition);
  function plannerReview() {
    attempt(() => {
      const next = linkItem
        ? reconcileProgramLinks(draft, linkItem.id, picked, rawRequirements)
        : addPlannerRequirements(draft, edition, version, picked, rawRequirements);
      setPending(next);
      setModal('links-review');
    });
  }
  const summary = (next, previous = draft) =>
    next.groups.map((g) =>
      h(
        'section',
        { key: g.id, className: 'fabric-line' },
        h('h3', null, groupLabel(g)),
        h(
          'p',
          null,
          versionLabel(data, g.lab_dip_version_id),
          ' · Batch No. ',
          previousBatchLabel(data, g.batch_no),
        ),
        h(
          Table,
          {
            columns: [
              'Fabric Type',
              'Planner requirement',
              'Change',
              'Required kg',
              'Ordered kg',
              'Comments',
            ],
          },
          next.items
            .filter((i) => i.dyeing_program_lab_dip_id === g.id)
            .map((item) => {
              const links = next.links.filter((l) => l.dyeing_program_item_id === item.id),
                old = previous.links.filter((l) => l.dyeing_program_item_id === item.id),
                ids = [...new Set([...links, ...old].map((l) => l.item_part_fabric_id))];
              const before = previous.items.find((i) => i.id === item.id)?.quantity;
              return h(
                Fragment,
                { key: item.id },
                h(
                  'tr',
                  null,
                  h('th', { scope: 'row' }, fabricName(item.fabric_type_id)),
                  h('td', null, ids.length ? `${links.length} linked` : 'Manual'),
                  h('td'),
                  h('td'),
                  h(
                    'td',
                    null,
                    before != null && Number(before) !== Number(item.quantity)
                      ? `${kg(before)} → ${kg(item.quantity)}`
                      : kg(item.quantity),
                  ),
                  h('td', null, h(RichComment, { value: item.comments })),
                ),
                ids.map((rid) => {
                  const r = requirements.find((r) => r.id === rid),
                    was = old.some((l) => l.item_part_fabric_id === rid),
                    is = links.some((l) => l.item_part_fabric_id === rid);
                  return h(
                    'tr',
                    { key: rid },
                    h('td'),
                    h(
                      'td',
                      null,
                      r
                        ? [r.style, r.variant, r.part, r.subpart].join(' · ')
                        : 'Linked requirement (reload planner to inspect)',
                    ),
                    h('td', null, is ? (was ? 'Existing' : 'Added') : 'Removed'),
                    h('td', null, r ? kg(r.required) : '—'),
                    h('td'),
                  );
                }),
              );
            }),
          h(
            'tr',
            { className: 'planner-total' },
            h('th', { colSpan: 4, scope: 'row' }, 'Edition subtotal'),
            h(
              'td',
              null,
              kg(
                next.items
                  .filter((i) => i.dyeing_program_lab_dip_id === g.id)
                  .reduce((n, i) => n + Number(i.quantity), 0),
              ),
            ),
          ),
        ),
      ),
    );
  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog',
      'aria-label': 'Dyeing Program',
      onCancel: (e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!busy) onClose();
      },
    },
    h('h2', null, id ? 'Edit Dyeing Program' : 'New Dyeing Program'),
    notice &&
      h('p', { role: 'alert', className: 'form-error', ref: errorSummary, tabIndex: -1 }, notice),
    review
      ? h(
          'section',
          { 'aria-label': 'Review Dyeing Program' },
          h('h3', { ref: reviewTitle, tabIndex: -1 }, 'Review Dyeing Program'),
          h(
            'p',
            null,
            `${review.draft.header.date} · ${data.contacts.find((c) => c.id === data.dyer.find((d) => d.id === review.draft.header.dyer_id)?.contacts_id)?.company_name || 'Dyer'} · ${review.draft.header.dyeing_program_status_id === '2' ? (draft.header.dyeing_program_status_id === '2' ? 'Final' : 'Draft → Final') : review.draft.header.dyeing_program_status_id === '1' ? 'Draft' : 'Unclassified'}`,
          ),
          summary(review.draft, programDraft(data, id)),
          programDraft(data, id).items.some(
            (old) => !review.draft.items.some((i) => i.id === old.id),
          ) &&
            h(
              Table,
              { columns: ['Removed fabric row', 'Previous ordered kg', 'Planner links removed'] },
              programDraft(data, id)
                .items.filter((old) => !review.draft.items.some((i) => i.id === old.id))
                .map((old) =>
                  h(
                    'tr',
                    { key: old.id },
                    h('th', { scope: 'row' }, fabricName(old.fabric_type_id)),
                    h('td', null, kg(old.quantity)),
                    h(
                      'td',
                      null,
                      programDraft(data, id).links.filter(
                        (l) => l.dyeing_program_item_id === old.id,
                      ).length,
                    ),
                  ),
                ),
            ),
          h(
            'p',
            null,
            `${draft.groups.length} edition groups · ${draft.items.length} fabric items · ${draft.links.length} planner links · ${kg(draft.items.reduce((n, i) => n + Number(i.quantity), 0))} kg`,
          ),
          h(
            'div',
            { className: 'editor-actions' },
            button('Back to edit', () => setReview(null), { disabled: busy }),
            button(busy ? 'Saving…' : 'Confirm save', confirm, {
              className: 'primary',
              disabled: busy,
            }),
          ),
        )
      : h(
          'form',
          { 'aria-label': 'Dyeing Program editor', onSubmit: prepareSave },
          h(
            'div',
            { className: 'fabric-fields' },
            h(
              'label',
              null,
              'Program number',
              h(
                'output',
                { 'aria-label': 'Program number' },
                draft.header.program_number || 'Assigned on save',
              ),
            ),
            h(Input, {
              label: 'Program date',
              type: 'date',
              required: true,
              value: draft.header.date?.slice(0, 10) || '',
              onChange: (date) => setDraft({ ...draft, header: { ...draft.header, date } }),
            }),
            h(RecordSelect, {
              label: 'Dyer',
              options: data.dyer.map((d) => ({
                value: d.id,
                label: data.contacts.find((c) => c.id === d.contacts_id)?.company_name || 'Dyer',
              })),
              value: draft.header.dyer_id,
              onChange: (dyer_id) => setDraft({ ...draft, header: { ...draft.header, dyer_id } }),
              disabled: draft.groups.length > 0,
            }),
          ),
          h(
            'p',
            null,
            'Status: ',
            draft.header.dyeing_program_status_id === '2'
              ? 'Final'
              : draft.header.dyeing_program_status_id === '1'
                ? 'Draft'
                : 'Unclassified',
          ),
          draft.groups.map((g) =>
            h(
              'section',
              { key: g.id, className: 'fabric-line' },
              h('h3', null, groupLabel(g)),
              h(RecordSelect, {
                label: groupLabel(g) + ' edition',
                value: g.lab_dip_id,
                options: data.lab_dip
                  .filter((l) => l.dyer_id === draft.header.dyer_id)
                  .map((l) => ({
                    value: l.id,
                    label: labelColour(l.id) + ' · Edition ' + l.edition,
                  })),
                onChange: (lab_dip_id) =>
                  attempt(() => {
                    if (lab_dip_id === g.lab_dip_id) return;
                    if (
                      draft.groups.some(
                        (other) => other.id !== g.id && other.lab_dip_id === lab_dip_id,
                      )
                    )
                      throw Error('This edition already has a group.');
                    const items = draft.items.filter((i) => i.dyeing_program_lab_dip_id === g.id);
                    if (
                      data.dyed_fabric_item.some((d) =>
                        items.some((i) => i.id === d.dyeing_program_item_id),
                      )
                    )
                      throw Error('Recorded receipts prevent changing this edition.');
                    if (
                      draft.links.some((l) => items.some((i) => i.id === l.dyeing_program_item_id))
                    )
                      throw Error('Remove planner links explicitly before changing the edition.');
                    changeGroup(g, { lab_dip_id, lab_dip_version_id: '', batch_no: null });
                  }),
              }),
              data.dyeing_program_lab_dip?.some(
                (old) =>
                  old.lab_dip_id === g.lab_dip_id && old.dyeing_program_id !== draft.header.id,
              ) && h('span', { className: 'status-chip' }, 'Approved from Previous Program'),
              h(
                'div',
                { className: 'fabric-fields' },
                h(LabRecordSelect, {
                  label: `${groupLabel(g)} version`,
                  data,
                  editionId: g.lab_dip_id,
                  mappingId: data.lab_dip.find((l) => l.id === g.lab_dip_id)?.color_map_by_brand_id,
                  dyerId: draft.header.dyer_id,
                  value: g.lab_dip_version_id,
                  onChange: (lab_dip_version_id) => changeGroup(g, { lab_dip_version_id }),
                }),
                h(RecordSelect, {
                  label: `${groupLabel(g)} Batch No.`,
                  value: g.batch_no || '',
                  options: batchesForVersion(data, g.lab_dip_version_id, draft.header.id).map(
                    (b) => ({ value: b.id, label: b.batch_no }),
                  ),
                  clearable: true,
                  onChange: (batch_no) => changeGroup(g, { batch_no: batch_no || null }),
                }),
              ),
              !draft.items.some((i) => i.dyeing_program_lab_dip_id === g.id) &&
                button('Remove empty group', () =>
                  setDraft({ ...draft, groups: draft.groups.filter((x) => x.id !== g.id) }),
                ),
            ),
          ),
          h(RecordPageHeading, {
            eyebrow: 'Program requirements',
            title: 'Fabrics',
            view,
            onView: (v) => {
              setView(v);
              setSelected(null);
            },
            sheetLabel: 'Sheet View',
            action:
              view === 'overview'
                ? button('Add from Fabric Planner', () => openPlanner(), {
                    disabled: !canPlanner || !snapshot || !draft.header.dyer_id,
                  })
                : undefined,
          }),
          view === 'sheet'
            ? h(
                Fragment,
                null,
                h(
                  RecordPageActions,
                  { view, label: 'Search program fabrics', value: query, onSearch: setQuery },
                  button('Add from Fabric Planner', () => openPlanner(), {
                    disabled: !canPlanner || !snapshot || !draft.header.dyer_id,
                  }),
                  button('Add manual row', () => {
                    setLinkItem(null);
                    setModal('manual');
                  }),
                  button('Manage Rows', () => setModal('rows')),
                  selectedItem &&
                    h(Input, {
                      label: 'Selected row ordered kg',
                      type: 'number',
                      min: 0,
                      step: '0.001',
                      value: selectedItem.quantity,
                      onChange: (quantity) => changeItem(selectedItem, { quantity }),
                    }),
                ),
                h(FabricSheet, {
                  page: 'dyeing-program-editor-sheet',
                  client,
                  spec: sheetSpec,
                  records: matrix.sheet,
                  capabilities: { format: can('format', 'programs'), export: false, print: false },
                  editableCell: (record, column) =>
                    !record.summary && column.key === record.fabricKey,
                  onEditCell: (record, _column, quantity) => {
                    const item = draft.items.find((i) => i.id === record.id);
                    if (item) changeItem(item, { quantity });
                  },
                  onNotice: setNotice,
                  onSelect: (r) => setSelected(r?.summary ? null : r),
                }),
              )
            : h(
                Fragment,
                null,
                h(
                  'div',
                  { className: 'editor-actions' },
                  button('Add manual row', () => {
                    setLinkItem(null);
                    setModal('manual');
                  }),
                  button('Manage Rows', () => setModal('rows')),
                ),
                h(OverviewTable, {
                  grid: 'dyeing-program-editor-overview',
                  title: 'Program fabrics',
                  client,
                  columns: matrix.columns.map((c) => ({
                    accessorKey: c.key,
                    header: c.label,
                    meta: { numeric: c.numeric },
                    ...(c.key === 'colour' ? { getGroupingValue: (r) => r.edition } : {}),
                  })),
                  records: matrix.rows,
                  externalSearch: query,
                  onSearch: setQuery,
                  onOpen: (id) => {
                    setSelected(matrix.rows.find((r) => r.id === id));
                    setModal('rows');
                  },
                  searchLabel: 'Search program fabrics',
                  initialPreferences: { grouping: ['colour'], expanded: true },
                  manualFiltering: true,
                  renderBody: (ctx) =>
                    h(ProgramOverviewRows, {
                      ...ctx,
                      onRules: setRules,
                      onOpen: () => setModal('rows'),
                    }),
                }),
              ),
          h(
            'div',
            { className: 'editor-actions' },
            h('button', { type: 'submit', className: 'primary' }, 'Review changes'),
            draft.header.dyeing_program_status_id !== '2' &&
              button('Review finalization', () =>
                attempt(() => {
                  const next = {
                    ...draft,
                    header: { ...draft.header, dyeing_program_status_id: '2' },
                  };
                  setReview({ after: saveProgram(data, next), draft: next });
                }),
              ),
          ),
        ),
    !review && h('div', { className: 'editor-actions' }, button('Cancel', onClose)),
    modal === 'planner' &&
      h(
        Dialog,
        { title: 'Fabric Planner · Add to Program', onClose: () => setModal(null) },
        h(
          'div',
          { className: 'fabric-fields' },
          h(RecordSelect, {
            label: 'Colour',
            value: colour,
            disabled: Boolean(linkItem),
            options: data.color_map_by_brand
              .filter((m) =>
                data.lab_dip.some(
                  (l) => l.color_map_by_brand_id === m.id && l.dyer_id === draft.header.dyer_id,
                ),
              )
              .map((m) => ({
                value: m.id,
                label: `${data.color_map.find((c) => c.id === m.color_map_id)?.name} · ${data.brand_list.find((b) => b.id === m.brand_list_id)?.brand}`,
              })),
            onChange: (v) => {
              setColour(v);
              setEdition('');
              setVersion('');
              setPicked([]);
            },
          }),
          h(RecordSelect, {
            label: 'Lab Dip edition',
            value: edition,
            disabled: Boolean(linkItem),
            options: labs.map((l) => ({
              value: l.id,
              label: `${labelColour(l.id)} · Edition ${l.edition}`,
            })),
            onChange: (v) => {
              setEdition(v);
              setPicked(
                draft.links
                  .filter((l) =>
                    draft.items.some(
                      (i) =>
                        i.id === l.dyeing_program_item_id &&
                        draft.groups.some(
                          (g) => g.id === i.dyeing_program_lab_dip_id && g.lab_dip_id === v,
                        ),
                    ),
                  )
                  .map((l) => l.item_part_fabric_id),
              );
              const group = draft.groups.find((g) => g.lab_dip_id === v);
              setVersion(group?.lab_dip_version_id || '');
            },
          }),
          h(RecordSelect, {
            label: 'Explicit version',
            value: version,
            disabled: Boolean(linkItem || currentGroup),
            options: data.lab_dip_version
              .filter((v) => v.lab_dip_id === edition)
              .map((v) => ({ value: v.id, label: versionLabel(data, v.id) })),
            onChange: setVersion,
          }),
        ),
        h(
          Table,
          {
            columns: [
              'Select',
              'Style / Variant',
              'Production Part',
              'Fabric Sub-part',
              'Fabric Type',
              'Required kg',
              'Status',
            ],
          },
          matching.map((r) =>
            h(
              'tr',
              { key: r.id },
              h(
                'td',
                null,
                h('input', {
                  type: 'checkbox',
                  'aria-label': `Select ${r.style} ${r.variant} ${r.part} ${r.subpart}`,
                  checked: picked.includes(r.id),
                  onChange: (e) =>
                    setPicked(
                      e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id),
                    ),
                }),
              ),
              h('td', null, r.style + ' · ' + r.variant),
              h('td', null, r.part),
              h('td', null, r.subpart),
              h('td', null, r.fabric),
              h('td', null, kg(r.required)),
              h('td', null, r.status),
            ),
          ),
        ),
        !matching.length && h('p', null, 'No matching requirements. Select a colour and edition.'),
        button(linkItem ? 'Review complete links' : 'Add to Program', plannerReview, {
          className: 'primary',
          disabled: !edition || !version || (!linkItem && !picked.length),
        }),
      ),
    modal === 'links-review' &&
      h(
        Dialog,
        {
          title: 'Reconfirm Complete Planner Links',
          onClose: () => {
            setPending(null);
            setModal('planner');
          },
        },
        pending && summary(pending),
        h(
          'p',
          null,
          `${pending?.groups.length || 0} edition groups · ${pending?.links.length || 0} complete links`,
        ),
        button(
          'Confirm complete links',
          () => {
            setDraft(pending);
            setPending(null);
            setModal(null);
          },
          { className: 'primary' },
        ),
      ),
    modal === 'rows' &&
      h(
        Dialog,
        { title: 'Manage Program Rows', onClose: () => setModal(null) },
        h(
          Table,
          {
            columns: [
              'Colour / Lab Dip',
              'Fabric Type',
              'Ordered Qty · kg',
              'Planner Links',
              'Actions',
              'Comments',
            ],
          },
          draft.groups.map((g) =>
            h(
              Fragment,
              { key: g.id },
              h('tr', null, h('th', { colSpan: 6, scope: 'rowgroup' }, groupLabel(g))),
              draft.items
                .filter((i) => i.dyeing_program_lab_dip_id === g.id)
                .map((i) =>
                  h(
                    'tr',
                    { key: i.id },
                    h('td', null, versionLabel(data, g.lab_dip_version_id)),
                    h('td', null, fabricName(i.fabric_type_id)),
                    h(
                      'td',
                      null,
                      h(Input, {
                        label: `${fabricName(i.fabric_type_id)} ordered kg`,
                        type: 'number',
                        min: 0,
                        step: '0.001',
                        value: i.quantity,
                        onChange: (quantity) => changeItem(i, { quantity }),
                      }),
                    ),
                    h(
                      'td',
                      null,
                      draft.links.filter((l) => l.dyeing_program_item_id === i.id).length,
                    ),
                    h(
                      'td',
                      null,
                      button('Manage Links', () => openPlanner(i), { disabled: !snapshot }),
                      button('Remove Row', () => removeItem(i)),
                    ),
                    h(
                      'td',
                      null,
                      h(RichCommentEditor, {
                        label: fabricName(i.fabric_type_id) + ' comments',
                        value: i.comments,
                        onChange: (comments) => changeItem(i, { comments }),
                      }),
                    ),
                  ),
                ),
            ),
          ),
        ),
      ),
    modal === 'manual' &&
      h(
        Dialog,
        { title: 'Add manual fabric requirement', onClose: () => setModal(null) },
        h(
          'div',
          { className: 'fabric-fields' },
          h(RecordSelect, {
            label: 'Lab Dip edition',
            value: edition,
            options: data.lab_dip
              .filter((l) => l.dyer_id === draft.header.dyer_id)
              .map((l) => ({ value: l.id, label: `${labelColour(l.id)} · Edition ${l.edition}` })),
            onChange: (v) => {
              setEdition(v);
              setVersion(draft.groups.find((g) => g.lab_dip_id === v)?.lab_dip_version_id || '');
            },
          }),
          h(RecordSelect, {
            label: 'Explicit version',
            value: version,
            disabled: Boolean(currentGroup),
            options: data.lab_dip_version
              .filter((v) => v.lab_dip_id === edition)
              .map((v) => ({ value: v.id, label: versionLabel(data, v.id) })),
            onChange: setVersion,
          }),
          h(RecordSelect, {
            label: 'Fabric type',
            value: manualFabric,
            options: data.fabric_type.map((f) => ({ value: f.id, label: f.name })),
            onChange: setManualFabric,
          }),
          h(Input, {
            label: 'Ordered kg',
            type: 'number',
            min: 0,
            step: '0.001',
            value: manualQuantity,
            onChange: setManualQuantity,
          }),
        ),
        button(
          'Add manual row',
          () =>
            attempt(() => {
              if (
                !edition ||
                !version ||
                !manualFabric ||
                manualQuantity === '' ||
                !Number.isFinite(Number(manualQuantity)) ||
                Number(manualQuantity) < 0
              )
                throw Error('Select edition, version, fabric and ordered kg.');
              let group = currentGroup;
              const next = structuredClone(draft);
              if (!group) {
                if (next.groups.length >= 6)
                  throw Error('A program permits at most six edition groups.');
                group = {
                  id: crypto.randomUUID(),
                  dyeing_program_id: draft.header.id,
                  lab_dip_id: edition,
                  lab_dip_version_id: version,
                  batch_no: null,
                };
                next.groups.push(group);
              }
              next.items.push({
                id: crypto.randomUUID(),
                dyeing_program_id: draft.header.id,
                dyeing_program_lab_dip_id: group.id,
                fabric_type_id: manualFabric,
                quantity: Number(manualQuantity),
                comments: '',
              });
              setDraft(next);
              setModal(null);
            }),
          { className: 'primary' },
        ),
      ),
  );
}
