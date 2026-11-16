import { contactsCommands } from '../miscellaneous/live.js';
import { AccessApp } from '../access/app.js';
import { FilesWorkspace } from '../files/app.js';
import {
  adminTabs,
  followWorkspaceLink,
  workspacePath,
  workspacePathPage,
} from '../access/workspace-routes.js';
import { OverviewTable } from './overview-table.js';
import { useGridSearch } from './grid-toolbar.js';
import {
  productionDocumentPath,
  productionDocumentRoutes,
  WorkspaceMenuToolbar,
  WorkspaceSidebar,
  useWorkspaceMenu,
} from '../access/navigation.js';
import { inventoryCommands, liveInventoryPage } from './inventory-live.js';
import { ProductionItemEditor } from '../production-task-board/item-editor.js';
import {
  productionCommands,
  productionTasks,
  mergeProductionSnapshot,
} from '../production-task-board/live.js';
import { liveProductionPage } from '../production-task-board/live-contract.js';
import { PortalTaskBoard } from '../production-task-board/portal';
import { JobHistory } from '../production-task-board/job-history';
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BillingCartons } from '../billing/cartons.js';
import { BillingReturns } from '../billing/returns.js';
import { BillingDispatch } from '../billing/dispatch.js';
import { BillingSummary } from '../billing/summary.js';
import { PackingLists } from '../billing/packing-lists.js';
import { BuyerPO } from '../billing/buyer-po.js';
import { BillingInvoices } from '../billing/invoices.js';
import { finishedGoodsPages } from '../finished-goods/pages.js';
import { FinishedGoods } from '../finished-goods/workspace.js';
import { pages } from './catalog.js';
import {
  initialFabric,
  validateFabric,
  fabricRows,
  fabricTotals,
  selectors,
  upgradeFabric,
} from './domain.js';
import { FabricSheet } from './sheet.js';
import {
  liveRecordNotice,
  RecordPageActions,
  RecordPageEmpty,
  RecordPageHeading,
  RecordPageStatus,
  WorkspaceConnectionBanner,
} from './record-page.js';
import { BillEditor } from './editor.js';
import './styles.css';
import { ProductionDocumentWorkspace } from '../production-documents/app.js';
import { adminPages, initialAccess, allowed, upgradeAccess } from '../admin/model.js';
import { AdminPanel } from '../admin/panel.js';
import { HRPanel } from '../hr/panel.js';
import { ContactEditor } from '../miscellaneous/contact-editor.js';
import { hrPages } from '../hr/model.js';
const h = React.createElement,
  STORE = 'garments-fabric-workspace-v1';
const fmt = (n) =>
  typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n;
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
const finishedGoodsPreviewPages = {
  sizes: 'stock',
  variations: 'sellable-summary',
  valuation: 'valuation',
  receipt: 'produced',
  adjustment: 'adjust',
  products: 'products',
  prices: 'prices',
  priceTypes: 'price-types',
};

const billingPages = {
  billingBuyerPO: BuyerPO,
  billingInvoices: BillingInvoices,
  billingPacking: PackingLists,
  billingDispatch: BillingDispatch,
  billingSummary: BillingSummary,
  billingCartons: BillingCartons,
  billingReturns: BillingReturns,
};

function workspaceRoute() {
  const params = new URLSearchParams(location.search);
  const finishedGoods = params.get('finishedGoods');
  const documentPage = location.pathname === productionDocumentPath;
  return {
    page: documentPage
      ? location.hash === '#worker-bills'
        ? 'jobWorkerBills'
        : 'productionChallans'
      : workspacePathPage(location) || pageFromHash(),
    finishedGoodsPage: Object.hasOwn(finishedGoodsPages, finishedGoods) ? finishedGoods : 'sizes',
    floor: location.pathname === '/fabric.html' && params.get('floor') === '1',
    task: params.get('task'),
  };
}

// Overview columns use the existing worksheet projections and record editor IDs.
const recordOverviewColumns = {
  yarnTypes: ['name', 'count', 'uses'],
  productionStatuses: ['name'],
  productionStageTypes: ['name'],
  productionPartTypes: ['name'],
  productionSizes: ['name', 'order'],
  productionProductTypes: ['name', 'gender'],
  productionDesigns: ['name'],
  productionFlags: ['name'],
  productionGenders: ['name'],
  brands: ['name', 'contact', 'purpose'],
  productionStages: ['name', 'abbr', 'order', 'type', 'track'],
  productionWorkers: ['name', 'contact', 'purpose', 'jobs'],
  productionItems: ['name', 'brand', 'product', 'season', 'batch_number'],
};

const productionOverviewLinks = {
  productionProductTypes: { gender: ['gender_id', 'productionGenders'] },
  brands: {
    contact: ['contacts_id', 'materialContacts'],
    purpose: ['contact_purpose_id', 'contactCategories'],
  },
  productionStages: { type: ['stage_type_id', 'productionStageTypes'] },
  productionWorkers: {
    contact: ['contacts_id', 'materialContacts'],
    purpose: ['contact_purpose_id', 'contactCategories'],
  },
  productionItems: {
    brand: ['brand_id', 'brands'],
    product: ['product_type_list_id', 'productionProductTypes'],
  },
};

function isManagementPage(page, live) {
  return live && workspacePath(page);
}

function App({ live, refreshWorkspaceAccess }) {
  const [billingInvoice, setBillingInvoice] = useState(null);
  const [billingPO, setBillingPO] = useState(null);
  const [billingTransport, setBillingTransport] = useState(null);
  const [billingFormalPO, setBillingFormalPO] = useState(null);
  const [{ page, finishedGoodsPage, floor, task }, setRoute] = useState(workspaceRoute);
  const [workspaceDataStarted, setWorkspaceDataStarted] = useState(
    () => !isManagementPage(page, live),
  );
  const routeHref = useRef(location.href);
  const [sidebarOpen, setSidebarOpen] = useWorkspaceMenu();
  const [access, setAccess] = useState(() => (live ? sessionAccessModel(live) : loadAccess())),
    [actor, setActor] = useState(live?.actor || 'owner');
  useEffect(() => {
    if (live) {
      setAccess(sessionAccessModel(live));
      setActor(live.actor);
    }
  }, [live]);
  const productionDocumentChanges = useMemo(() => new EventTarget(), [live?.actor]);
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
    [view, setView] = useState('overview'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(null),
    [editor, setEditor] = useState(null),
    [notice, setNotice] = useState('Local workspace · sample data · no live database writes');
  function syncRoute() {
    if (routeHref.current === location.href) return;
    routeHref.current = location.href;
    const next = workspaceRoute();
    setRoute(next);
    if (!isManagementPage(next.page, live)) setWorkspaceDataStarted(true);
    setQuery('');
    setSelected(null);
    setView('overview');
    setEditor(null);
  }
  useEffect(() => {
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);
  useEffect(() => {
    const titles = {
      jobWorkerBills: 'Worker bills',
      productionChallans: 'Production Challans',
      files: 'Files · Garment workspace',
      'files-admin': 'Bucket settings · Garment workspace',
    };
    document.title =
      live && Object.hasOwn(adminTabs, page)
        ? 'User management · Garment workspace'
        : titles[page] || 'Fabric · Garment workspace';
  }, [page, !!live]);
  const [liveReady, setLiveReady] = useState(!live),
    [liveError, setLiveError] = useState(''),
    [productionError, setProductionError] = useState(''),
    [inventoryError, setInventoryError] = useState(''),
    [contactsError, setContactsError] = useState('');
  const commands = useMemo(
    () => (live ? liveFabricCommands(getAccessClient(), createVerificationClient) : null),
    [Boolean(live)],
  );
  const production = useMemo(
    () => (live ? productionCommands(getAccessClient()) : null),
    [Boolean(live)],
  );
  const inventory = useMemo(
    () => (live ? inventoryCommands(getAccessClient()) : null),
    [Boolean(live)],
  );
  const contacts = useMemo(
    () => (live ? contactsCommands(getAccessClient()) : null),
    [Boolean(live)],
  );
  const connectedPage = (key) =>
    key === 'materialContacts' ||
    liveFabricPage(key) ||
    liveProductionPage(key) ||
    liveInventoryPage(key);
  const allowedModule = (check) =>
    live &&
    (live.administrator ||
      Object.entries(live.permissions || {}).some(([key, p]) => check(key) && p.view));
  async function loadLive() {
    const [fabricResult, productionResult, inventoryResult, contactsResult] =
      await Promise.allSettled([
        allowedModule(liveFabricPage) ? commands.load() : {},
        allowedModule(liveProductionPage) || can('view', 'productionJobs') ? production.load() : {},
        allowedModule(liveInventoryPage) ? inventory.load() : {},
        can('view', 'materialContacts') ? contacts.load() : {},
      ]);
    setLiveError(fabricResult.status === 'rejected' ? fabricResult.reason.message : '');
    setContactsError(contactsResult.status === 'rejected' ? contactsResult.reason.message : '');
    const contactData = contactsResult.status === 'fulfilled' ? contactsResult.value : {};
    setProductionError(
      productionResult.status === 'rejected' ? productionResult.reason.message : '',
    );
    const fabric = fabricResult.status === 'fulfilled' ? fabricResult.value : {};
    const workspace = productionResult.status === 'fulfilled' ? productionResult.value : {};
    setInventoryError(inventoryResult.status === 'rejected' ? inventoryResult.reason.message : '');
    const stock = inventoryResult.status === 'fulfilled' ? inventoryResult.value : {};
    const base = mergeProductionSnapshot(fabric, workspace);
    const employees = new Map((base.employee || []).map((row) => [row.id, row]));
    for (const row of stock.employee || [])
      employees.set(row.id, { ...employees.get(row.id), ...row });
    return {
      ...mergeProductionSnapshot(base, { ...stock, employee: [...employees.values()] }),
      ...contactData,
    };
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
    productionDocumentChanges.dispatchEvent(new Event('changed'));
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
          _live: true,
          dyed_bill_verifiers: snapshot.dyed_bill_verifiers || state.data.dyed_bill_verifiers || [],
        },
      }));
      setLiveReady(true);
      setNotice(liveRecordNotice);
    } catch (e) {
      setLiveReady(false);
      setLiveError(e.message);
    }
  }
  useEffect(() => {
    if (commands && workspaceDataStarted) void refreshLive();
  }, [commands, live, workspaceDataStarted]);
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
  const sheetQuery = useGridSearch(query);
  const overviewColumns = view === 'overview' ? recordOverviewColumns[page] : undefined;
  const recordQuery = view === 'sheet' ? sheetQuery : overviewColumns ? '' : query;
  const searchPlaceholder =
    page === 'productionJobs'
      ? 'Scan QR / enter item style code…'
      : page === 'batches'
        ? 'Find a batch, fabric or bill…'
        : 'Search ' + spec?.title.toLowerCase() + '…';
  const records = useMemo(
    () =>
      spec
        ? fabricRows(data, page).filter((r) =>
            Object.values(r).some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(recordQuery.toLowerCase()),
            ),
          )
        : [],
    [data, page, spec, recordQuery],
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
  function navigate(key, finishedGoods, floorUrl) {
    if (window.matchMedia('(max-width:700px)').matches) setSidebarOpen(false);
    const path = live && workspacePath(key);
    if (path || Object.hasOwn(productionDocumentRoutes, key) || floorUrl) {
      const url =
        floorUrl || path || productionDocumentPath + '#' + productionDocumentRoutes[key][1];
      if (location.pathname + location.search + location.hash !== url)
        history.pushState(null, '', url);
    } else {
      const url = new URL(location.href);
      if (url.pathname !== '/fabric.html') {
        url.pathname = '/fabric.html';
        url.search = live ? '?live=1' : '';
      }
      url.searchParams.delete('floor');
      url.searchParams.delete('task');
      if (finishedGoods) url.searchParams.set('finishedGoods', finishedGoods);
      url.hash = key === 'home' ? '' : key;
      if (url.href !== location.href) history.pushState(null, '', url);
    }
    syncRoute();
    setNotice(live ? liveRecordNotice : 'Local workspace · sample data · no live database writes');
  }
  function edit(id) {
    if (live && (!liveReady || !connectedPage(page))) return;
    if (!can(id && page === 'materialContacts' ? 'view' : id ? 'edit' : 'create')) {
      setNotice('Your role does not allow this action.');
      return;
    }
    setEditor({ page, id });
  }
  async function reloadContacts() {
    const snapshot = await contacts.load();
    setState((previous) => ({ ...previous, data: { ...previous.data, ...snapshot } }));
  }
  async function saveLiveContact(document) {
    const { savedBankIds, ...snapshot } = await contacts.save(document);
    setState((previous) => ({ ...previous, data: { ...previous.data, ...snapshot } }));
    setSelected(null);
    setNotice('Saved to Supabase · Contacts records refreshed');
    return savedBankIds;
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
        const { _saved_id, ...snapshot } = await production.saveSetup({
          resource: editor.page,
          before: state.data,
          after: next,
          id: editor.id,
        });
        await applyProduction(snapshot);
        setSelected(null);
        return _saved_id ?? editor.id;
      }
      if (liveInventoryPage(editor.page)) {
        const table = pages[editor.page].entity;
        const { row, lines } = await inventory.save({
          resource: editor.page,
          table,
          before: state.data,
          after: next,
          id: editor.id,
        });
        setState((previous) => {
          const rows = previous.data[table];
          return {
            ...previous,
            data: {
              ...previous.data,
              ...(lines
                ? {
                    raw_material_purchase_order_item: previous.data.raw_material_purchase_order_item
                      .filter((entry) => entry.raw_material_purchase_order_id !== row.id)
                      .concat(lines),
                  }
                : {}),
              [table]: rows.some((entry) => entry.id === row.id)
                ? rows.map((entry) => (entry.id === row.id ? row : entry))
                : [...rows, row],
            },
          };
        });
        setNotice('Inventory transaction saved to Supabase');
        setSelected(null);
        return row.id;
      }
      const resource = editor.page,
        root = fabricRoot(resource, state.data, next, editor),
        action = root.before ? 'edit' : 'create';
      const { _saved_id, ...snapshot } = assertLiveIdentifiers(
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
      setSelected(null);
      if (resource === 'labDips') {
        const version = next.lab_dip_version
          .filter((row) => row.lab_dip_id === root.id)
          .reduce((latest, row) => (!latest || row.version > latest.version ? row : latest), null);
        return snapshot.lab_dip_version.find(
          (row) => row.lab_dip_id === (_saved_id ?? root.id) && row.version === version?.version,
        )?.id;
      }
      return _saved_id ?? editor.id;
    } else if (save({ ...state, data: next }))
      setNotice(
        spec.master
          ? 'Details saved locally. Linked names and choices updated.'
          : 'Complete document saved locally. Linked balances and traceability updated.',
      );
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
    if (overviewColumns) {
      const links = productionOverviewLinks[page];
      const sources = new Map(links ? data[spec.entity].map((record) => [record.id, record]) : []);
      return h(OverviewTable, {
        key: actor + ':' + page,
        client: live ? getAccessClient() : null,
        grid: page === 'productionStatuses' ? 'overview-production-statuses' : 'overview-' + page,
        title: spec.title,
        records: groups.map(({ id, rows: [record] }) =>
          page === 'productionWorkers'
            ? { ...record, id, contact: record.name }
            : { ...record, id },
        ),
        getSearchText:
          page === 'productionStatuses' ? undefined : (record) => Object.values(record).join(' '),
        columns: overviewColumns.map((key) => ({
          accessorKey: key,
          header:
            page === 'productionWorkers' && key === 'contact'
              ? 'Company / contact'
              : spec.columns.find((column) => column.key === key).label,
          cell: ({ getValue, row }) => {
            const value = getValue();
            const relation = links?.[key];
            if (value && value !== '—' && value !== 'Not selected' && relation) {
              const [field, target] = relation;
              const record = sources.get(row.original.id);
              if (record?.[field] != null && can('view', target)) {
                return h(
                  'a',
                  {
                    href: '/fabric.html' + (live ? '?live=1' : '') + '#' + target,
                    onClick: (event) => followWorkspaceLink(event, () => navigate(target)),
                  },
                  value,
                );
              }
            }
            return page === 'productionStatuses'
              ? h('span', { className: 'erp-overview-status' }, value ?? '—')
              : (value ?? '—');
          },
        })),
        onOpen: can('edit') ? edit : undefined,
      });
    }

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
    if (page === 'materialContacts')
      return h(
        'section',
        { className: 'overview-grid' },
        groups.map((group, index) =>
          h(
            'article',
            { key: group.id, className: `overview-card tone-${index % 4}` },
            h('h2', null, group.title),
            h(
              'dl',
              { className: 'inventory-details' },
              spec.columns
                .slice(1)
                .map(({ key, label }) =>
                  h('div', { key }, h('dt', null, label), h('dd', null, group.rows[0][key] ?? '—')),
                ),
            ),
            h(
              'button',
              { className: 'open-document', onClick: () => edit(group.id) },
              can('edit') ? 'View/Edit →' : 'View →',
            ),
          ),
        ),
      );
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
  const activeLiveError =
    page === 'materialContacts'
      ? contactsError
      : liveInventoryPage(page)
        ? inventoryError
        : liveProductionPage(page)
          ? productionError
          : liveError;
  function renderFloor() {
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
          preferenceClient: live ? getAccessClient() : null,
          data,
          actor,
          key: task,
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
  const documentPage = Object.hasOwn(productionDocumentRoutes, page);
  const administrationPage = live && Object.hasOwn(adminTabs, page);
  const filesPage = page === 'files' || page === 'files-admin';
  function renderWorkspace() {
    if (administrationPage)
      return h(AccessApp, {
        key: actor,
        workspaceAccess: live,
        page,
        navigate,
        refreshWorkspaceAccess,
      });
    if (filesPage)
      return h(FilesWorkspace, {
        key: page,
        access: live,
        admin: page === 'files-admin',
        navigate,
      });
    if (!floor && !documentPage) {
      return h(
        React.Fragment,
        null,
        live
          ? h(WorkspaceConnectionBanner, { ready: liveReady })
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
        Object.hasOwn(adminPages, page)
          ? h(AdminPanel, { page, access, actor, onSave: saveAccess })
          : Object.hasOwn(hrPages, page)
            ? h(HRPanel, {
                key: page,
                page,
                access,
                actor,
                live,
                contactChoices: data.contacts || [],
                contactItems: data.contact_items || [],
                onContacts: can('view', 'materialContacts')
                  ? () => navigate('materialContacts')
                  : undefined,
              })
            : page === 'finishedProducts' || Object.hasOwn(billingPages, page)
              ? page !== 'finishedProducts'
                ? live && can('view', page)
                  ? h(billingPages[page], {
                      client: getAccessClient(),
                      key: actor + ':' + page,
                      canCreate: can('create', page),
                      canEdit: can('edit', page),
                      canDelete: can('delete', page),
                      canViewPacking: can('view', 'billingPacking'),
                      canViewCartons: can('view', 'billingCartons'),
                      canCreatePacking: can('create', 'billingPacking'),
                      openInvoices: can('view', 'billingInvoices')
                        ? () => navigate('billingInvoices')
                        : undefined,
                      canViewReturns: can('view', 'billingReturns'),
                      canCreateReturn:
                        can('view', 'billingReturns') && can('create', 'billingReturns'),
                      poToOpen: billingPO,
                      onPOOpened: () => setBillingPO(null),
                      openPO: can('view', 'billingBuyerPO')
                        ? (id) => {
                            setBillingPO(id);
                            navigate('billingBuyerPO');
                          }
                        : undefined,
                      transportToOpen: billingTransport,
                      onTransportOpened: () => setBillingTransport(null),
                      openTransport: can('view', 'billingDispatch')
                        ? (id) => {
                            setBillingTransport(id);
                            navigate('billingDispatch');
                          }
                        : undefined,
                      invoiceToOpen: billingInvoice,
                      formalPO: billingFormalPO,
                      onFormalPOOpened: () => setBillingFormalPO(null),
                      createInvoice: can('create', 'billingInvoices')
                        ? (id) => {
                            setBillingFormalPO(id ?? '');
                            navigate('billingInvoices');
                          }
                        : undefined,
                      onInvoiceOpened: () => setBillingInvoice(null),
                      openInvoice: can('view', 'billingInvoices')
                        ? (id) => {
                            setBillingInvoice(id);
                            navigate('billingInvoices');
                          }
                        : undefined,
                      capabilities: {
                        format: can('format', page),
                        export: can('export', page),
                        print: can('print', page),
                      },
                    })
                  : h(
                      'section',
                      { className: 'access-denied' },
                      h('h1', null, pages[page].title + ' access restricted'),
                    )
                : can('view', 'finishedProducts')
                  ? !live && Object.hasOwn(finishedGoodsPreviewPages, finishedGoodsPage)
                    ? h('iframe', {
                        title: finishedGoodsPages[finishedGoodsPage],
                        src:
                          './finished-goods-preview.html?page=' +
                          finishedGoodsPreviewPages[finishedGoodsPage],
                        sandbox: 'allow-scripts',
                        style: { width: '100%', minHeight: '80vh', border: 0 },
                      })
                    : h(FinishedGoods, {
                        client: live ? getAccessClient() : null,
                        key: actor + ':' + finishedGoodsPage,
                        screen: finishedGoodsPage,
                        canCreate: live && can('create'),
                        capabilities: {
                          format: can('format', 'finishedProducts'),
                          export: can('export', 'finishedProducts'),
                          print: can('print', 'finishedProducts'),
                        },
                      })
                  : h(
                      'section',
                      { className: 'access-denied' },
                      h('h1', null, 'Finished Goods access restricted'),
                    )
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
                                preferenceClient: live ? getAccessClient() : null,
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
                                onOpenFloor: (url) =>
                                  navigate('productionUpdateTaskStatus', undefined, url),
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
                                h(RecordPageHeading, {
                                  eyebrow:
                                    (spec.section === 'colours'
                                      ? 'COLOURS / '
                                      : spec.section === 'production'
                                        ? 'PRODUCTION / '
                                        : spec.section === 'inventory'
                                          ? 'RAW MATERIAL INVENTORY / '
                                          : spec.section === 'miscellaneous'
                                            ? 'MISCELLANEOUS / '
                                            : 'FABRIC / ') + spec.title.toUpperCase(),
                                  title: spec.title,
                                  description: spec.subtitle,
                                  view,
                                  action:
                                    overviewColumns && can('create')
                                      ? h(
                                          'button',
                                          { className: 'primary', onClick: () => edit(null) },
                                          spec.newLabel,
                                        )
                                      : overviewColumns
                                        ? null
                                        : undefined,
                                  onView: (mode) => {
                                    setView(mode);
                                    setSelected(null);
                                  },
                                }),
                                !overviewColumns &&
                                  h(
                                    RecordPageActions,
                                    {
                                      view,
                                      label: 'Search ' + spec.title,
                                      placeholder: searchPlaceholder,
                                      value: query,
                                      onSearch: (value) => {
                                        setQuery(value);
                                        setSelected(null);
                                      },
                                    },
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
                                      can(page === 'materialContacts' ? 'view' : 'edit') &&
                                      view === 'sheet' &&
                                      h(
                                        'button',
                                        {
                                          disabled:
                                            query !== sheetQuery ||
                                            !selected?.documentId ||
                                            !records.includes(selected),
                                          onClick: () => edit(selected.documentId),
                                        },
                                        page === 'materialContacts'
                                          ? can('edit')
                                            ? 'View/Edit'
                                            : 'View'
                                          : spec.master
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
                                h(RecordPageStatus, {
                                  notice,
                                  onRefresh: live ? refreshLive : undefined,
                                }),
                                view === 'overview' &&
                                  !overviewColumns &&
                                  records.length === 0 &&
                                  h(RecordPageEmpty, {
                                    query,
                                    prompt: spec.master
                                      ? 'Add the first record to get started.'
                                      : 'Add the first document to get started.',
                                  }),
                                view === 'overview'
                                  ? overview()
                                  : h(FabricSheet, {
                                      key: actor + ':' + page,
                                      page,
                                      spec,
                                      records,
                                      client: live ? getAccessClient() : null,
                                      preferences,
                                      onSelect: setSelected,
                                      onNotice: setNotice,
                                      capabilities: {
                                        format: can('format'),
                                        export: can('export'),
                                        print: can('print'),
                                      },
                                    }),
                              ),
      );
    }
    if (floor) return renderFloor();
    return can('view')
      ? null
      : h('section', { className: 'access-denied' }, h('h1', null, 'Access restricted'));
  }
  const shell = {
    'data-production-documents': documentPage ? '' : undefined,
    className: `fabric-shell${administrationPage || filesPage ? ' access-workspace' : ''}${sidebarOpen ? '' : ' sidebar-collapsed'}`,
  };
  const main = {
    className: filesPage
      ? 'access-live-shell files-live'
      : administrationPage
        ? 'access-live-shell'
        : 'fabric-main',
  };
  const sidebar = h(WorkspaceSidebar, {
    live,
    access,
    actor,
    page: floor ? 'productionUpdateTaskStatus' : page,
    finishedGoodsPage,
    open: sidebarOpen,
    onClose: () => setSidebarOpen(false),
    onPage: navigate,
    onWorkspaceLink: live ? navigate : undefined,
    onProductionDocument: navigate,
    onFinishedGoods: (key) => navigate('finishedProducts', key),
  });
  const toolbar = h(WorkspaceMenuToolbar, {
    open: sidebarOpen,
    onToggle: () => setSidebarOpen((open) => !open),
  });
  return h(
    React.Fragment,
    null,
    h(
      'div',
      shell,
      sidebar,
      h(
        'main',
        main,
        toolbar,
        documentPage && live && h(WorkspaceConnectionBanner, { ready: liveReady }),
        h(ProductionDocumentWorkspace, {
          key: live?.actor,
          page: documentPage ? page : null,
          can,
          changes: productionDocumentChanges,
          navigate,
        }),
        renderWorkspace(),
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
          canEditFiles: can('edit', editor.page),
          onFilesSaved: refreshLive,
          onSave: live && editor.page === 'materialContacts' ? saveLiveContact : saveData,
          onReload: live && editor.page === 'materialContacts' ? reloadContacts : undefined,
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
  location.pathname === productionDocumentPath ||
    workspacePathPage(location) ||
    new URLSearchParams(location.search).get('live') === '1' ||
    (import.meta.env.PROD && import.meta.env.VITE_DATA_MODE === 'supabase')
    ? h(WorkspaceGate, {
        render: (live, refreshWorkspaceAccess) => h(App, { live, refreshWorkspaceAccess }),
      })
    : h(App),
);
