import { ProductionItemEditor } from '../production-task-board/item-editor.js';
import {
  productionCommands,
  productionTasks,
  mergeProductionSnapshot,
} from '../production-task-board/live.js';
import { liveProductionPage } from '../production-task-board/live-contract.js';
import { PortalTaskBoard } from '../production-task-board/portal';
import { JobHistory } from '../production-task-board/job-history';
import { AccountFooter } from '../access/account-footer.js';
import { OverviewPanel } from '../overview/panel.js';
import { getAccessClient, createVerificationClient } from '../access/client.js';
import {
  liveFabricCommands,
  liveFabricPage,
  emptyLiveFabric,
  assertLiveIdentifiers,
  fabricRoot,
} from './live.js';
import { LabOverview } from '../colours/cards.js';
import { LabEditor } from '../colours/editor.js';
import { WorkspaceGate, sessionAccessModel } from '../access/workspace-gate.js';
import { ItemEditor } from '../production/item-editor.js';
import { JobEditor } from '../production/editor.js';
import { ProductionOverview } from '../production/cards.js';
import { InventoryCard } from '../inventory/cards.js';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { pages, otherModules } from './catalog.js';
import {
  initialFabric,
  validateFabric,
  fabricRows,
  fabricTotals,
  selectors,
  upgradeFabric,
} from './domain.js';
import { FabricSheet } from './sheet.js';
import { BillEditor } from './editor.js';
import './styles.css';
import { initialAccess, allowed, isAdministrator, upgradeAccess } from '../admin/model.js';
import { AdminPanel, adminPages } from '../admin/panel.js';
import { HRPanel } from '../hr/panel.js';
import { ContactEditor } from '../miscellaneous/contact-editor.js';
import { hrPages } from '../hr/model.js';
const h = React.createElement,
  STORE = 'garments-fabric-workspace-v1';
const fmt = (n) =>
  typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n;
const sidebarIcon = (expanded) =>
  h(
    'svg',
    {
      width: 20,
      height: 20,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
    },
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    h('path', { d: 'M8 4v16' }),
    h('path', { d: expanded ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3' }),
  );
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved?.version === 1) {
      saved.data = upgradeFabric(saved.data);
      if (validateFabric(saved.data)) return saved;
    }
  } catch {
    /* Invalid or unavailable storage uses the sample workspace. */
  }
  return { version: 1, data: initialFabric(), preferences: {} };
}
const pageFromHash = () => {
  const key = location.hash.slice(1);
  if (key === 'fabricOverview') return key;
  if (key === 'adminUsers') return 'employees';
  return Object.hasOwn(pages, key) || Object.hasOwn(adminPages, key) || Object.hasOwn(hrPages, key)
    ? key
    : 'home';
};
function loadAccess() {
  try {
    const value = JSON.parse(localStorage.getItem('garments-access-preview-v1') || 'null');
    if (
      [1, 2].includes(value?.version) &&
      Array.isArray(value.roles) &&
      Array.isArray(value.users) &&
      Array.isArray(value.audit)
    )
      return upgradeAccess(value);
  } catch {
    /* Preview defaults remain available if storage is unavailable. */
  }
  return initialAccess();
}
function loadSidebar() {
  try {
    const saved = localStorage.getItem('garments-sidebar-open');
    if (saved !== null) return saved === 'true';
  } catch {
    /* Navigation works without storage. */
  }
  return !window.matchMedia('(max-width:700px)').matches;
}
function App({ live }) {
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebar);
  useEffect(() => {
    try {
      localStorage.setItem('garments-sidebar-open', String(sidebarOpen));
    } catch {
      /* Personal menu preference is optional. */
    }
  }, [sidebarOpen]);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (
        event.key === 'Escape' &&
        sidebarOpen &&
        window.matchMedia('(max-width:700px)').matches &&
        !document.querySelector('dialog[open]')
      ) {
        setSidebarOpen(false);
        requestAnimationFrame(() => document.getElementById('navigation-toggle')?.focus());
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);
  const [access, setAccess] = useState(() => (live ? sessionAccessModel(live) : loadAccess())),
    [actor, setActor] = useState(live?.actor || 'owner');
  useEffect(() => {
    if (live) {
      setAccess(sessionAccessModel(live));
      setActor(live.actor);
    }
  }, [live]);
  const can = (action, key = page) =>
    allowed(
      access,
      actor,
      ['productionTaskBoard', 'productionUpdateTaskStatus'].includes(key) ? 'productionJobs' : key,
      action,
    );
  function saveAccess(next) {
    try {
      localStorage.setItem('garments-access-preview-v1', JSON.stringify(next));
    } catch {
      setNotice('Access preview could not be persisted. Changes last only in this tab.');
    }
    setAccess(next);
  }
  const [state, setState] = useState(() =>
      live
        ? {
            version: 1,
            data: { ...emptyLiveFabric(initialFabric()), _live: true },
            preferences: {},
          }
        : load(),
    ),
    [page, setPage] = useState(pageFromHash),
    [view, setView] = useState('overview'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(null),
    [editor, setEditor] = useState(null),
    [notice, setNotice] = useState('Local workspace · sample data · no live database writes');
  useEffect(() => {
    const handle = () => {
      setPage(pageFromHash());
      setQuery('');
      setSelected(null);
      setView('overview');
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  const [liveReady, setLiveReady] = useState(!live),
    [liveError, setLiveError] = useState(''),
    [productionError, setProductionError] = useState('');
  const commands = useMemo(
    () => (live ? liveFabricCommands(getAccessClient(), createVerificationClient) : null),
    [Boolean(live)],
  );
  const production = useMemo(
    () => (live ? productionCommands(getAccessClient()) : null),
    [Boolean(live)],
  );
  const connectedPage = (key) => liveFabricPage(key) || liveProductionPage(key);
  const allowedModule = (check) =>
    live &&
    (live.administrator ||
      Object.entries(live.permissions || {}).some(([key, p]) => check(key) && p.view));
  async function loadLive() {
    const [fabricResult, productionResult] = await Promise.allSettled([
      allowedModule(liveFabricPage) ? commands.load() : {},
      allowedModule(liveProductionPage) || can('view', 'productionJobs') ? production.load() : {},
    ]);
    setLiveError(fabricResult.status === 'rejected' ? fabricResult.reason.message : '');
    setProductionError(
      productionResult.status === 'rejected' ? productionResult.reason.message : '',
    );
    const fabric = fabricResult.status === 'fulfilled' ? fabricResult.value : {};
    const workspace = productionResult.status === 'fulfilled' ? productionResult.value : {};
    return mergeProductionSnapshot(fabric, workspace);
  }
  async function applyProduction(
    snapshot,
    message = 'Saved to Supabase · Production records refreshed',
  ) {
    setState((previous) => ({
      ...previous,
      data: mergeProductionSnapshot(previous.data, snapshot),
    }));
    setNotice(message);
  }
  async function commitProduction(before, after) {
    let snapshot = state.data;
    try {
      for (const task of after) {
        const old = before.find((r) => r.id === task.id);
        if (old && JSON.stringify(old) !== JSON.stringify(task)) {
          const expected = state.data.production_records.find(
            (r) => r.production.id === task.id,
          )?.revision;
          const current = snapshot.production_records.find(
            (r) => r.production.id === task.id,
          )?.revision;
          if (expected !== current)
            throw Error('A selected task changed. Reload and review it before saving.');
          snapshot = await production.saveTask(snapshot, old, task);
        }
      }
      await applyProduction(snapshot);
      return productionTasks(snapshot);
    } catch (error) {
      // Reload canonical rows after a failed or partially completed bulk operation.
      try {
        await applyProduction(
          await production.load(),
          'Records reloaded. Review the save error before trying again.',
        );
      } catch {
        /* Keep original error. */
      }
      throw error;
    }
  }
  async function refreshLive() {
    setLiveError('');
    if (
      live &&
      !live.administrator &&
      !Object.entries(live.permissions || {}).some(
        ([key, p]) => (connectedPage(key) || key === 'productionJobs') && p.view,
      )
    ) {
      setLiveReady(true);
      setNotice('No data sections assigned yet');
      return;
    }
    try {
      const snapshot = assertLiveIdentifiers(await loadLive());
      setState((previous) => ({
        ...previous,
        data: {
          ...emptyLiveFabric(initialFabric()),
          ...snapshot,
          dyed_bill_verifiers: snapshot.dyed_bill_verifiers || state.data.dyed_bill_verifiers || [],
        },
      }));
      setLiveReady(true);
      setNotice('Live Supabase records · saved changes are shared');
    } catch (e) {
      setLiveReady(false);
      setLiveError(e.message);
    }
  }
  useEffect(() => {
    if (commands) void refreshLive();
  }, [commands, live]);
  const data = useMemo(
    () => ({
      ...state.data,
      employee: live
        ? state.data.employee
        : access.users.map(({ id, name, employeeCode }) => ({ id, name, employeeCode })),
    }),
    [state.data, access.users],
  );
  const spec = pages[page],
    preferences = state.preferences[page] || {},
    totals = useMemo(() => fabricTotals(data), [data]);
  const records = useMemo(
    () =>
      spec
        ? fabricRows(data, page).filter((r) =>
            Object.values(r).some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
          )
        : [],
    [data, page, spec, query],
  );
  function save(next) {
    if (live) {
      setState(next);
      return true;
    }
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
      setState(next);
      return true;
    } catch {
      setState(next);
      setNotice('Browser storage is unavailable. Changes will last only in this tab.');
      return false;
    }
  }
  function prefs(patch) {
    if (patch.styles && !can('format')) return;
    const current = state.preferences[page] || {};
    save({ ...state, preferences: { ...state.preferences, [page]: { ...current, ...patch } } });
  }
  function navigate(key) {
    if (live && Object.hasOwn(adminPages, key)) {
      location.href = '/access.html#' + key;
      return;
    }
    if (window.matchMedia('(max-width:700px)').matches) setSidebarOpen(false);
    setPage(key);
    location.hash = key === 'home' ? '' : key;
    setQuery('');
    setSelected(null);
    setView('overview');
    setNotice(
      live
        ? 'Live Supabase records · saved changes are shared'
        : 'Local workspace · sample data · no live database writes',
    );
  }
  function edit(id) {
    if (live && (!liveReady || !connectedPage(page))) return;
    if (!can(id ? 'edit' : 'create')) {
      setNotice('Your role does not allow this action.');
      return;
    }
    setEditor({ page, id });
  }
  async function saveData(next, verification) {
    if (!can(editor?.id ? 'edit' : 'create', editor?.page))
      throw Error('Your role no longer allows this change.');
    if (!live && editor.page === 'dyeBills') {
      if (!verification?.employee || !verification.password)
        throw Error('Select an employee and enter their password.');
      const root = fabricRoot('dyeBills', state.data, next, editor);
      next.dyed_fabric_bill.find((b) => b.id === root.id).verified_by_employee_id =
        verification.employee;
    }
    if (live) {
      if (!liveReady) throw Error('Wait for live data to load.');
      if (liveProductionPage(editor.page)) {
        await applyProduction(
          await production.saveSetup({
            resource: editor.page,
            before: state.data,
            after: next,
            id: editor.id,
          }),
        );
        setSelected(null);
        return;
      }
      const resource = editor.page,
        root = fabricRoot(resource, state.data, next, editor),
        action = root.before ? 'edit' : 'create';
      const snapshot = assertLiveIdentifiers(
        await commands.save({
          resource,
          root,
          action,
          before: state.data,
          after: next,
          verification,
        }),
      );
      setState((previous) => ({
        ...previous,
        data: {
          ...mergeProductionSnapshot(previous.data, snapshot),
          dyed_bill_verifiers: snapshot.dyed_bill_verifiers || state.data.dyed_bill_verifiers || [],
        },
      }));
      setNotice('Saved to Supabase · linked records refreshed');
    } else if (save({ ...state, data: next }))
      setNotice(
        spec.master
          ? 'Details saved locally. Linked names and choices updated.'
          : 'Complete document saved locally. Linked balances and traceability updated.',
      );
    setSelected(null);
  }

  function sorting(key, direction) {
    prefs({ sort: { key, direction } });
    setSelected(null);
  }
  const groups = useMemo(() => {
    if (!spec) return [];
    const result = new Map();
    records.forEach((row) => {
      const key = spec.readonly || page === 'suppliers' ? row.id : row.documentId;
      const g = result.get(key) || {
        id: key,
        rows: [],
        title: row.bill || row.name,
        supplier: row.supplier,
      };
      g.rows.push(row);
      result.set(key, g);
    });
    return [...result.values()];
  }, [spec, records, page]);
  function trail(row) {
    if (page === 'batches')
      return h(
        'div',
        { className: 'batch-journey' },
        [
          ['Yarn', row.yarnBill, row.yarn],
          ['Knitting', row.knitBill, row.knitter],
          ['Dyeing', row.program, row.supplier],
          ['Received', row.bill, `${fmt(row.quantity)} kg`],
        ].map(([label, title, detail], i) =>
          h(
            'div',
            { className: 'journey-step', key: label },
            h('span', null, `0${i + 1} · ${label}`),
            h('strong', null, title),
            h('small', null, detail),
          ),
        ),
      );
    const s = selectors(data);
    let movements = [];
    if (page === 'yarnLeft')
      movements = data.knitting_bill_item
        .filter((k) => k.yarn_bill_item_id === row.id)
        .map((k) => ({
          label: s.knit(k).bill.invoice_number,
          party: s.knit(k).supplier,
          quantity: k.consumption,
        }));
    if (page === 'greige') {
      const lineIds = data.knitting_bill_item
        .filter((k) => s.knit(k).bill.invoice_number === row.bill && s.knit(k).name === row.name)
        .map((k) => k.id);
      movements = data.dyed_fabric_item
        .filter((d) => lineIds.includes(d.knitting_bill_item_id))
        .map((d) => ({
          label: s.dyed(d).bill.invoice_number,
          party: s.dyed(d).supplier,
          quantity: d.gross_quantity,
        }));
    }
    return (
      movements.length > 0 &&
      h(
        'details',
        { className: 'movement-details' },
        h('summary', null, 'See consumption by bill'),
        movements.map((m, i) =>
          h(
            'div',
            { key: i },
            h('span', null, `${m.label} · ${m.party}`),
            h('strong', null, `${fmt(m.quantity)} kg`),
          ),
        ),
      )
    );
  }
  function reconcile(id) {
    if (can('create', 'materialIssues'))
      setEditor({ page: 'materialIssues', id: null, receiptId: id, reconciliation: true });
  }
  function labEdit(id, mode) {
    if (live && !liveReady) return;
    if (!can(mode === 'edition' ? 'create' : 'edit', 'labDips')) return;
    setEditor({ page: 'labDips', id: mode === 'edition' ? null : id, sourceId: id, mode });
  }
  function overview() {
    if (page === 'labDips')
      return h(LabOverview, {
        data,
        records,
        onEdit: labEdit,
        editable: can('edit'),
        creatable: can('create'),
      });
    if (spec.production)
      return h(ProductionOverview, {
        groups,
        spec,
        page,
        onEdit: edit,
        editable: can('edit'),
        stageDefinitions: data.stage,
      });
    if (spec.inventory || spec.miscellaneous)
      return h(
        'section',
        { className: 'overview-grid' },
        groups.map((group, index) =>
          h(InventoryCard, {
            key: group.id,
            group,
            spec,
            page,
            index,
            onEdit: edit,
            onReconcile: reconcile,
            editable: !spec.readonly && can('edit'),
            reconcilable: can('create', 'materialIssues'),
          }),
        ),
      );
    return h(
      'section',
      { className: 'overview-grid' },
      groups.map((g, i) => {
        const first = g.rows[0],
          quantity =
            page === 'greige' || page === 'yarnLeft'
              ? first.left
              : g.rows.reduce((s, r) => s + Number(r.quantity || 0), 0),
          colour = page === 'batches' || page === 'dyed' ? first.color : null;
        return h(
          'article',
          { className: `overview-card tone-${i % 4}`, key: g.id },
          h(
            'div',
            { className: 'card-top' },
            h(
              'span',
              { className: 'card-kicker' },
              page === 'suppliers' ? first.kind : colour || first.supplier || spec.title,
            ),
            h('span', { className: 'card-dots' }, '•••'),
          ),
          h('h2', null, page === 'batches' ? first.batch : g.title),
          h(
            'p',
            { className: 'card-subtitle' },
            spec.reference
              ? 'Shared reference'
              : spec.readonly
                ? first.name
                : g.supplier || first.name,
          ),
          spec.reference
            ? h(
                'div',
                { className: 'colour-card-details' },
                spec.columns
                  .filter((c) => c.key !== 'name')
                  .map((c) => h('p', { key: c.key }, `${c.label}: ${fmt(first[c.key])}`)),
                h('small', null, 'Used by linked records'),
              )
            : spec.master
              ? h(
                  'div',
                  { className: 'colour-card-details' },
                  h(
                    'p',
                    null,
                    first.pantone === '—' ? 'Pantone not set' : `Pantone ${first.pantone}`,
                  ),
                  page === 'colours'
                    ? h('p', null, `${first.mappings} brand mappings`)
                    : h('p', null, `Brand: ${first.brand}`),
                )
              : page === 'suppliers'
                ? h(
                    'p',
                    { className: 'card-measure' },
                    first.orders,
                    h('small', null, ' linked documents'),
                  )
                : h(
                    'p',
                    { className: 'card-measure' },
                    fmt(quantity),
                    h('small', null, page === 'greige' || page === 'yarnLeft' ? ' kg left' : ' kg'),
                  ),
          g.rows.length > 1 &&
            h('p', { className: 'card-subtitle' }, `${g.rows.length} lines on this document`),
          page === 'dyed' &&
            h(
              'p',
              { className: 'price-chip' },
              `₹ ${fmt(first.price)} / kg · ${fmt(first.wastage)}% wastage`,
            ),
          trail(first),
          !spec.readonly &&
            can('edit') &&
            h(
              'button',
              { className: 'open-document', onClick: () => edit(g.id) },
              spec.master ? 'Edit →' : page === 'suppliers' ? 'Edit supplier →' : 'Open document →',
            ),
          !spec.readonly &&
            !spec.master &&
            g.rows.length > 0 &&
            page !== 'suppliers' &&
            h(
              'details',
              { className: 'card-lines' },
              h('summary', null, 'See line items'),
              g.rows.map((r) =>
                h(
                  'div',
                  { key: r.id },
                  h('span', null, `${r.name}${r.color ? ' · ' + r.color : ''}`),
                  h('strong', null, `${fmt(r.quantity)} kg`),
                ),
              ),
              h(
                'div',
                { className: 'line-total' },
                h('span', null, 'Total'),
                h('strong', null, `${fmt(quantity)} kg`),
              ),
            ),
        );
      }),
    );
  }
  function fabricHome() {
    return h(
      React.Fragment,
      null,
      h(
        'section',
        { className: 'fabric-hero' },
        h(
          'div',
          null,
          h('p', { className: 'eyebrow' }, 'FABRIC, FROM START TO FINISH'),
          h('h1', null, 'Know what came in.\nSee where it went.'),
          h('p', null, 'Keep yarn, knitting and dyeing connected—one clear record at a time.'),
          can('view', 'knitting') &&
            h(
              'button',
              { className: 'primary', onClick: () => navigate('knitting') },
              'Open knitting bills →',
            ),
        ),
        h(
          'div',
          { className: 'hero-route' },
          ['Yarn', 'Knitting', 'Dyeing', 'Ready'].map((name, i) =>
            h(
              'div',
              { key: name },
              h('span', null, ['◉', '▤', '◒', '✓'][i]),
              h('strong', null, name),
              h(
                'small',
                null,
                ['Receive & track', 'Create greige', 'Plan by colour', 'Trace every batch'][i],
              ),
            ),
          ),
        ),
      ),
      h(
        'section',
        { className: 'metric-grid' },
        [
          ['Yarn available', totals.yarnLeft, 'kg', 'yarnLeft'],
          ['Greige available', totals.greigeLeft, 'kg', 'greige'],
          ['Dyed fabric received', totals.dyed, 'kg', 'dyed'],
          ['Traceable batches', totals.batches, 'batches', 'batches'],
        ]
          .filter(([, , , target]) => can('view', target))
          .map(([label, value, unit, target], i) =>
            h(
              'button',
              { className: `metric-card tone-${i}`, key: target, onClick: () => navigate(target) },
              h('span', null, label),
              h('strong', null, fmt(value), h('small', null, unit)),
              h('span', { className: 'metric-link' }, 'View details →'),
            ),
          ),
      ),
      h(
        'div',
        { className: 'section-heading' },
        h('h2', null, 'Your Fabric workspace'),
        h('p', null, 'Overview for a quick read. Sheet for the details.'),
      ),
      h(
        'section',
        { className: 'workspace-links' },
        Object.entries(pages)
          .filter(([key, p]) => !p.section && can('view', key))
          .map(([key, p], i) =>
            h(
              'button',
              { key, className: 'workspace-link', onClick: () => navigate(key) },
              h('span', { className: 'workspace-number' }, String(i + 1).padStart(2, '0')),
              h('div', null, h('strong', null, p.title), h('small', null, p.subtitle)),
              h('span', null, '↗'),
            ),
          ),
      ),
    );
  }
  const activeLiveError = liveProductionPage(page) ? productionError : liveError;
  if (new URLSearchParams(location.search).get('floor') === '1') {
    if (live && (!liveReady || productionError))
      return h(
        'section',
        null,
        h(
          'p',
          { role: productionError ? 'alert' : 'status' },
          productionError || 'Loading Production…',
        ),
        productionError && h('button', { onClick: refreshLive }, 'Retry'),
      );
    return can('view', 'productionUpdateTaskStatus')
      ? h(PortalTaskBoard, {
          data,
          actor,
          mode: 'floor',
          live: !!live,
          liveTasks: live ? productionTasks(data) : undefined,
          onCommit: live ? commitProduction : undefined,
          onImage: live ? production.image : undefined,
          canEdit: can('edit', 'productionUpdateTaskStatus'),
          onSave: (next) => {
            if (can('edit', 'productionUpdateTaskStatus')) save({ ...state, data: next });
          },
        })
      : h('section', { className: 'access-denied' }, h('h1', null, 'Access restricted'));
  }
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { className: `fabric-shell${sidebarOpen ? '' : ' sidebar-collapsed'}` },
      h(
        'aside',
        {
          id: 'workspace-sidebar',
          className: 'fabric-sidebar',
          hidden: !sidebarOpen,
          'aria-label': 'Workspace navigation',
        },
        h(
          'div',
          { className: 'sidebar-top' },
          h(
            'button',
            { className: 'fabric-brand', onClick: () => navigate('home') },
            h('span', null, 'G'),
            h('div', null, 'Garment workspace', h('small', null, 'Fabric pilot')),
          ),
        ),
        h(
          'div',
          { className: 'sidebar-navigation-scroll' },
          h(
            'nav',
            { className: 'overview-navigation', 'aria-label': 'Workspace overview' },
            h(
              'button',
              {
                'aria-current': page === 'home' ? 'page' : undefined,
                onClick: () => navigate('home'),
              },
              'Overview',
            ),
          ),
          h(
            'details',
            { open: true },
            h('summary', null, 'Fabric'),
            h(
              'nav',
              { 'aria-label': 'Fabric sections' },
              h(
                'button',
                {
                  'aria-current': page === 'fabricOverview' ? 'page' : undefined,
                  onClick: () => navigate('fabricOverview'),
                },
                'Fabric overview',
              ),
              Object.entries(pages)
                .filter(([key, p]) => !p.section && can('view', key))
                .map(([key, p]) =>
                  h(
                    'button',
                    {
                      key,
                      'aria-current': page === key ? 'page' : undefined,
                      onClick: () => navigate(key),
                    },
                    p.title,
                  ),
                ),
            ),
          ),
          Object.entries(pages).some(([key, p]) => p.section === 'colours' && can('view', key)) &&
            h(
              'details',
              { open: true, className: 'colour-nav' },
              h('summary', null, 'Colours'),
              h(
                'nav',
                { 'aria-label': 'Colour sections' },
                Object.entries(pages)
                  .filter(([key, p]) => p.section === 'colours' && can('view', key))
                  .map(([key, p]) =>
                    h(
                      'button',
                      {
                        key,
                        'aria-current': page === key ? 'page' : undefined,
                        onClick: () => navigate(key),
                      },
                      p.title,
                    ),
                  ),
              ),
            ),
          Object.entries(pages).some(
            ([key, p]) => p.section === 'production' && can('view', key),
          ) &&
            h(
              'details',
              { open: true, className: 'production-nav' },
              h('summary', null, 'Production'),
              h(
                'nav',
                { 'aria-label': 'Production pages' },
                Object.entries(pages)
                  .filter(
                    ([key, p]) =>
                      p.section === 'production' && !p.hiddenNavigation && can('view', key),
                  )
                  .sort(([a], [b]) => {
                    const rank = (key) =>
                      ['productionTaskBoard', 'productionUpdateTaskStatus'].includes(key)
                        ? ['productionTaskBoard', 'productionUpdateTaskStatus'].indexOf(key)
                        : 2;
                    return rank(a) - rank(b);
                  })
                  .map(([key, p]) =>
                    h(
                      'button',
                      {
                        key,
                        'aria-current': page === key ? 'page' : undefined,
                        onClick: () => navigate(key),
                      },
                      p.title,
                    ),
                  ),
              ),
            ),
          Object.entries(pages).some(([key, p]) => p.section === 'inventory' && can('view', key)) &&
            h(
              'details',
              { open: true, className: 'inventory-nav' },
              h('summary', null, 'Raw Material Inventory'),
              h(
                'nav',
                { 'aria-label': 'Raw Material Inventory pages' },
                Object.entries(pages)
                  .filter(([key, p]) => p.section === 'inventory' && can('view', key))
                  .map(([key, p]) =>
                    h(
                      'button',
                      {
                        key,
                        'aria-current': page === key ? 'page' : undefined,
                        onClick: () => navigate(key),
                      },
                      p.title,
                    ),
                  ),
              ),
            ),
          Object.entries(pages).some(
            ([key, p]) => p.section === 'miscellaneous' && can('view', key),
          ) &&
            h(
              'details',
              { open: true, className: 'miscellaneous-nav' },
              h('summary', null, 'Miscellaneous'),
              h(
                'nav',
                { 'aria-label': 'Miscellaneous pages' },
                Object.entries(pages)
                  .filter(([key, p]) => p.section === 'miscellaneous' && can('view', key))
                  .map(([key, p]) =>
                    h(
                      'button',
                      {
                        key,
                        'aria-current': page === key ? 'page' : undefined,
                        onClick: () => navigate(key),
                      },
                      p.title,
                    ),
                  ),
              ),
            ),
          otherModules.map((name) =>
            h(
              'details',
              { key: name },
              h('summary', null, name),
              h('p', { className: 'phase-note' }, 'Next phase · after Fabric'),
            ),
          ),
          can('view', 'employees') &&
            h(
              'details',
              { open: true, className: 'hr-nav' },
              h('summary', null, 'Employee / HR'),
              h(
                'nav',
                { 'aria-label': 'Employee / HR pages' },
                Object.entries(hrPages).map(([key, entry]) =>
                  h(
                    'button',
                    {
                      key,
                      'aria-current': page === key ? 'page' : undefined,
                      onClick: () => navigate(key),
                    },
                    entry.title,
                  ),
                ),
              ),
            ),
          isAdministrator(access, actor) &&
            h(
              'details',
              { open: true, className: 'admin-nav' },
              h('summary', null, 'Administration'),
              h(
                'nav',
                { 'aria-label': 'Administration pages' },
                Object.entries(adminPages)
                  .filter(([key]) => can('view', key))
                  .map(([key, label]) =>
                    h(
                      'button',
                      {
                        key,
                        'aria-current': page === key ? 'page' : undefined,
                        onClick: () => navigate(key),
                      },
                      label,
                    ),
                  ),
                h('a', { href: '/files-admin.html' }, 'Bucket groups'),
              ),
            ),
          h(
            'details',
            { open: true },
            h('summary', null, 'File Uploads'),
            h(
              'nav',
              { 'aria-label': 'File Uploads pages' },
              h('a', { href: '/files.html' }, 'Saved-record files'),
            ),
          ),
        ),
        h(AccountFooter, {
          name: access.users.find((user) => user.id === actor)?.name || 'My account',
          role: live
            ? live.administrator
              ? 'Administrator'
              : 'Signed-in employee'
            : 'Local preview',
          live: !!live,
          onCollapse: () => setSidebarOpen(false),
        }),
      ),
      h(
        'main',
        { className: 'fabric-main' },
        h(
          'div',
          { className: 'workspace-toolbar' },
          h(
            'button',
            {
              id: 'navigation-toggle',
              className: 'navigation-toggle',
              'aria-controls': 'workspace-sidebar',
              'aria-expanded': sidebarOpen,
              onClick: () => setSidebarOpen((open) => !open),
            },
            sidebarIcon(sidebarOpen),
            sidebarOpen ? 'Hide menu' : 'Show menu',
          ),
          h(
            'div',
            { className: 'workspace-toolbar-context' },
            h('span', null, 'Garment workspace'),
            h('small', null, 'Fabric pilot'),
          ),
        ),
        live
          ? h(
              'div',
              { className: 'access-info' },
              liveReady
                ? 'Signed in · Fabric, Colours and Production connected to Supabase'
                : 'Signed in · loading database records',
            )
          : h(
              'div',
              { className: 'access-preview' },
              h(
                'div',
                null,
                h('strong', null, 'ACCESS PREVIEW'),
                h('span', null, ' · test role behaviour; this is not a login'),
              ),
              h(
                'label',
                null,
                'Preview as',
                h(
                  'select',
                  {
                    'aria-label': 'Preview access as',
                    value: actor,
                    onChange: (e) => {
                      setActor(e.target.value);
                      setEditor(null);
                      setSelected(null);
                    },
                  },
                  access.users.map((u) =>
                    h(
                      'option',
                      { value: u.id, key: u.id },
                      `${u.name} · ${access.roles.find((r) => r.id === u.roleId)?.name}${u.active ? '' : ' · disabled'}`,
                    ),
                  ),
                ),
              ),
            ),
        live && Object.hasOwn(adminPages, page)
          ? h('section', null, h('a', { href: '/access.html#' + page }, 'Open live Administration'))
          : Object.hasOwn(hrPages, page)
            ? h(HRPanel, {
                key: page,
                page,
                access,
                actor,
                live,
                contactChoices: data.contacts || [],
                contactItems: data.contact_items || [],
              })
            : Object.hasOwn(adminPages, page)
              ? h(AdminPanel, { page, access, actor, onSave: saveAccess })
              : live && (!liveReady || activeLiveError)
                ? h(
                    'section',
                    null,
                    h(
                      'h2',
                      null,
                      activeLiveError ? 'Unable to load live records' : 'Loading database records…',
                    ),
                    activeLiveError && h('p', { role: 'alert' }, activeLiveError),
                    activeLiveError && h('button', { onClick: refreshLive }, 'Retry'),
                  )
                : live && page !== 'home' && page !== 'fabricOverview' && !connectedPage(page)
                  ? h(
                      'section',
                      null,
                      h('h2', null, 'This section is not connected yet'),
                      h('p', null, 'This module is awaiting its live backend connection.'),
                    )
                  : page === 'home'
                    ? h(OverviewPanel, {
                        data,
                        canView: (key) => can('view', key),
                        onNavigate: navigate,
                        live: !!live,
                      })
                    : page === 'fabricOverview'
                      ? fabricHome()
                      : !can('view')
                        ? h(
                            'section',
                            { className: 'access-denied' },
                            h('h1', null, 'Access restricted'),
                            h(
                              'p',
                              null,
                              'This page is not available to the selected preview role.',
                            ),
                          )
                        : page === 'productionJobs'
                          ? h(JobHistory, {
                              data,
                              onUpdate: () => navigate('productionUpdateTaskStatus'),
                              canUpdate: can('edit', 'productionJobs'),
                            })
                          : ['productionTaskBoard', 'productionUpdateTaskStatus'].includes(page)
                            ? h(PortalTaskBoard, {
                                key: page,
                                data,
                                live: !!live,
                                liveTasks: live ? productionTasks(data) : undefined,
                                onCommit: live ? commitProduction : undefined,
                                onImage: live ? production.image : undefined,
                                onStart: live
                                  ? async (part, employee) =>
                                      applyProduction(await production.start(data, part, employee))
                                  : undefined,
                                actor,
                                mode: page === 'productionTaskBoard' ? 'board' : 'update',
                                canEdit: can('edit'),
                                canCreate: can('create', 'productionJobs'),
                                onCreate: (next) => {
                                  if (live || !can('create', 'productionJobs')) return;
                                  save({ ...state, data: next });
                                },
                                onSave: (next) => {
                                  if (live || !can('edit')) return;
                                  save({ ...state, data: next });
                                },
                              })
                            : h(
                                React.Fragment,
                                null,
                                h(
                                  'header',
                                  { className: 'fabric-page-header' },
                                  h(
                                    'div',
                                    null,
                                    h(
                                      'p',
                                      { className: 'eyebrow' },
                                      (spec.section === 'colours'
                                        ? 'COLOURS / '
                                        : spec.section === 'production'
                                          ? 'PRODUCTION / '
                                          : spec.section === 'inventory'
                                            ? 'RAW MATERIAL INVENTORY / '
                                            : spec.section === 'miscellaneous'
                                              ? 'MISCELLANEOUS / '
                                              : 'FABRIC / ') + spec.title.toUpperCase(),
                                    ),
                                    h('h1', null, spec.title),
                                    h('p', null, spec.subtitle),
                                  ),
                                  h(
                                    'div',
                                    { className: 'fabric-view-toggle' },
                                    ['overview', 'sheet'].map((v) =>
                                      h(
                                        'button',
                                        {
                                          key: v,
                                          'aria-pressed': view === v,
                                          onClick: () => {
                                            setView(v);
                                            setSelected(null);
                                          },
                                        },
                                        v === 'overview' ? 'Overview' : 'Sheet',
                                      ),
                                    ),
                                  ),
                                ),
                                h(
                                  'div',
                                  { className: 'fabric-actions' },
                                  h('input', {
                                    type: 'search',
                                    'aria-label': 'Search ' + spec.title,
                                    placeholder:
                                      page === 'productionJobs'
                                        ? 'Scan QR / enter item style code…'
                                        : page === 'batches'
                                          ? 'Find a batch, fabric or bill…'
                                          : 'Search ' + spec.title.toLowerCase() + '…',
                                    value: query,
                                    onChange: (e) => {
                                      setQuery(e.target.value);
                                      setSelected(null);
                                    },
                                  }),
                                  !spec.readonly &&
                                    can('create') &&
                                    h(
                                      'button',
                                      { className: 'primary', onClick: () => edit(null) },
                                      spec.newLabel ||
                                        (page === 'suppliers'
                                          ? '+ Add supplier'
                                          : '+ New document'),
                                    ),
                                  !spec.readonly &&
                                    can('edit') &&
                                    view === 'sheet' &&
                                    h(
                                      'button',
                                      {
                                        disabled: !selected,
                                        onClick: () => edit(selected.documentId),
                                      },
                                      spec.master
                                        ? 'Edit selected record'
                                        : 'Edit selected document',
                                    ),
                                ),
                                page === 'materialStock' &&
                                  view === 'sheet' &&
                                  can('create', 'materialIssues') &&
                                  h(
                                    'button',
                                    {
                                      className: 'primary',
                                      disabled: !selected || selected.left <= 0,
                                      onClick: () => reconcile(selected.id),
                                    },
                                    'Reconcile selected stock',
                                  ),
                                h(
                                  'div',
                                  {
                                    className: 'fabric-status',
                                    role: 'status',
                                    'aria-live': 'polite',
                                  },
                                  notice,
                                  live && h('button', { onClick: refreshLive }, 'Refresh records'),
                                ),
                                records.length === 0 &&
                                  h(
                                    'div',
                                    { className: 'empty-state' },
                                    h('h2', null, 'Nothing here yet'),
                                    h(
                                      'p',
                                      null,
                                      query
                                        ? 'Try a different search.'
                                        : spec.master
                                          ? 'Add the first record to get started.'
                                          : 'Add the first document to get started.',
                                    ),
                                  ),
                                view === 'overview'
                                  ? overview()
                                  : h(
                                      React.Fragment,
                                      null,
                                      h(
                                        'div',
                                        { className: 'fabric-sort' },
                                        h(
                                          'label',
                                          null,
                                          'Sort complete rows by ',
                                          h(
                                            'select',
                                            {
                                              'aria-label': 'Sort column',
                                              value: preferences.sort?.key || spec.columns[0].key,
                                              onChange: (e) =>
                                                sorting(
                                                  e.target.value,
                                                  preferences.sort?.direction || 'asc',
                                                ),
                                            },
                                            spec.columns.map((c) =>
                                              h('option', { key: c.key, value: c.key }, c.label),
                                            ),
                                          ),
                                        ),
                                        h(
                                          'select',
                                          {
                                            'aria-label': 'Sort direction',
                                            value: preferences.sort?.direction || 'asc',
                                            onChange: (e) =>
                                              sorting(
                                                preferences.sort?.key || spec.columns[0].key,
                                                e.target.value,
                                              ),
                                          },
                                          h('option', { value: 'asc' }, 'Ascending'),
                                          h('option', { value: 'desc' }, 'Descending'),
                                        ),
                                        h('span', null, `${records.length} rows`),
                                      ),
                                      h(FabricSheet, {
                                        key: `${page}:${preferences.sort?.key}:${preferences.sort?.direction}:${sidebarOpen}`,
                                        page,
                                        spec,
                                        records,
                                        preferences,
                                        onPreferences: prefs,
                                        onSelect: setSelected,
                                        onNotice: setNotice,
                                        capabilities: {
                                          format: can('format'),
                                          export: can('export'),
                                          print: can('print'),
                                        },
                                      }),
                                    ),
                              ),
      ),
    ),
    editor &&
      h(
        editor.page === 'labDips'
          ? LabEditor
          : editor.page === 'materialContacts'
            ? ContactEditor
            : editor.page === 'productionItems'
              ? live
                ? ProductionItemEditor
                : ItemEditor
              : editor.page === 'productionJobs'
                ? JobEditor
                : BillEditor,
        {
          key: `${editor.page}:${editor.id || 'new'}`,
          page: editor.page,
          id: editor.sourceId || editor.id,
          mode: editor.mode,
          data: data,
          receiptId: editor.receiptId,
          reconciliation: editor.reconciliation,
          onSave: saveData,
          verifiers: live
            ? (data.dyed_bill_verifiers || []).filter((v) => v[editor.id ? 'edit' : 'create'])
            : access.users
                .filter(
                  (u) =>
                    u.active !== false &&
                    allowed(access, u.id, 'dyeBills', editor.id ? 'edit' : 'create'),
                )
                .map((u) => ({ id: u.id, label: `${u.name} · ${u.employeeCode || 'Preview'}` })),
          can,
          onClose: () => setEditor(null),
        },
      ),
  );
}
createRoot(document.getElementById('fabric-root')).render(
  new URLSearchParams(location.search).get('live') === '1' ||
    (import.meta.env.PROD && import.meta.env.VITE_DATA_MODE === 'supabase')
    ? h(WorkspaceGate, { render: (live) => h(App, { live }) })
    : h(App),
);
