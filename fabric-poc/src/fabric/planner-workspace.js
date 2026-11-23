import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { OverviewTable, matchesOverviewRules } from './overview-table.js';
import { useGridPreferences } from './grid-preferences.js';
import { FabricSheet } from './sheet.js';
import { RecordPageActions, RecordPageHeading, RecordPageStatus } from './record-page.js';
import { useGridSearch } from './grid-toolbar.js';
import { FabricPlanEdit } from './planner.js';
import {
  plannerRequirements,
  plannerFabrics,
  plannerMatrix,
  plannerFields,
  plannerGroups,
  plannerTotal,
  plannerSheetRows,
} from './planner-model.js';
import './planner.css';
const kg = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
const defaults = { grouping: ['colour'], expanded: true, sorting: [{ id: 'style', desc: false }] };

function RequirementRows({ table, preferences, save, onRules, onOpen }) {
  const rules = preferences.filters || [];
  const signature = JSON.stringify(rules);
  useEffect(() => onRules(rules), [signature]);
  const records = table
    .getSortedRowModel()
    .flatRows.filter((r) => !r.getIsGrouped())
    .map((r) => r.original);
  const columns = table.getVisibleLeafColumns();
  const grouped = preferences.grouping?.includes('colour');
  const groups = grouped ? plannerGroups(records) : [{ colour: 'ungrouped', records }];
  if (grouped && preferences.sorting?.find((rule) => rule.id === 'colour')?.desc) groups.reverse();
  const expanded = preferences.expanded ?? true;
  const isOpen = (colour) => expanded === true || expanded['colour:' + colour] === true;
  const total = (rows, label, id) =>
    h(
      'tr',
      { key: id, className: 'planner-total', 'data-testid': id },
      columns.map((c, i) =>
        h(
          'td',
          { key: c.id, className: c.id.startsWith('fabric-') ? 'numeric' : undefined },
          c.id.startsWith('fabric-') ? kg(plannerTotal(rows, c.id)) : i === 0 ? label : '',
        ),
      ),
    );
  return h(
    Fragment,
    null,
    h(
      'tbody',
      null,
      !records.length && h('tr', null, h('td', { colSpan: columns.length }, 'No matching records')),
      groups.map((g) =>
        h(
          Fragment,
          { key: g.colour },
          grouped &&
            h(
              'tr',
              { className: 'planner-group' },
              h(
                'th',
                { colSpan: columns.length },
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-expanded': isOpen(g.colour),
                    onClick: () =>
                      save({
                        expanded: {
                          ...Object.fromEntries(
                            groups.map((x) => ['colour:' + x.colour, isOpen(x.colour)]),
                          ),
                          ['colour:' + g.colour]: !isOpen(g.colour),
                        },
                      }),
                  },
                  (isOpen(g.colour) ? '▾ ' : '▸ ') + g.colour,
                ),
              ),
            ),
          (!grouped || isOpen(g.colour)) &&
            g.records.map((r) =>
              h(
                'tr',
                {
                  key: r.id,
                  'data-requirement': r.id,
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r.id);
                  },
                  onClick: (e) => {
                    if (!e.target.closest('button,a,input,select,textarea')) onOpen(r.id);
                  },
                },
                columns.map((c) =>
                  h(
                    'td',
                    { key: c.id, className: c.id.startsWith('fabric-') ? 'numeric' : undefined },
                    c.id === 'colour' && grouped
                      ? ''
                      : c.id === 'style'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              'aria-haspopup': 'dialog',
                              onClick: () => onOpen(r.id),
                            },
                            r.style,
                          )
                        : c.id === 'status'
                          ? h('span', { className: 'erp-overview-status' }, r.status)
                          : typeof r[c.id] === 'number'
                            ? kg(r[c.id])
                            : r[c.id],
                  ),
                ),
              ),
            ),
          grouped && total(g.records, g.colour + ' subtotal', 'subtotal:' + g.colour),
        ),
      ),
    ),
    h('tfoot', null, total(records, 'Grand total', 'grand')),
  );
}
function Source({ record, snapshot, canEdit, onEdit, onClose }) {
  const dialog = useRef(null);
  useEffect(() => dialog.current.showModal(), []);
  const req = record.requirement;
  const programs = new Map(snapshot.program_items.map((p) => [p.dyeing_program_item_id, p]));
  const links = snapshot.links
    .filter((l) => l.item_part_fabric_id === record.id)
    .map((l) => programs.get(l.dyeing_program_item_id))
    .filter(Boolean);
  const actual = snapshot.actual_consumption.find(
    (r) =>
      r.variant_item_id === record.variantItemId &&
      'fabric-' + r.fabric_type_id === record.fabricId,
  );
  return h(
    'dialog',
    { ref: dialog, className: 'fabric-dialog', 'aria-label': 'Fabric requirement source', onClose },
    h('h2', null, record.style + ' · ' + record.variant),
    h(
      'dl',
      { className: 'fabric-fields' },
      [
        ['Requirement ID', record.id],
        ['Production-part reference · variant_item.id', record.variantItemId],
        ['Production part', record.part],
        ['Fabric sub-part', record.subpart],
        ['Fabric type', record.fabric],
        ['Component lab dip', record.lab],
        ['Lab-dip ID', record.labId ?? 'Unclassified'],
        ['Required kg', kg(record.required)],
        ['Consumption kg/piece', kg(req.consumption_per_piece_kg)],
        ['Effective status', record.status],
        ['Estimated ordered kg', kg(req.estimated_ordered_kg || 0)],
        ['Estimated received kg', kg(req.estimated_received_kg || 0)],
        ['Receipt shortage kg', kg(req.receipt_shortage_kg || 0)],
        ['Actual consumed kg · Variant + Fabric Type', kg(actual?.consumed_kg || 0)],
      ].map(([label, value]) =>
        h('div', { key: label }, h('dt', null, label), h('dd', null, value)),
      ),
    ),
    h(
      'p',
      null,
      'Actual consumption is the variant/fabric total; it is not assigned to this sub-part.',
    ),
    h('h3', null, 'Linked programs'),
    links.length
      ? h(
          'ul',
          null,
          links.map((p) =>
            h(
              'li',
              { key: p.dyeing_program_item_id },
              `${p.program_number} · ${p.program_status} · Lab dip v${p.lab_dip_version} · ${kg(p.ordered_kg)} kg`,
            ),
          ),
        )
      : h('p', null, 'No linked program'),
    h(
      'div',
      { className: 'editor-actions' },
      h('button', { onClick: () => dialog.current.close() }, 'Close'),
      canEdit && h('button', { onClick: onEdit }, 'Edit fabric requirement'),
    ),
  );
}
export function FabricPlanner({ client, canEdit, canLink, capabilities }) {
  const [snapshot, setSnapshot] = useState(null),
    [notice, setNotice] = useState('Loading fabric plan…');
  const [view, setView] = useState('overview'),
    [query, setQuery] = useState(''),
    [rules, setRules] = useState([]);
  const [selected, setSelected] = useState(null),
    [source, setSource] = useState(null),
    [editing, setEditing] = useState(null);
  useEffect(() => {
    let active = true;
    client.rpc('erp_fabric_planner_snapshot').then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice(error.message);
      else {
        setSnapshot(data);
        setNotice('');
      }
    });
    return () => {
      active = false;
    };
  }, [client]);
  const requirements = useMemo(() => (snapshot ? plannerRequirements(snapshot) : []), [snapshot]);
  const sharedSearch = useGridPreferences(client, 'fabric-planner-search');
  useEffect(() => {
    if (sharedSearch.ready) setQuery(sharedSearch.preferences.search ?? '');
  }, [sharedSearch.ready, sharedSearch.owner]);
  function changeQuery(value) {
    setQuery(value);
    sharedSearch.save({ search: value });
  }
  const search = useGridSearch(query).trim().toLowerCase();
  const allFabrics = useMemo(() => plannerFabrics(requirements), [requirements]);
  const matrix = useMemo(() => plannerMatrix(requirements, allFabrics), [requirements, allFabrics]);
  const filtered = useMemo(
    () =>
      matrix.filter(
        (r) =>
          matchesOverviewRules(r, rules) &&
          (!search ||
            [r.colour, r.style, r.variant, r.part, r.subpart, r.lab, r.fabric].some((v) =>
              v.toLowerCase().includes(search),
            )),
      ),
    [matrix, rules, search],
  );
  const fabrics = useMemo(() => plannerFabrics(filtered), [filtered]);
  const columns = useMemo(
    () => [
      ...plannerFields.map(([key, label]) => ({ key, label })),
      ...fabrics.map((f) => ({ key: f.id, label: f.name + ' · kg', numeric: true })),
      { key: 'status', label: 'Fabric Status' },
    ],
    [fabrics],
  );
  const sheetRows = useMemo(() => plannerSheetRows(filtered, fabrics), [filtered, fabrics]);
  const spec = useMemo(
    () => ({
      title: 'Fabric Planner',
      columns,
      grouping: { key: 'colour', summaryKey: 'summary' },
    }),
    [columns],
  );
  useEffect(() => setSelected(null), [query, view, sheetRows]);
  const open = (id) => setSource(requirements.find((r) => r.id === id) || null);
  return h(
    'section',
    { className: 'fabric-planner-workspace' },
    h(RecordPageHeading, {
      eyebrow: 'PRODUCTION',
      title: 'Fabric Planner',
      description: 'Fabric requirements · kg · filters apply to the loaded snapshot',
      view,
      onView: setView,
      sheetLabel: 'Sheet View',
      viewLabel: 'Fabric Planner view',
      ...(view === 'overview' ? { action: null } : {}),
    }),
    notice && h(RecordPageStatus, { notice }),
    snapshot &&
      (view === 'overview'
        ? h(OverviewTable, {
            client,
            grid: 'overview-fabric-planner',
            title: 'Fabric Planner',
            records: filtered,
            manualFiltering: true,
            initialPreferences: defaults,
            externalSearch: query,
            onSearch: changeQuery,
            searchLabel: 'Search fabric requirements',
            getSearchText: (r) =>
              [r.colour, r.style, r.variant, r.part, r.subpart, r.lab, r.fabric].join(' '),
            tableClassName: 'planner-operational',
            columns: columns.map((c) => ({
              accessorKey: c.key,
              header: c.label,
              enableGrouping: c.key === 'colour',
            })),
            renderBody: (ctx) => h(RequirementRows, { ...ctx, onRules: setRules, onOpen: open }),
          })
        : h(
            Fragment,
            null,
            h(
              RecordPageActions,
              {
                view: 'sheet',
                label: 'Search fabric requirements',
                value: query,
                onSearch: changeQuery,
              },
              h(
                'button',
                { disabled: !selected || !!selected.summary, onClick: () => open(selected.id) },
                'View source',
              ),
            ),
            h(FabricSheet, {
              client,
              page: 'sheet-fabric-planner',
              spec,
              records: sheetRows,
              preferences: { sort: { key: 'style', direction: 'asc' } },
              capabilities,
              onSelect: setSelected,
              onNotice: setNotice,
            }),
          )),
    source &&
      h(Source, {
        record: source,
        snapshot,
        canEdit,
        onClose: () => setSource(null),
        onEdit: () => {
          setEditing(source);
          setSource(null);
        },
      }),
    editing &&
      h(FabricPlanEdit, {
        client,
        snapshot,
        row: editing.parent,
        requirement: editing.requirement,
        canEdit,
        canLink,
        onClose: () => setEditing(null),
        onSave: (data) => {
          setSnapshot(data);
          setEditing(null);
          setNotice('Fabric plan saved.');
        },
      }),
  );
}
