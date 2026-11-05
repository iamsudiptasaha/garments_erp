export const statuses = [
  'Yet to start',
  'In process',
  'Complete',
  'Skipped',
  'Redo',
  'Disputed',
] as const;
export const priorities = ['Urgent', 'High', 'Normal', 'Low'] as const;
export const stages = [
  'Fit sampling',
  'Develop CAD',
  'Strike off',
  'Pre-production sample',
  'Ready for production',
  'Cutting',
  'Printing',
  'Embroidery',
  'Stitching',
  'Washing',
  'Finishing',
  'Quality check',
  'Ironing',
  'Packaging',
  'Ready to dispatch',
  'In transit',
  'GRN complete',
  'Production complete',
];
const defaultStages = stages;
const abbreviations = [
  'FIT',
  'CAD',
  'SO',
  'PPS',
  'RFP',
  'CUT',
  'PRT',
  'EMB',
  'STH',
  'WSH',
  'FIN',
  'QC',
  'IRN',
  'PAC',
  'RTD',
  'IT',
  'GRN',
  'PC',
];
export const people = [
  { name: 'Ananya Sen', initials: 'AS', color: '#ede4ff' },
  { name: 'Rahul Das', initials: 'RD', color: '#dceffc' },
  { name: 'Priya Roy', initials: 'PR', color: '#fce5dc' },
  { name: 'Arjun Mehta', initials: 'AM', color: '#dff1e6' },
  { name: 'Meera Shah', initials: 'MS', color: '#f7e5f1' },
];
type Status = (typeof statuses)[number];
type Priority = (typeof priorities)[number];
export type GroupField =
  'stage' | 'stageType' | 'status' | 'brand' | 'assignee' | 'priority' | 'part';
export const groupFields: { id: GroupField; label: string }[] = [
  { id: 'stage', label: 'Stage' },
  { id: 'stageType', label: 'Stage type' },
  { id: 'status', label: 'Job status' },
  { id: 'brand', label: 'Brand' },
  { id: 'assignee', label: 'Lead assignee' },
  { id: 'priority', label: 'Priority' },
  { id: 'part', label: 'Part' },
];
type Attempt = {
  id: string;
  stage: string;
  code: string;
  started: string;
  completed: string | null;
  status: Status;
  abandoned?: boolean;
};
export type Task = {
  id: string;
  name: string;
  style: string;
  brand: string;
  part: string;
  stage: string;
  status: Status;
  assignees: string[];
  priority: Priority;
  due: string;
  flags: string[];
  progress: number;
  pieces: number;
  worker: string;
  attempts: Attempt[];
  currentJobId: string;
  path: string[];
  events: { text: string; time: string }[];
  itemId?: string;
  itemPartId?: string;
  pieceSchema?: PieceEntry[];
  jobInputs?: Record<string, PieceEntry[]>;
  stageOptions?: string[];
  untrackedStages?: string[];
  stageTypes?: Record<string, string>;
  imageAttachmentId?: string;
  flagOptions?: string[];
  employeeNames?: string[];
  visitId?: string;
  handovers?: Handover[];
  incomingPieces?: PieceEntry[];
  checklist?: Record<string, string>;
  kind?: 'history';
  parentId?: string;
};
export type Filter = {
  id: string;
  field: GroupField | 'due';
  operator: 'is' | 'is not' | 'contains';
  value: string;
};
export const flagOptions = [
  'Buyer approval',
  'Lab dip pending',
  'Fabric ready',
  'Rework',
  'Shipment priority',
];
export const fieldLabels: Record<string, string> = {
  name: 'Production / item part',
  style: 'Style code',
  brand: 'Brand',
  part: 'Part',
  stage: 'Current stage',
  stageType: 'Stage type',
  image: 'Item image',
  status: 'Job status',
  assignee: 'Assignees',
  priority: 'Priority',
  due: 'Due date',
  flags: 'Flags',
  progress: 'Progress',
  pieces: 'Planned pieces',
  worker: 'Job worker',
};
export const defaultOrder = [
  'select',
  'name',
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
];
export function groupValue(task: Task, field: string): string {
  if (field === 'stageType') return task.stageTypes?.[task.stage] || 'Unassigned';
  if (field === 'assignee') return task.assignees[0] || 'Unassigned';
  return String(task[field as keyof Task] ?? '');
}
export function mockTasks(): Task[] {
  const styles = [
    ['Linen resort shirt', 'SC-26101', 'Saha Studio'],
    ['Ribbed everyday tee', 'SC-26102', 'Northline'],
    ['Wide-leg cotton trouser', 'SC-26103', 'Mora'],
    ['Printed co-ord set', 'SC-26104', 'Saha Studio'],
    ['Oxford overshirt', 'SC-26105', 'Northline'],
    ['Relaxed poplin dress', 'SC-26106', 'Mora'],
    ['Waffle lounge set', 'SC-26107', 'Saha Studio'],
    ['Utility cargo pant', 'SC-26108', 'Northline'],
    ['Embroidered kurta', 'SC-26109', 'Mora'],
    ['Cropped denim jacket', 'SC-26110', 'Saha Studio'],
  ];
  const parts = ['Body', 'Sleeve', 'Collar', 'Front panel', 'Back panel'];
  const positions = [5, 8, 11, 3, 13, 7, 10, 4, 14, 0];
  return Array.from({ length: 50 }, (_, i) => {
    const [name, style, brand] = styles[Math.floor(i / 5)];
    const stageIndex = positions[(i * 3 + Math.floor(i / 5)) % positions.length];
    const prior = Array.from(
      { length: Math.min(stageIndex, 3) },
      (_, j) => Math.max(0, stageIndex - 3) + j,
    );
    const route = [...prior, stageIndex];
    const status: Status =
      i % 13 === 0
        ? 'Disputed'
        : i % 11 === 0
          ? 'Redo'
          : i % 7 === 0
            ? 'Complete'
            : i % 5 === 0
              ? 'Yet to start'
              : 'In process';
    const attempts: Attempt[] = route.map((n, j) => ({
      id: `job-${i + 1}-${j + 1}`,
      stage: stages[n],
      code: `${abbreviations[n]}/${String(i * 4 + j + 1).padStart(5, '0')}/26-27`,
      started: `2026-11-${String(1 + j).padStart(2, '0')}`,
      completed: j < route.length - 1 ? '2026-11-04' : null,
      status: j < route.length - 1 ? 'Complete' : status,
    }));
    return {
      id: `production-${i + 1}`,
      name: `${name} · ${parts[i % 5]}`,
      style,
      brand,
      part: parts[i % 5],
      stage: stages[stageIndex],
      status,
      assignees:
        i % 9 === 0 ? [] : [people[i % 5].name, ...(i % 4 === 0 ? [people[(i + 2) % 5].name] : [])],
      priority: priorities[i % 4],
      due: `2026-11-${String(4 + (i % 18)).padStart(2, '0')}`,
      flags: [flagOptions[i % 5]],
      progress:
        status === 'Complete' ? 100 : Math.min(94, Math.round(((stageIndex + 1) / 18) * 100)),
      pieces: [480, 720, 960, 1200, 600][i % 5],
      worker: ['Eastern Stitchworks', 'Aarav Garments', 'In-house floor A', 'Bengal Finishing'][
        i % 4
      ],
      attempts,
      currentJobId: attempts.at(-1)!.id,
      path: attempts.map((a) => a.id),
      events: [{ text: `Current attempt opened in ${stages[stageIndex]}`, time: '5 Nov · 09:30' }],
    };
  });
}
export function childRows(task: Task): Task[] {
  return task.attempts
    .filter((a) => a.id !== task.currentJobId)
    .map((a) => ({
      ...task,
      id: a.id,
      parentId: task.id,
      kind: 'history',
      name: a.stage,
      stage: a.stage,
      status: a.status,
      due: '',
      attempts: [],
      path: [],
      events: [],
    }));
}
export function filterTasks(tasks: Task[], search: string, filters: Filter[]) {
  const q = search.trim().toLowerCase();
  return tasks.filter(
    (t) =>
      (!q ||
        [t.name, t.style, t.brand, t.worker, ...t.flags, ...t.assignees]
          .join(' ')
          .toLowerCase()
          .includes(q)) &&
      filters.every((f) => {
        const v = groupValue(t, f.field).toLowerCase();
        const match =
          f.operator === 'contains'
            ? v.includes(f.value.toLowerCase())
            : v === f.value.toLowerCase();
        return f.operator === 'is not' ? !match : match;
      }),
  );
}
function moveTask(task: Task, action: 'advance' | 'rectify', target: string, reason: string): Task {
  const stages = task.stageOptions || defaultStages;
  const current = task.attempts.find((a) => a.id === task.currentJobId)!;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (action === 'rectify') {
    const position = task.path.indexOf(target);
    if (position < 0 || target === current.id || !reason.trim())
      throw Error('Select an earlier job on the current path and give a reason.');
    const destination = task.attempts.find((a) => a.id === target)!;
    const attempts = task.attempts.map((a) => (a.id === target ? { ...a, completed: null } : a));
    // Reopen the original attempt; historical jobs and their identities remain intact.
    return {
      ...task,
      stage: destination.stage,
      status: destination.status,
      path: task.path.slice(0, position + 1),
      attempts,
      currentJobId: target,
      events: [
        ...task.events,
        {
          text: `Rectified ${current.stage} → ${destination.stage}: ${reason}`,
          time: 'Just now · simulated',
        },
      ],
    };
  }
  const next = target ? stages.indexOf(target) : stages.indexOf(task.stage) + 1;
  if (next <= stages.indexOf(task.stage)) throw Error('Choose a later destination stage.');
  if (next >= stages.length) throw Error('This production is already at the last stage.');
  const job: Attempt = {
    id: crypto.randomUUID(),
    stage: stages[next],
    code: task.itemPartId
      ? `LOCAL/${crypto.randomUUID().slice(0, 8)}`
      : `${abbreviations[next]}/${String(Number(task.id.split('-').at(-1)) * 100 + task.attempts.length + 1).padStart(5, '0')}/26-27`,
    started: today,
    completed: null,
    status: 'Yet to start',
  };
  return {
    ...task,
    stage: job.stage,
    due: '',
    status: job.status,
    progress: Math.round(((next + 1) / stages.length) * 100),
    path: [...task.path, job.id],
    currentJobId: job.id,
    attempts: [
      ...task.attempts.map((a) => (a.id === current.id ? { ...a, completed: today } : a)),
      job,
    ],
    events: [
      ...task.events,
      { text: `Advanced ${current.stage} → ${job.stage}`, time: 'Just now · simulated' },
    ],
  };
}

export type PieceEntry = { variant: string; size: string; incoming: number; output: string };
type Handover = {
  visit: string;
  job: string;
  employee: string;
  destination: string;
  pieces: PieceEntry[];
};
export function handoverRows(task: Task): PieceEntry[] {
  if (task.untrackedStages?.includes(task.stage)) return [];
  if (task.pieceSchema) return task.pieceSchema.map((row) => ({ ...row, output: '' }));
  if (task.incomingPieces)
    return task.incomingPieces.map((row) => ({ ...row, incoming: Number(row.output), output: '' }));
  const sizes = ['S', 'M', 'L', 'XL'];
  const count = sizes.length * 2;
  return ['Ivory', 'Sage'].flatMap((variant, v) =>
    sizes.map((size, i) => ({
      variant,
      size,
      incoming:
        Math.floor(task.pieces / count) + (v * sizes.length + i < task.pieces % count ? 1 : 0),
      output: '',
    })),
  );
}
export function completeHandover(
  task: Task,
  pieces: PieceEntry[],
  destination: string,
  employee: string,
  reason: string,
): Task {
  const stages = task.stageOptions || defaultStages;
  const expected = handoverRows(task);
  if (!expected.length && !task.untrackedStages?.includes(task.stage))
    throw Error('Set up the item variants and sizes before handing over.');
  if (
    pieces.length !== expected.length ||
    expected.some((r, i) => r.variant !== pieces[i].variant || r.size !== pieces[i].size) ||
    pieces.some(
      (r) =>
        r.output.trim() === '' || !Number.isSafeInteger(Number(r.output)) || Number(r.output) < 0,
    )
  )
    throw Error('Fill every size for every variant with a whole non-negative number.');
  if (!(task.employeeNames || people.map((p) => p.name)).includes(employee))
    throw Error('Select your name.');
  const visit = task.visitId || task.currentJobId;
  if (task.handovers?.some((h) => h.visit === visit))
    throw Error('This job visit has already been handed over.');
  if (destination === task.stage || !stages.includes(destination))
    throw Error('Choose another stage.');
  const action = stages.indexOf(destination) > stages.indexOf(task.stage) ? 'advance' : 'rectify';
  const target =
    action === 'advance'
      ? destination
      : task.path.find(
          (id) =>
            id !== task.currentJobId &&
            task.attempts.find((a) => a.id === id)?.stage === destination,
        ) || '';
  const updated = moveTask(task, action, target, reason);
  const jobInputs = {
    ...task.jobInputs,
    [task.currentJobId]: expected.map((r) => ({ ...r, output: '' })),
  };
  const reopened = action === 'rectify' ? jobInputs[updated.currentJobId] : undefined;
  return {
    ...updated,
    visitId: crypto.randomUUID(),
    jobInputs,
    incomingPieces: pieces.length ? pieces.map((row) => ({ ...row })) : task.incomingPieces,
    pieceSchema:
      reopened ||
      (task.pieceSchema && pieces.length
        ? pieces.map((row) => ({ ...row, incoming: Number(row.output), output: '' }))
        : task.pieceSchema),
    handovers: [
      ...(task.handovers || []),
      {
        visit,
        job: task.currentJobId,
        employee,
        destination,
        pieces: pieces.map((row) => ({ ...row })),
      },
    ],
    events: [
      ...updated.events,
      {
        text: `${employee} handed over all variants (${pieces.reduce((n, r) => n + Number(r.output), 0)} pieces)`,
        time: 'Just now · mock',
      },
    ],
  };
}
