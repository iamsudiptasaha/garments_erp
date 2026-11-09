import { TaskHandover } from './handover';
import Select from 'react-select';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type ExpandedState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDownUp,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  CircleHelp,
  Columns3,
  Factory,
  Filter as FilterIcon,
  Flag,
  GripVertical,
  History,
  LayoutGrid,
  List,
  MoreHorizontal,
  Package,
  Image as ImageIcon,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
  type DragEndEvent,
} from './components/kanban';
import {
  childRows,
  defaultOrder,
  fieldLabels,
  filterTasks,
  flagOptions,
  groupFields as defaultGroupFields,
  groupValue,
  mockTasks,
  people as defaultPeople,
  priorities,
  stages as defaultStages,
  statuses as defaultStatuses,
  type Filter,
  type GroupField,
  type Task,
} from './model';

type Mode = 'list' | 'table' | 'kanban';
type Config = {
  mode: Mode;
  grouping: GroupField[];
  visibility: VisibilityState;
  order: string[];
  sizing: ColumnSizingState;
  sorting: SortingState;
  filters: Filter[];
  search: string;
  cardFields: string[];
  collapsed: string[];
  expanded: ExpandedState;
};
type SavedView = { id: string; name: string; config: Config };
const storageKey = 'garments.production-studio.v1';
const initialConfig: Config = {
  mode: 'list',
  grouping: ['stage'],
  visibility: {
    image: false,
    stageType: false,
    style: false,
    part: false,
    pieces: false,
    worker: false,
    flags: false,
  },
  order: defaultOrder,
  sizing: {},
  sorting: [],
  filters: [],
  search: '',
  cardFields: ['status', 'assignee', 'priority', 'due', 'flags', 'progress'],
  collapsed: [],
  expanded: {},
};
function initialState() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (
      raw?.version === 1 &&
      Array.isArray(raw.tasks) &&
      raw.tasks.length === 50 &&
      raw.config &&
      Array.isArray(raw.views)
    )
      return raw;
  } catch {
    /* A disabled or full browser store never prevents local review. */
  }
  return { version: 1, tasks: mockTasks(), config: initialConfig, views: [] };
}
const people = defaultPeople;
const statusColors: Record<string, string> = {
  'Yet to start': '#8a8e9d',
  'In process': '#7862da',
  Complete: '#2caa83',
  Skipped: '#a0a7b6',
  Redo: '#e99542',
  Disputed: '#df637d',
};
function ItemImage({ task }: { task: Task }) {
  const [url, setUrl] = useState(task.imageUrl);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (task.resolveImage)
        void task
          .resolveImage()
          .then((value) => {
            if (active) setUrl(value);
          })
          .catch(() => {
            if (active) setUrl(undefined);
          });
    };
    load();
    const timer = setInterval(load, 50000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [task.resolveImage]);
  if (url)
    return (
      <img
        src={url}
        alt={`${task.style} item`}
        style={{ width: 80, height: 64, objectFit: 'contain' }}
      />
    );
  return (
    <div
      className="item-image-placeholder"
      role="img"
      aria-label={`${task.style}: ${task.imageAttachmentId ? 'Image attached; local preview unavailable' : 'No item image'}`}
    >
      <ImageIcon size={20} />
      <span>
        {task.imageAttachmentId ? 'Image attached · preview unavailable locally' : 'No item image'}
      </span>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className="status-pill"
      style={{ '--tone': statusColors[value] || '#7862da' } as React.CSSProperties}
    >
      <i />
      {value}
    </span>
  );
}
function Avatars({ names }: { names: string[] }) {
  return (
    <span className="avatar-stack">
      {names.length ? (
        names.map((name) => {
          const p = people.find((p) => p.name === name);
          return (
            <span
              key={name}
              className="avatar"
              title={name}
              style={{ background: p?.color || '#ede4ff' }}
            >
              {p?.initials ||
                name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
            </span>
          );
        })
      ) : (
        <span className="avatar unassigned" title="Unassigned">
          —
        </span>
      )}
    </span>
  );
}
function Priority({ value }: { value: string }) {
  return (
    <span className={`priority priority-${value.toLowerCase()}`}>
      <Flag size={12} />
      {value}
    </span>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <span className="progress-cell">
      <span className="progress-track">
        <i style={{ width: `${value}%` }} />
      </span>
      <small>{value}%</small>
    </span>
  );
}
function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`studio-modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function EditCell({
  value,
  label,
  options,
  onChange,
  type = 'text',
}: {
  value: string;
  label: string;
  options?: readonly string[];
  onChange: (v: string) => void;
  type?: string;
}) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  return options ? (
    <select
      className="cell-editor"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  ) : (
    <input
      className="cell-editor"
      aria-label={label}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft !== value) onChange(draft);
        cancelled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export type PortalBoardOptions = {
  tasks: Task[];
  actor: string;
  mode: 'board' | 'update' | 'floor';
  canEdit: boolean;
  onSave: (tasks: Task[]) => void;
  live?: boolean;
  onCommit?: (before: Task[], after: Task[]) => Promise<Task[]>;
};
export function ProductionStudio({ portal }: { portal?: PortalBoardOptions } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const storageKey = portal
    ? `garments.production-views.${portal.actor}`
    : 'garments.production-studio.v1';
  const [loaded] = useState(() => {
    if (!portal) return initialState();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.config && Array.isArray(saved.views)) return { ...saved, tasks: portal.tasks };
    } catch {
      /* Optional personal preferences. */
    }
    return { tasks: portal.tasks, config: initialConfig, views: [] };
  });
  const groupFields = defaultGroupFields.filter((f) => !portal?.live || f.id !== 'priority');
  const stages = portal?.tasks[0]?.stageOptions || (portal?.live ? [] : defaultStages);
  const statuses = portal?.tasks[0]?.statusOptions || defaultStatuses;
  const availableFlags = portal ? portal.tasks[0]?.flagOptions || [] : flagOptions;
  const people = (portal?.tasks[0]?.employeeNames || defaultPeople.map((p) => p.name)).map(
    (name) => ({
      name,
      initials: name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join(''),
      color: '#ede4ff',
    }),
  );
  const [tasks, setTasksState] = useState<Task[]>(loaded.tasks);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  async function commitTasks(next: Task[]) {
    if (portal && !portal.canEdit) throw Error('Your role does not allow production edits.');
    if (saving.current) throw Error('Wait for the current save to finish.');
    if (portal?.onCommit) {
      saving.current = true;
      setBusy(true);
      try {
        const saved = await portal.onCommit(tasks, next);
        setTasksState(saved);
        return;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    }
    setTasksState(next);
  }
  const setTasks: typeof setTasksState = (action) => {
    if (!portal?.onCommit) {
      if (portal && !portal.canEdit) {
        setToast('Your role does not allow production edits.');
        return;
      }
      setTasksState(action);
      return;
    }
    const next = typeof action === 'function' ? action(tasks) : action;
    void commitTasks(next).catch((e) => setToast(e.message));
  };
  useEffect(() => {
    if (portal?.live) setTasksState(portal.tasks);
  }, [portal?.tasks]);
  const previousTasks = useRef(tasks);
  const [config, setConfig] = useState<Config>({
    ...loaded.config,
    visibility: { ...loaded.config.visibility, ...(portal?.live ? { priority: false } : {}) },
    order: [
      ...loaded.config.order,
      ...defaultOrder.filter((id) => !loaded.config.order.includes(id)),
    ],
  });
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeView, setActiveView] = useState<string>('');
  const [panel, setPanel] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [toast, setToast] = useState('');
  const [saveName, setSaveName] = useState('');
  const [dragColumn, setDragColumn] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState('Overview');
  const [movement, setMovement] = useState<'advance' | 'rectify' | null>(null);
  const [target, setTarget] = useState('');
  const [operatorTask, setOperatorTask] = useState(
    new URLSearchParams(location.search).get('task') || 'production-1',
  );
  const screen = portal
    ? portal.mode === 'floor'
      ? 'qr'
      : portal.mode === 'update'
        ? 'update'
        : null
    : new URLSearchParams(location.search).get('screen');
  const standalone = screen === 'qr';
  const [storageWarning, setStorageWarning] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, ...(portal ? {} : { tasks }), config, views }),
      );
      if (portal && !portal.live && previousTasks.current !== tasks) {
        previousTasks.current = tasks;
        portal.onSave(tasks);
      }
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [tasks, config, views]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useLayoutEffect(() => {
    if (detail) drawerRef.current?.showModal();
  }, [detail]);
  const changeConfig = (patch: Partial<Config>) => setConfig((c) => ({ ...c, ...patch }));
  const notify = (message: string) => setToast(message);
  const patchTask = (id: string, patch: Partial<Task>) => {
    if (portal?.live && patch.priority) {
      notify('Priority is unavailable in the live database.');
      return;
    }
    if (portal && patch.due) {
      const t = tasks.find((t) => t.id === id);
      const started = t?.attempts.find((a) => a.id === t.currentJobId)?.started;
      if (started && patch.due < started) {
        notify('Due date cannot be before this job started.');
        return;
      }
    }
    setTasks((all) =>
      all.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              attempts: patch.status
                ? t.attempts.map((a) =>
                    a.id === t.currentJobId ? { ...a, status: patch.status! } : a,
                  )
                : t.attempts,
            }
          : t,
      ),
    );
  };
  const visibleTasks = useMemo(
    () => filterTasks(tasks, config.search, config.filters),
    [tasks, config.search, config.filters],
  );
  const current = tasks.find((t) => t.id === detail);
  const selectedIds = Object.keys(selection).filter(
    (id) => selection[id] && tasks.some((t) => t.id === id),
  );
  const openDetail = (id: string) => {
    setDetail(id);
    setDrawerTab('Overview');
    setMovement(null);
  };
  const editable = (t: Task, key: string) => {
    if (key === 'image') return <ItemImage task={t} />;
    if (t.kind === 'history')
      return (
        <span className="historical-value">
          {key === 'assignee' ? '—' : key === 'progress' ? '—' : groupValue(t, key)}
        </span>
      );
    if (key === 'status')
      return (
        <span className="status-edit">
          <Status value={t.status} />
          <EditCell
            label={`Status for ${t.id}`}
            value={t.status}
            options={statuses}
            onChange={(v) => patchTask(t.id, { status: v as Task['status'] })}
          />
        </span>
      );
    if (key === 'assignee')
      return (
        <span className="assignee-edit">
          <Avatars names={t.assignees} />
          <select
            aria-label={`Lead assignee for ${t.id}`}
            value={t.assignees[0] || ''}
            onChange={(e) =>
              patchTask(t.id, {
                assignees: e.target.value
                  ? [e.target.value, ...t.assignees.slice(1).filter((n) => n !== e.target.value)]
                  : [],
              })
            }
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </span>
      );
    if (key === 'priority' && portal?.live) return <span>—</span>;
    if (key === 'priority')
      return (
        <span className="priority-edit">
          <Priority value={t.priority} />
          <EditCell
            label={`Priority for ${t.id}`}
            value={t.priority}
            options={priorities}
            onChange={(v) => patchTask(t.id, { priority: v as Task['priority'] })}
          />
        </span>
      );
    if (key === 'stage')
      return (
        <button
          className="stage-cell"
          title="Open production to advance or rectify"
          onClick={() => openDetail(t.id)}
        >
          {t.stage}
          <ChevronRight size={12} />
        </button>
      );
    if (key === 'due')
      return (
        <EditCell
          label={`Due date for ${t.id}`}
          type="date"
          value={t.due}
          onChange={(v) => patchTask(t.id, { due: v })}
        />
      );
    if (key === 'progress') return <Progress value={t.progress} />;
    if (key === 'flags')
      return (
        <span className="flag-list">
          {t.flags.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </span>
      );
    return <span>{groupValue(t, key)}</span>;
  };
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: 'select',
        size: 42,
        minSize: 42,
        maxSize: 42,
        enableResizing: false,
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all visible productions"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) =>
          row.original.kind === 'history' ? null : (
            <input
              type="checkbox"
              aria-label={`Select ${row.original.name}`}
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
            />
          ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Production / item part',
        size: 350,
        minSize: 260,
        enableHiding: false,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className={`task-name ${t.kind === 'history' ? 'attempt-row' : ''}`}>
              {t.kind !== 'history' ? (
                <button
                  className="expand-task"
                  aria-label={`Expand jobs for ${t.id}`}
                  aria-expanded={row.getIsExpanded()}
                  onClick={row.getToggleExpandedHandler()}
                >
                  {row.getIsExpanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <History size={13} />
              )}
              <span
                className={`task-symbol symbol-${t.brand === 'Mora' ? 'coral' : t.brand === 'Northline' ? 'blue' : 'purple'}`}
              >
                {t.kind === 'history' ? <Check size={11} /> : <Package size={13} />}
              </span>
              <button className="task-title" onClick={() => openDetail(t.parentId || t.id)}>
                {t.name}
                <small>
                  {t.kind === 'history'
                    ? t.attempts.length === 0
                      ? 'Historical job attempt'
                      : ''
                    : t.style}
                </small>
              </button>
              {t.kind !== 'history' && (
                <span className="subtask-count" title="Historical job attempts">
                  {t.attempts.length - 1}
                </span>
              )}
            </div>
          );
        },
      },
      ...[
        'status',
        'stage',
        'stageType',
        'image',
        'assignee',
        'priority',
        'due',
        'progress',
        'brand',
        'part',
        'style',
        'pieces',
        'flags',
        'worker',
      ].map((key) => ({
        id: key,
        accessorFn: (t: Task) =>
          key === 'assignee'
            ? t.assignees[0] || 'Unassigned'
            : key === 'stageType'
              ? groupValue(t, key)
              : t[key as keyof Task],
        header: fieldLabels[key],
        size:
          key === 'status'
            ? 160
            : key === 'stage'
              ? 180
              : key === 'assignee'
                ? 125
                : key === 'flags'
                  ? 200
                  : 135,
        minSize: 90,
        cell: ({ row }: { row: Row<Task> }) => editable(row.original, key),
      })),
      // Cell renderers read the current edit callbacks; no data is copied into view state.
    ],
    [tasks],
  );
  const table = useReactTable({
    data: visibleTasks,
    columns,
    state: {
      grouping: config.grouping,
      columnVisibility: config.visibility,
      columnOrder: config.order,
      columnSizing: config.sizing,
      sorting: config.sorting,
      expanded: config.expanded,
      rowSelection: selection,
    },
    getRowId: (t) => t.id,
    getSubRows: childRows,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    groupedColumnMode: false,
    columnResizeMode: 'onChange',
    enableRowSelection: (row) => !row.getIsGrouped() && row.original.kind !== 'history',
    onRowSelectionChange: setSelection,
    onExpandedChange: (up) =>
      setConfig((c) => ({ ...c, expanded: typeof up === 'function' ? up(c.expanded) : up })),
    onColumnSizingChange: (up) =>
      setConfig((c) => ({ ...c, sizing: typeof up === 'function' ? up(c.sizing) : up })),
    onSortingChange: (up) =>
      setConfig((c) => ({ ...c, sorting: typeof up === 'function' ? up(c.sorting) : up })),
    onColumnVisibilityChange: (up) =>
      setConfig((c) => ({ ...c, visibility: typeof up === 'function' ? up(c.visibility) : up })),
    onColumnOrderChange: (up) =>
      setConfig((c) => ({ ...c, order: typeof up === 'function' ? up(c.order) : up })),
  });
  const leaves = table.getVisibleLeafColumns();
  const toggleCollapse = (key: string) =>
    changeConfig({
      collapsed: config.collapsed.includes(key)
        ? config.collapsed.filter((x) => x !== key)
        : [...config.collapsed, key],
    });
  const renderRows = (rows: Row<Task>[], depth = 0): ReactNode =>
    rows.map((row) => {
      if (row.getIsGrouped()) {
        const closed = config.collapsed.includes(row.id);
        const members = row.getLeafRows().filter((r) => r.original.kind !== 'history');
        return (
          <tbody className={`group-body group-depth-${depth}`} key={row.id}>
            <tr className="group-row">
              <td colSpan={leaves.length}>
                <button
                  aria-expanded={!closed}
                  onClick={() => toggleCollapse(row.id)}
                  style={{ paddingLeft: depth * 22 }}
                >
                  {closed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span
                    className="group-dot"
                    style={{
                      background:
                        statusColors[String(row.groupingValue)] ||
                        ['#8b75dc', '#59a6be', '#d69d57'][depth % 3],
                    }}
                  />
                  <strong>{String(row.groupingValue)}</strong>
                  <span className="group-count">{members.length}</span>
                  <small>{fieldLabels[row.groupingColumnId || '']}</small>
                </button>
              </td>
            </tr>
            {!closed && (
              <tr className="nested-rows">
                <td colSpan={leaves.length}>
                  <table className="nested-table" style={{ width: table.getTotalSize() }}>
                    <colgroup>
                      {leaves.map((c) => (
                        <col key={c.id} style={{ width: c.getSize() }} />
                      ))}
                    </colgroup>
                    {renderRows(row.subRows, depth + 1)}
                  </table>
                </td>
              </tr>
            )}
          </tbody>
        );
      }
      return (
        <tbody key={row.id}>
          <tr
            className={`data-row ${row.original.kind === 'history' ? 'history-row' : ''} ${row.getIsSelected() ? 'selected' : ''}`}
            data-task={row.original.id}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
          {row.getIsExpanded() && row.subRows.length > 0 && (
            <tr className="nested-rows">
              <td colSpan={leaves.length}>
                <table className="nested-table" style={{ width: table.getTotalSize() }}>
                  <colgroup>
                    {leaves.map((c) => (
                      <col key={c.id} style={{ width: c.getSize() }} />
                    ))}
                  </colgroup>
                  {renderRows(row.subRows, depth)}
                </table>
              </td>
            </tr>
          )}
        </tbody>
      );
    });
  const reorder = (from: string, to: string) => {
    if (from === 'select' || to === 'select' || from === to) return;
    const order = [...config.order];
    order.splice(order.indexOf(from), 1);
    order.splice(order.indexOf(to), 0, from);
    changeConfig({ order });
  };
  const kanbanField = config.grouping[0] || 'status';
  const laneNames =
    kanbanField === 'stage'
      ? stages.filter((stage) => tasks.some((task) => task.stage === stage))
      : kanbanField === 'status'
        ? [...statuses]
        : kanbanField === 'priority'
          ? [...priorities]
          : [...new Set(tasks.map((t) => groupValue(t, kanbanField)))];
  const kanbanData = visibleTasks.map((t) => ({ ...t, column: groupValue(t, kanbanField) }));
  if (config.sorting.length)
    kanbanData.sort((a, b) => {
      for (const s of config.sorting) {
        const av = groupValue(a, s.id),
          bv = groupValue(b, s.id);
        const result =
          s.id === 'progress' || s.id === 'pieces' ? Number(av) - Number(bv) : av.localeCompare(bv);
        if (result) return s.desc ? -result : result;
      }
      return 0;
    });
  const onCardDrop = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || (portal && !portal.canEdit)) return;
    const t = tasks.find((t) => t.id === active.id);
    if (!t) return;
    const overTask = tasks.find((t) => t.id === over.id);
    const destination = overTask ? groupValue(overTask, kanbanField) : String(over.id);
    if (!laneNames.includes(destination)) return;
    if (destination !== groupValue(t, kanbanField)) {
      if (kanbanField === 'stage') {
        openDetail(t.id);
        setMovement(stages.indexOf(destination) > stages.indexOf(t.stage) ? 'advance' : 'rectify');
        setTarget(destination);
        notify('Complete all variant quantities and select your name before handing over.');
        return;
      }
      if (kanbanField === 'brand' || kanbanField === 'part' || kanbanField === 'stageType') {
        notify(
          'This grouping is derived from the linked item or stage. Change the current stage to move production.',
        );
        return;
      }
      if (kanbanField === 'assignee')
        patchTask(t.id, {
          assignees:
            destination === 'Unassigned'
              ? []
              : [destination, ...t.assignees.filter((n) => n !== destination)],
        });
      else patchTask(t.id, { [kanbanField]: destination } as Partial<Task>);
    }
    if (portal?.live) return;
    if (config.sorting.length) {
      notify('Field updated. Clear sorting to keep a manual card order.');
      return;
    }
    setTasks((all) => {
      const copy = [...all];
      const from = copy.findIndex((x) => x.id === active.id);
      const [moved] = copy.splice(from, 1);
      const index = copy.findIndex((x) => x.id === over.id);
      copy.splice(index < 0 ? copy.length : index, 0, moved);
      return copy;
    });
  };
  const saveView = () => {
    if (!saveName.trim()) return;
    const id = crypto.randomUUID();
    setViews((v) => [...v, { id, name: saveName.trim(), config: structuredClone(config) }]);
    setActiveView(id);
    setPanel(null);
    setSaveName('');
    notify('View saved on this browser.');
  };
  const applyView = (id: string) => {
    const v = views.find((v) => v.id === id);
    if (v) {
      setConfig(structuredClone(v.config));
      setActiveView(id);
      setSelection({});
      notify(`Opened ${v.name}`);
    }
  };
  const addFilter = () =>
    changeConfig({
      filters: [
        ...config.filters,
        { id: crypto.randomUUID(), field: 'status', operator: 'is', value: 'In process' },
      ],
    });
  const updateFilter = (id: string, patch: Partial<Filter>) =>
    changeConfig({ filters: config.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const bulkPatch = (patch: Partial<Task>) => {
    if (portal?.live && patch.priority) {
      notify('Priority is unavailable in the live database.');
      return;
    }
    void commitTasks(tasks.map((t) => (selectedIds.includes(t.id) ? { ...t, ...patch } : t)))
      .then(() => notify(`Updated ${selectedIds.length} productions`))
      .catch((e) => notify(e.message));
  };
  const chooseStage = (destination: string) => {
    if (!current || destination === current.stage) return;
    if (portal && !portal.canEdit) {
      notify('Your role does not allow production edits.');
      return;
    }
    setTarget(destination);
    setMovement(
      stages.indexOf(destination) > stages.indexOf(current.stage) ? 'advance' : 'rectify',
    );
  };
  const saveHandover = async (updated: Task) => {
    await commitTasks(tasks.map((t) => (t.id === updated.id ? updated : t)));
    notify(
      portal?.live
        ? 'Handover saved to the database.'
        : 'Handover recorded locally. All views updated.',
    );
  };
  const operatorCurrent =
    tasks.find((t) => t.id === operatorTask) || (standalone ? undefined : tasks[0]);
  if ((screen === 'update' || standalone) && !operatorCurrent)
    return (
      <section>
        <h2>{standalone && tasks.length ? 'Task unavailable' : 'No production tasks yet'}</h2>
        <p>
          {standalone && tasks.length
            ? 'Check the task link before entering quantities.'
            : 'Set up an item and stages, then use Start production.'}
        </p>
      </section>
    );
  if ((screen === 'update' || standalone) && operatorCurrent)
    return (
      <div className="operator-page">
        {!standalone && (
          <aside className="operator-nav">
            <a href={portal ? '/fabric.html#productionTaskBoard' : '/production-prototype.html'}>
              Production / Task Board
            </a>
            <strong>Update Task Status</strong>
            {!portal && (
              <a href={`/production-prototype.html?screen=qr&task=${operatorCurrent.id}`}>
                Open standalone QR preview ↗
              </a>
            )}
          </aside>
        )}
        <main className="operator-page-main">
          <div className="operator-page-label">
            {standalone ? 'SAHA · Production handover' : 'Production / Update Task Status'}
            <span>
              {portal?.live ? 'LIVE PRODUCTION' : portal ? 'LOCAL WORKSPACE' : 'LOCAL MOCKUP'}
            </span>
          </div>
          <TaskHandover
            key={operatorCurrent.id}
            task={operatorCurrent}
            tasks={standalone ? undefined : tasks}
            onTask={setOperatorTask}
            onSubmit={saveHandover}
            readOnly={portal && !portal.canEdit}
          />
        </main>
      </div>
    );
  const totalPieces = tasks.reduce((n, t) => n + t.pieces, 0);
  const progress = tasks.length
    ? Math.round(tasks.reduce((n, t) => n + t.progress, 0) / tasks.length)
    : 0;
  return (
    <div aria-busy={busy} className="studio-shell">
      <aside className="studio-sidebar">
        <a
          href={portal ? '/fabric.html#productionTaskBoard' : '/production-prototype.html'}
          className="studio-brand"
        >
          <span>
            <Factory size={21} />
          </span>
          <div>
            SAHA<small>PRODUCTION</small>
          </div>
        </a>
        <div className="workspace-select">
          <span className="workspace-logo">S</span>
          <div>
            Saha Creations<small>Garments workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <button
          className="side-link"
          onClick={() => {
            setPanel('help');
          }}
        >
          <LayoutGrid size={17} /> Overview
        </button>
        <button
          className="side-link active"
          onClick={() => {
            changeConfig({ search: '', filters: [] });
          }}
        >
          <LayersIcon /> Task Board<span>{tasks.length}</span>
        </button>
        <button
          className="side-link"
          onClick={() => {
            setPanel('schema');
          }}
        >
          <Package size={17} /> Items & parts<small>10</small>
        </button>
        {!portal && (
          <a
            className="side-link"
            href="/production-prototype.html?screen=update&task=production-1"
          >
            <Check size={17} /> Update Task Status
          </a>
        )}
        <div className="sidebar-label saved-label">
          SAVED VIEWS
          <button
            title="Save current view"
            aria-label="Save current view"
            onClick={() => setPanel('save')}
          >
            <Plus size={14} />
          </button>
        </div>
        {views.length ? (
          views.map((v) => (
            <div className="saved-view-row" key={v.id}>
              <button
                className={`saved-link ${activeView === v.id ? 'active' : ''}`}
                onClick={() => applyView(v.id)}
              >
                <span className="saved-dot" />
                {v.name}
              </button>
              <button
                title={`Delete ${v.name}`}
                aria-label={`Delete view ${v.name}`}
                onClick={() => {
                  setViews((all) => all.filter((x) => x.id !== v.id));
                  if (activeView === v.id) setActiveView('');
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))
        ) : (
          <p className="no-saved">
            Your workspace, your way.
            <br />
            Save a view to keep it here.
          </p>
        )}
        <div className="sidebar-season">
          <span className="season-dot" />
          Winter / Holiday 2026<small>Current production season</small>
        </div>
        <div className="sidebar-bottom">
          <div className="prototype-note">
            <Sparkles size={16} />
            <div>
              Room to experiment<small>50 mock productions. Local only.</small>
            </div>
          </div>
          <button className="side-link" onClick={() => setPanel('help')}>
            <CircleHelp size={17} /> Guide & shortcuts
          </button>
          <div className="profile">
            <span className="avatar" style={{ background: '#e5dcff' }}>
              SS
            </span>
            <div>
              Sudipta Saha<small>Workspace owner</small>
            </div>
            <ChevronsLeft size={15} />
          </div>
        </div>
      </aside>
      <main className="studio-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} /> Operations <ChevronRight size={13} />
            <span>Production</span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <i />
              {portal ? 'LOCAL WORKSPACE' : 'LOCAL PROTOTYPE'}
            </span>
            <button
              title="Prototype guide"
              aria-label="Prototype guide"
              onClick={() => setPanel('help')}
            >
              <CircleHelp size={17} />
            </button>
            <button
              title="Production alerts"
              aria-label="Production alerts"
              onClick={() => {
                changeConfig({
                  filters: [{ id: 'alerts', field: 'status', operator: 'is', value: 'Disputed' }],
                });
                notify('Showing disputed productions.');
              }}
            >
              <Bell size={17} />
            </button>
            <span className="avatar" style={{ background: '#e5dcff' }}>
              SS
            </span>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">THE PRODUCTION FLOOR, IN FOCUS</div>
            <h1>Task Board {!portal && <span className="heading-tag">Winter ’26</span>}</h1>
            <p>Every part. Every stage. One shared picture.</p>
          </div>
          <div className="heading-actions">
            <Avatars names={people.slice(0, 4).map((p) => p.name)} />
            <span className="team-label">Production team</span>
            <button className="outline-button" onClick={() => setPanel('schema')}>
              <History size={15} /> Model & workflow
            </button>
          </div>
        </section>
        <section className="stats-strip">
          <div>
            <span className="stat-icon purple">
              <Package size={17} />
            </span>
            <div>
              <strong>{tasks.length}</strong>
              <small>Active productions</small>
            </div>
            <span className="stat-context">
              {portal
                ? `${new Set(tasks.map((t) => t.style)).size} styles · ${new Set(tasks.map((t) => t.part)).size} parts`
                : '10 styles · 5 parts'}
            </span>
          </div>
          <div>
            <span className="stat-icon blue">
              <Factory size={17} />
            </span>
            <div>
              <strong>{totalPieces.toLocaleString('en-IN')}</strong>
              <small>Planned pieces</small>
            </div>
          </div>
          <div>
            <span className="stat-icon amber">
              <Flag size={17} />
            </span>
            <div>
              <strong>
                {tasks.filter((t) => t.status === 'Disputed' || t.status === 'Redo').length}
              </strong>
              <small>Need attention</small>
            </div>
            <button
              onClick={() =>
                changeConfig({
                  filters: [
                    { id: 'attention', field: 'status', operator: 'is', value: 'Disputed' },
                  ],
                })
              }
            >
              Review <ArrowRight size={12} />
            </button>
          </div>
          <div>
            <span className="stat-icon green">
              <Check size={17} />
            </span>
            <div>
              <strong>{progress}%</strong>
              <small>Average progress</small>
            </div>
            <Progress value={progress} />
          </div>
        </section>
        <section className="views-bar">
          <div className="view-tabs" role="tablist" aria-label="Production views">
            {(
              [
                { id: 'list', label: 'List', icon: List },
                { id: 'table', label: 'Table', icon: Table2 },
                { id: 'kanban', label: 'Kanban', icon: Columns3 },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={config.mode === v.id}
                className={config.mode === v.id ? 'active' : ''}
                onClick={() => changeConfig({ mode: v.id })}
              >
                <v.icon size={16} />
                {v.label}
              </button>
            ))}
          </div>
          <div className="view-actions">
            <span className="shared-indicator">
              <i />
              Shared data across views
            </span>
            {!portal && (
              <button onClick={() => setPanel('save')}>
                <Plus size={14} /> Save view
              </button>
            )}
          </div>
        </section>
        <section className="toolbar">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search productions"
              placeholder="Search productions…"
              value={config.search}
              onChange={(e) => changeConfig({ search: e.target.value })}
            />
            {config.search && (
              <button aria-label="Clear search" onClick={() => changeConfig({ search: '' })}>
                <X size={13} />
              </button>
            )}
          </label>
          <span className="toolbar-divider" />
          <button
            className={config.filters.length ? 'is-applied' : ''}
            onClick={() => setPanel('filters')}
          >
            <FilterIcon size={15} /> Filter
            {config.filters.length > 0 && <b>{config.filters.length}</b>}
          </button>
          <button
            className={config.grouping.length ? 'is-applied' : ''}
            onClick={() => setPanel('group')}
          >
            <LayoutGrid size={15} /> Group
            {config.grouping.length > 0 && <span>{config.grouping.length}</span>}
          </button>
          <button
            className={config.sorting.length ? 'is-applied' : ''}
            onClick={() => setPanel('sort')}
          >
            <ArrowDownUp size={15} /> Sort
            {config.sorting.length > 0 && <span>{config.sorting.length}</span>}
          </button>
          <div className="toolbar-spacer" />
          <span className="result-count">{visibleTasks.length} productions</span>
          <button onClick={() => setPanel('fields')}>
            <SlidersHorizontal size={15} />
            {config.mode === 'kanban' ? 'Card fields' : 'Columns'}
          </button>
          <button aria-label="View options" onClick={() => setPanel('options')}>
            <MoreHorizontal size={18} />
          </button>
        </section>
        {(config.filters.length > 0 || config.search) && (
          <div className="filter-chips">
            {config.search && (
              <span>
                Search: {config.search}
                <button aria-label="Remove search" onClick={() => changeConfig({ search: '' })}>
                  <X size={11} />
                </button>
              </span>
            )}
            {config.filters.map((f) => (
              <span key={f.id}>
                {fieldLabels[f.field]} {f.operator} {f.value}
                <button
                  aria-label={`Remove filter ${f.id}`}
                  onClick={() =>
                    changeConfig({ filters: config.filters.filter((x) => x.id !== f.id) })
                  }
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <button onClick={() => changeConfig({ filters: [], search: '' })}>Clear all</button>
          </div>
        )}
        {selectedIds.length > 0 && (
          <div className="bulk-bar">
            <strong>{selectedIds.length} selected</strong>
            <select
              aria-label="Bulk status"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) bulkPatch({ status: e.target.value as Task['status'] });
                e.target.value = '';
              }}
            >
              <option value="">Set status…</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {!portal?.live && (
              <select
                aria-label="Bulk priority"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) bulkPatch({ priority: e.target.value as Task['priority'] });
                  e.target.value = '';
                }}
              >
                <option value="">Set priority…</option>
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            )}
            <button onClick={() => setSelection({})}>
              Clear selection
              <X size={12} />
            </button>
          </div>
        )}
        {visibleTasks.length === 0 ? (
          <div className="empty-state">
            <Search size={32} />
            <h2>No productions found</h2>
            <p>Try a different style, assignee or filter.</p>
            <button
              className="primary-button"
              onClick={() => changeConfig({ filters: [], search: '' })}
            >
              Clear filters
            </button>
          </div>
        ) : config.mode !== 'kanban' ? (
          <div className={`grid-scroll ${config.mode}`}>
            <table className="production-grid" style={{ width: table.getTotalSize() }}>
              <colgroup>
                {leaves.map((c) => (
                  <col key={c.id} style={{ width: c.getSize() }} />
                ))}
              </colgroup>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{ width: header.getSize() }}
                        draggable={header.id !== 'select'}
                        onDragStart={(e) => {
                          setDragColumn(header.column.id);
                          e.dataTransfer.setData('text/plain', header.column.id);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          reorder(
                            dragColumn || e.dataTransfer.getData('text/plain'),
                            header.column.id,
                          );
                          setDragColumn(null);
                        }}
                      >
                        <div className="column-heading">
                          {header.id === 'select' ? (
                            flexRender(header.column.columnDef.header, header.getContext())
                          ) : (
                            <button
                              title="Click to sort; Shift-click to add a sort. Drag to rearrange."
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              <GripVertical className="column-grip" size={11} />
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getIsSorted() ? (
                                <span>
                                  {header.column.getIsSorted() === 'desc' ? '↓' : '↑'}
                                  {config.sorting.length > 1
                                    ? header.column.getSortIndex() + 1
                                    : ''}
                                </span>
                              ) : null}
                            </button>
                          )}
                        </div>
                        {header.column.getCanResize() && (
                          <div
                            className={`column-resizer ${header.column.getIsResizing() ? 'resizing' : ''}`}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${fieldLabels[header.column.id]}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              header.getResizeHandler()(e);
                            }}
                            tabIndex={0}
                            aria-valuenow={header.getSize()}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                                e.preventDefault();
                                changeConfig({
                                  sizing: {
                                    ...config.sizing,
                                    [header.column.id]: Math.max(
                                      header.column.columnDef.minSize || 90,
                                      header.getSize() + (e.key === 'ArrowRight' ? 10 : -10),
                                    ),
                                  },
                                });
                              }
                            }}
                            onTouchStart={header.getResizeHandler()}
                            onDoubleClick={() => header.column.resetSize()}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              {renderRows(table.getGroupedRowModel().rows)}
            </table>
          </div>
        ) : (
          <div className="kanban-scroll">
            <KanbanProvider
              columns={laneNames.map((name) => ({ id: name, name }))}
              data={kanbanData}
              onDragEnd={onCardDrop}
              className="production-kanban"
            >
              {(column) => {
                const closed = config.collapsed.includes(`lane:${column.id}`);
                const laneTasks = kanbanData.filter((t) => t.column === column.id);
                return (
                  <KanbanBoard
                    key={column.id}
                    id={column.id}
                    className={`production-lane ${closed ? 'lane-collapsed' : ''}`}
                  >
                    <KanbanHeader className="lane-header">
                      <button
                        onClick={() => toggleCollapse(`lane:${column.id}`)}
                        aria-expanded={!closed}
                      >
                        {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span
                          className="group-dot"
                          style={{ background: statusColors[column.name] || '#8b75dc' }}
                        />
                        <strong>{column.name}</strong>
                        <span>{laneTasks.length}</span>
                      </button>
                    </KanbanHeader>
                    {!closed && (
                      <>
                        <KanbanCards<Task & { column: string }>
                          id={column.id}
                          className="lane-cards"
                          groupBy={
                            config.grouping[1]
                              ? (task) => groupValue(task, config.grouping[1])
                              : undefined
                          }
                          collapsedGroups={config.collapsed}
                          onToggleGroup={toggleCollapse}
                        >
                          {(task) => (
                            <div key={task.id} data-card={task.id}>
                              <KanbanCard {...task} className="production-card">
                                {config.cardFields.includes('image') && <ItemImage task={task} />}
                                {config.cardFields.includes('stageType') && (
                                  <p className="card-stage-type">{groupValue(task, 'stageType')}</p>
                                )}
                                <div className="card-top">
                                  <span
                                    className={`style-badge symbol-${task.brand === 'Mora' ? 'coral' : task.brand === 'Northline' ? 'blue' : 'purple'}`}
                                  >
                                    {task.style}
                                  </span>
                                  <button
                                    aria-label={`Open ${task.id}`}
                                    onClick={() => openDetail(task.id)}
                                  >
                                    <MoreHorizontal size={16} />
                                  </button>
                                </div>
                                <button className="card-title" onClick={() => openDetail(task.id)}>
                                  {task.name}
                                </button>
                                <p className="card-context">
                                  {task.brand}
                                  <span>•</span>
                                  {task.stage}
                                </p>
                                {config.cardFields.includes('status') && (
                                  <div className="card-status">{editable(task, 'status')}</div>
                                )}
                                {config.cardFields.includes('flags') && (
                                  <div className="flag-list">
                                    {task.flags.map((f) => (
                                      <span key={f}>{f}</span>
                                    ))}
                                  </div>
                                )}
                                {config.cardFields.includes('progress') && (
                                  <div className="card-progress">
                                    <span>
                                      {task.pieces.toLocaleString()} pieces{' '}
                                      <small>Production progress</small>
                                    </span>
                                    <Progress value={task.progress} />
                                  </div>
                                )}
                                <div className="card-footer">
                                  {config.cardFields.includes('assignee') && (
                                    <Avatars names={task.assignees} />
                                  )}
                                  <span className="card-footer-spacer" />
                                  {!portal?.live && config.cardFields.includes('priority') && (
                                    <Priority value={task.priority} />
                                  )}
                                </div>
                                {config.cardFields.includes('due') && (
                                  <div
                                    className={`card-due ${task.due && task.due < today ? 'overdue' : ''}`}
                                  >
                                    <span>Due {formatDate(task.due)}</span>
                                    <span>
                                      <History size={12} />
                                      {task.attempts.length - 1} jobs
                                    </span>
                                  </div>
                                )}
                              </KanbanCard>
                            </div>
                          )}
                        </KanbanCards>
                        {laneTasks.length === 0 && (
                          <div className="empty-lane">No matching productions</div>
                        )}
                        <div className="lane-total">
                          {laneTasks.reduce((n, t) => n + t.pieces, 0).toLocaleString()} planned
                          pieces
                        </div>
                      </>
                    )}
                  </KanbanBoard>
                );
              }}
            </KanbanProvider>
          </div>
        )}
        <footer className="workspace-footer">
          <span>
            <span className="footer-dot" />
            {storageWarning
              ? 'Browser storage unavailable · changes last this session'
              : 'Changes saved on this browser'}
            <span className="footer-separator">·</span>Mock data only
          </span>
          <span>
            {config.mode === 'kanban'
              ? 'Drag to reorder · stage changes require all variant quantities'
              : config.mode === 'table'
                ? 'Click a cell to edit · Shift-click headers to multi-sort'
                : 'Expand a production to see its job attempts'}
            <button onClick={() => setPanel('help')}>
              <CircleHelp size={13} />
            </button>
          </span>
        </footer>
      </main>
      {panel && (
        <Modal
          title={
            (
              {
                filters: 'Filter productions',
                group: 'Group your view',
                sort: 'Sort productions',
                fields: config.mode === 'kanban' ? 'Customize cards' : 'Customize columns',
                save: 'Save this view',
                options: 'View options',
                help: 'Your production workspace',
                schema: 'Production model & next UI changes',
              } as Record<string, string>
            )[panel]
          }
          onClose={() => setPanel(null)}
          wide={panel === 'schema'}
        >
          <div className="panel-content">
            {panel === 'filters' && (
              <>
                <p className="panel-description">
                  Match all rules. Search works alongside these filters.
                </p>
                {config.filters.map((f) => (
                  <div className="rule-row" key={f.id}>
                    <select
                      aria-label="Filter field"
                      value={f.field}
                      onChange={(e) =>
                        updateFilter(f.id, { field: e.target.value as Filter['field'], value: '' })
                      }
                    >
                      {[...groupFields, { id: 'due', label: 'Due date' }].map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter operator"
                      value={f.operator}
                      onChange={(e) =>
                        updateFilter(f.id, { operator: e.target.value as Filter['operator'] })
                      }
                    >
                      {['is', 'is not', 'contains'].map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    {f.field === 'due' || f.operator === 'contains' ? (
                      <input
                        aria-label="Filter value"
                        type={f.field === 'due' ? 'date' : 'text'}
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      />
                    ) : (
                      <select
                        aria-label="Filter value"
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {[...new Set(tasks.map((t) => groupValue(t, f.field)))].sort().map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    )}
                    <button
                      aria-label="Delete filter"
                      onClick={() =>
                        changeConfig({ filters: config.filters.filter((x) => x.id !== f.id) })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button className="text-button" onClick={addFilter}>
                  <Plus size={14} />
                  Add filter rule
                </button>
              </>
            )}
            {panel === 'group' && (
              <>
                <p className="panel-description">
                  Up to three grouping levels in List and Table. Kanban uses a lane and one
                  collapsible subgroup.
                </p>
                {config.grouping.map((field, i) => (
                  <div className="rule-row" key={i}>
                    <span className="rule-index">{i + 1}</span>
                    <select
                      aria-label={`Grouping level ${i + 1}`}
                      value={field}
                      onChange={(e) =>
                        changeConfig({
                          grouping: config.grouping.map((g, j) =>
                            j === i ? (e.target.value as GroupField) : g,
                          ),
                          collapsed: [],
                        })
                      }
                    >
                      {groupFields
                        .filter((g) => g.id === field || !config.grouping.includes(g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                    </select>
                    <span className="rule-hint">{i === 0 ? 'Primary group' : 'Then by'}</span>
                    <button
                      aria-label={`Remove grouping ${i + 1}`}
                      onClick={() =>
                        changeConfig({
                          grouping: config.grouping.filter((_, j) => j !== i),
                          collapsed: [],
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                {config.grouping.length < (config.mode === 'kanban' ? 2 : 3) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      changeConfig({
                        grouping: [
                          ...config.grouping,
                          groupFields.find((g) => !config.grouping.includes(g.id))!.id,
                        ],
                        collapsed: [],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add grouping level
                  </button>
                )}
                <div className="panel-callout">
                  {config.mode === 'kanban'
                    ? 'With no grouping selected, Kanban uses job status.'
                    : 'Expand production rows to inspect read-only historical jobs.'}
                </div>
              </>
            )}
            {panel === 'sort' && (
              <>
                <p className="panel-description">
                  Rules apply in order across all views. Clear sorting for manual Kanban ordering.
                </p>
                {config.sorting.map((s, i) => (
                  <div className="rule-row" key={s.id}>
                    <span className="rule-index">{i + 1}</span>
                    <select
                      aria-label={`Sort field ${i + 1}`}
                      value={s.id}
                      onChange={(e) =>
                        changeConfig({
                          sorting: config.sorting.map((x, j) =>
                            j === i ? { ...x, id: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {Object.entries(fieldLabels)
                        .filter(
                          ([id]) =>
                            (!portal?.live || id !== 'priority') &&
                            (id === s.id || !config.sorting.some((s) => s.id === id)),
                        )
                        .map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                    </select>
                    <select
                      aria-label={`Sort direction ${i + 1}`}
                      value={s.desc ? 'desc' : 'asc'}
                      onChange={(e) =>
                        changeConfig({
                          sorting: config.sorting.map((x, j) =>
                            j === i ? { ...x, desc: e.target.value === 'desc' } : x,
                          ),
                        })
                      }
                    >
                      <option value="asc">Ascending ↑</option>
                      <option value="desc">Descending ↓</option>
                    </select>
                    <button
                      aria-label={`Remove sort ${i + 1}`}
                      onClick={() =>
                        changeConfig({ sorting: config.sorting.filter((_, j) => j !== i) })
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                {config.sorting.length < 5 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      changeConfig({
                        sorting: [
                          ...config.sorting,
                          {
                            id: Object.keys(fieldLabels).find(
                              (id) => !config.sorting.some((s) => s.id === id),
                            )!,
                            desc: false,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add sort rule
                  </button>
                )}
              </>
            )}
            {panel === 'fields' && (
              <>
                <p className="panel-description">
                  {config.mode === 'kanban'
                    ? 'Choose fields on every card. Titles always stay visible.'
                    : 'Drag headers to rearrange and their edges to resize. Arrows below provide keyboard-friendly ordering.'}
                </p>
                <div className="field-options">
                  {(config.mode === 'kanban'
                    ? [
                        'image',
                        'stageType',
                        'status',
                        'assignee',
                        'priority',
                        'due',
                        'flags',
                        'progress',
                      ]
                    : config.order.filter((id) => id !== 'select')
                  )
                    .filter((id) => !portal?.live || id !== 'priority')
                    .map((id, i) => (
                      <div className="field-option" key={id}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={fieldLabels[id]}
                            disabled={id === 'name'}
                            checked={
                              config.mode === 'kanban'
                                ? config.cardFields.includes(id)
                                : config.visibility[id] !== false
                            }
                            onChange={(e) =>
                              config.mode === 'kanban'
                                ? changeConfig({
                                    cardFields: e.target.checked
                                      ? [...config.cardFields, id]
                                      : config.cardFields.filter((x) => x !== id),
                                  })
                                : changeConfig({
                                    visibility: { ...config.visibility, [id]: e.target.checked },
                                  })
                            }
                          />
                          {fieldLabels[id]}
                          {['priority', 'progress'].includes(id) && <small>Preview</small>}
                        </label>
                        {config.mode !== 'kanban' && (
                          <span>
                            <button
                              disabled={i === 0}
                              aria-label={`Move ${id} left`}
                              onClick={() =>
                                reorder(id, config.order[config.order.indexOf(id) - 1])
                              }
                            >
                              ↑
                            </button>
                            <button
                              disabled={i === config.order.length - 2}
                              aria-label={`Move ${id} right`}
                              onClick={() => {
                                const order = [...config.order];
                                const ix = order.indexOf(id);
                                [order[ix], order[ix + 1]] = [order[ix + 1], order[ix]];
                                changeConfig({ order });
                              }}
                            >
                              ↓
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </>
            )}
            {panel === 'save' && (
              <>
                <p className="panel-description">
                  Private view preferences. Save layout, grouping, filters, sorts, fields, widths
                  and collapsed groups. Task edits remain shared. Prototype: this browser only.
                  Planned implementation: private to your account.
                </p>
                <label className="form-field">
                  View name
                  <input
                    autoFocus
                    placeholder="e.g. Stitching · urgent this week"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveView();
                    }}
                  />
                </label>
                <button className="primary-button" disabled={!saveName.trim()} onClick={saveView}>
                  Save as new view
                </button>
                {activeView && views.some((v) => v.id === activeView) && (
                  <button
                    className="outline-button"
                    onClick={() => {
                      setViews((all) =>
                        all.map((v) =>
                          v.id === activeView ? { ...v, config: structuredClone(config) } : v,
                        ),
                      );
                      setPanel(null);
                      notify('Saved view updated.');
                    }}
                  >
                    Update current saved view
                  </button>
                )}
              </>
            )}
            {panel === 'options' && (
              <div className="options-stack">
                <button
                  onClick={() => {
                    const collect = (rows: Row<Task>[]): string[] =>
                      rows.flatMap((r) => (r.getIsGrouped() ? [r.id, ...collect(r.subRows)] : []));
                    changeConfig({
                      collapsed:
                        config.mode === 'kanban'
                          ? laneNames.map((n) => `lane:${n}`)
                          : collect(table.getGroupedRowModel().rows),
                    });
                    setPanel(null);
                  }}
                >
                  Collapse all groups
                </button>
                <button
                  onClick={() => {
                    changeConfig({ collapsed: [] });
                    setPanel(null);
                  }}
                >
                  Expand all groups
                </button>
                <button
                  onClick={() => {
                    changeConfig({
                      visibility: initialConfig.visibility,
                      order: defaultOrder,
                      sizing: {},
                    });
                    setPanel(null);
                  }}
                >
                  Reset columns and widths
                </button>
                <button
                  onClick={() => {
                    setConfig(structuredClone(initialConfig));
                    setActiveView('');
                    setSelection({});
                    setPanel(null);
                  }}
                >
                  Reset view configuration
                </button>
              </div>
            )}
            {panel === 'help' && (
              <>
                <p className="panel-description">
                  50 local garment-production records with three equally capable views.
                </p>
                <div className="guide-grid">
                  <div>
                    <List size={20} />
                    <h3>List</h3>
                    <p>Grouped, column-rich rows. Expand production to inspect historical jobs.</p>
                  </div>
                  <div>
                    <Table2 size={20} />
                    <h3>Table</h3>
                    <p>Dense cells, bulk selection, adjustable columns and inline edits.</p>
                  </div>
                  <div>
                    <Columns3 size={20} />
                    <h3>Kanban</h3>
                    <p>Drag with a mouse, or focus a card and press Space, arrows, then Space.</p>
                  </div>
                </div>
                <p className="panel-callout">
                  Enter commits text-cell edits; Escape cancels. Shift-click headers to multi-sort.
                  Escape closes dialogs. Change Current stage to enter quantities and hand over.
                </p>
                <p className="fine-print">
                  Edits and saved views stay in this browser. Priority, progress and preferences are
                  presentation-only. No Supabase or real verification.
                </p>
              </>
            )}
            {panel === 'schema' && (
              <>
                <p className="panel-description">
                  Aligned to migration 20261105135706. Existing Production screens remain untouched.
                </p>
                <div className="schema-flow">
                  <span>Item</span>
                  <ChevronRight size={14} />
                  <span>Item part</span>
                  <ChevronRight size={14} />
                  <strong>Production</strong>
                  <ChevronRight size={14} />
                  <span>Job attempts</span>
                </div>
                <ul className="model-list">
                  <li>
                    <strong>Persistent production hub.</strong> One production and board per item
                    part. Assignees and flags survive stage changes.
                  </li>
                  <li>
                    <strong>Exactly one current job.</strong> Stage, worker and dates belong to the
                    attempt. Status/date live in a separate editable row.
                  </li>
                  <li>
                    <strong>Advance creates a new attempt.</strong> Any later stage, preserving job
                    identities and challan references.
                  </li>
                  <li>
                    <strong>Rectify reopens an earlier path job.</strong> Completion clears;
                    intervening jobs remain history. A later advance makes a fresh attempt.
                  </li>
                  <li>
                    <strong>MVP handover.</strong> Fill every variant and size, then select an
                    employee. No authentication in this mockup. The existing live verification
                    contract needs a separate reviewed change before integration.
                  </li>
                  <li>
                    <strong>Piece handoff.</strong> First tracked stage allocates planned sizes
                    equally across variants. Later tracked stages take output from the actual path;
                    pre-production has no piece tracking.
                  </li>
                </ul>
                <h3>UI work after prototype approval</h3>
                <p>
                  Connect snapshots and guarded board/status commands; review the employee-selection
                  MVP for Start/Advance/Rectify, revision-conflict handling, size/variant piece
                  forms and immutable transition history. Confirm missing save boundaries for dates,
                  workers and piece edits before live writes.
                </p>
                <p className="fine-print">
                  Expandable children are historical jobs, not arbitrary business subtasks.
                  Priority, progress and saved views need agreed live persistence.
                </p>
              </>
            )}
          </div>
          {!['save', 'options'].includes(panel) && (
            <footer>
              <button className="primary-button" onClick={() => setPanel(null)}>
                Done
              </button>
            </footer>
          )}
        </Modal>
      )}
      {current && (
        <dialog
          ref={drawerRef}
          aria-label="Production details"
          className="task-drawer"
          onCancel={() => setDetail(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div className="drawer-inner">
            <header className="drawer-top">
              <span>
                <Package size={15} />
                Production / {current.style}
              </span>
              <button aria-label="Close production details" onClick={() => setDetail(null)}>
                <X size={19} />
              </button>
            </header>
            <div className="drawer-heading">
              <span className="eyebrow">
                {current.brand} · {current.part}
              </span>
              <h2>{current.name}</h2>
              <ItemImage task={current} />
              <p>Stage type: {groupValue(current, 'stageType')}</p>
              <div>
                <Status value={current.status} />
                <span className="record-id">{current.id}</span>
              </div>
            </div>
            <nav className="drawer-tabs">
              {['Overview', 'Job history', 'Activity'].map((tab) => (
                <button
                  key={tab}
                  className={drawerTab === tab ? 'active' : ''}
                  onClick={() => setDrawerTab(tab)}
                >
                  {tab}
                  {tab === 'Job history' && <span>{current.attempts.length}</span>}
                </button>
              ))}
            </nav>
            <div className="drawer-body">
              {drawerTab === 'Overview' && (
                <>
                  <div className="drawer-section-label">
                    CURRENT JOB{' '}
                    <span>{current.attempts.find((a) => a.id === current.currentJobId)?.code}</span>
                  </div>
                  <div className="detail-fields">
                    <label>
                      Current stage
                      <select
                        aria-label="Current stage"
                        value={current.stage}
                        onChange={(e) => chooseStage(e.target.value)}
                      >
                        {stages
                          .filter(
                            (stage, i) =>
                              i >= stages.indexOf(current.stage) ||
                              current.path.some(
                                (id) => current.attempts.find((a) => a.id === id)?.stage === stage,
                              ),
                          )
                          .map((stage) => (
                            <option key={stage}>{stage}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Job status
                      <EditCell
                        label="Detail job status"
                        value={current.status}
                        options={statuses}
                        onChange={(v) => patchTask(current.id, { status: v as Task['status'] })}
                      />
                    </label>
                    <label>
                      Due date
                      <EditCell
                        label="Detail due date"
                        type="date"
                        value={current.due}
                        onChange={(v) => patchTask(current.id, { due: v })}
                      />
                    </label>
                    <label>
                      Job worker<span>{current.worker}</span>
                    </label>
                  </div>
                  <div className="drawer-section-label">
                    PRODUCTION BOARD <small>Persists across stages</small>
                  </div>
                  <div className="detail-fields">
                    {!portal?.live && (
                      <label>
                        Priority
                        <span className="preview-field">
                          Preview only
                          <EditCell
                            label="Detail priority"
                            value={current.priority}
                            options={priorities}
                            onChange={(v) =>
                              patchTask(current.id, { priority: v as Task['priority'] })
                            }
                          />
                        </span>
                      </label>
                    )}
                    <label>
                      Planned pieces
                      <input aria-label="Planned pieces" value={current.pieces} readOnly />
                      <small className="fine-print">Total planned pieces across item sizes</small>
                    </label>
                    <label>
                      Progress
                      <span>
                        <Progress value={current.progress} />
                        <small className="fine-print">
                          {portal?.live
                            ? 'Position in the configured stage sequence'
                            : 'Illustrative, not live piece completion'}
                        </small>
                      </span>
                    </label>
                  </div>
                  <h3 className="detail-subtitle">
                    Assignees <Avatars names={current.assignees} />
                  </h3>
                  <Select
                    unstyled
                    className="task-assignee-picker"
                    isMulti
                    aria-label="Task assignees"
                    classNamePrefix="task-select"
                    options={people.map((p) => ({ value: p.name, label: p.name }))}
                    value={current.assignees.map((name) => ({ value: name, label: name }))}
                    onChange={(options) =>
                      patchTask(current.id, { assignees: options.map((o) => o.value) })
                    }
                    placeholder="Select team members…"
                  />
                  <h3 className="detail-subtitle">Production checklist</h3>
                  <p className="fine-print">
                    Shared by every part of {current.style}. Changes apply to this item.
                  </p>
                  <div className="detail-fields checklist-fields">
                    {[
                      'FPT / GPT',
                      'Photoshoot sample',
                      'Shipment sample',
                      'Techpack acquired',
                      'Ordersheet acquired',
                    ].map((field) => (
                      <label key={field}>
                        {field}
                        <select
                          aria-label={field}
                          value={current.checklist?.[field] || 'Yet to start'}
                          onChange={(e) =>
                            setTasks((all) =>
                              all.map((task) =>
                                (
                                  portal
                                    ? task.itemId === current.itemId
                                    : task.style === current.style
                                )
                                  ? {
                                      ...task,
                                      checklist: { ...task.checklist, [field]: e.target.value },
                                    }
                                  : task,
                              ),
                            )
                          }
                        >
                          <option value="">Not set</option>
                          {statuses.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <h3 className="detail-subtitle">
                    <Tag size={15} />
                    Board flags
                  </h3>
                  <div className="flag-options">
                    {availableFlags.map((flag) => (
                      <label key={flag} className={current.flags.includes(flag) ? 'checked' : ''}>
                        <input
                          type="checkbox"
                          checked={current.flags.includes(flag)}
                          onChange={(e) =>
                            patchTask(current.id, {
                              flags: e.target.checked
                                ? [...current.flags, flag]
                                : current.flags.filter((f) => f !== flag),
                            })
                          }
                        />
                        {flag}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {drawerTab === 'Job history' && (
                <>
                  <p className="panel-description">
                    Original identities are retained. Exactly one job is current; abandoned branches
                    remain visible.
                  </p>
                  <div className="job-timeline">
                    {current.attempts.map((a, i) => (
                      <div
                        key={a.id}
                        className={`job-history-card ${a.id === current.currentJobId ? 'is-current' : ''}`}
                      >
                        <span className="timeline-point">{i + 1}</span>
                        <div>
                          <small>{a.code}</small>
                          <h3>
                            {a.stage}
                            {a.id === current.currentJobId ? (
                              <span>Current</span>
                            ) : !current.path.includes(a.id) ? (
                              <span className="abandoned-label">Outside current path</span>
                            ) : null}
                          </h3>
                          <Status value={a.status} />
                          <p>
                            Started {formatDate(a.started)} ·{' '}
                            {a.completed ? `Completed ${formatDate(a.completed)}` : 'Open attempt'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {drawerTab === 'Activity' && (
                <>
                  <p className="panel-description">
                    Local simulated movements. The live transition log is append-only.
                  </p>
                  {current.events.map((event, i) => (
                    <div className="activity-entry" key={i}>
                      <History size={16} />
                      <div>
                        <p>{event.text}</p>
                        <small>{event.time}</small>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <footer className="drawer-footer">
              <span>
                <i />
                Local mock · changes sync to all views
              </span>
              <button onClick={() => setDetail(null)}>Close</button>
            </footer>
          </div>
        </dialog>
      )}
      {movement && current && (!portal || portal.canEdit) && (
        <Modal title="Update Task Status" onClose={() => setMovement(null)}>
          <TaskHandover
            key={`${current.id}:${target}`}
            task={current}
            destination={target}
            onSubmit={saveHandover}
            readOnly={portal && !portal.canEdit}
          />
        </Modal>
      )}
      {toast && (
        <div className="studio-toast" role="status">
          <Check size={16} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function LayersIcon() {
  return <Settings2 size={17} />;
}
function formatDate(value: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${value}T00:00:00+05:30`));
}
