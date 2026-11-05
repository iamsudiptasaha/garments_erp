import type { Task, PieceEntry } from './model';
// Browser-preview adapter only. Never passed a live Supabase snapshot.
type Row = { id: string; [key: string]: any };
type Data = Record<string, Row[]>;
const fields = {
  'FPT / GPT': 'fpt_gpt_status_id',
  'Photoshoot sample': 'photoshoot_sample_status_id',
  'Shipment sample': 'shipment_sample_status_id',
  'Techpack acquired': 'techpack_aqcuired_status_id',
  'Ordersheet acquired': 'ordersheet_acquired_status_id',
};
export function portalTasks(data: Data): Task[] {
  const rows = (table: string) => data[table] || [];
  const find = (table: string, id: string) => rows(table).find((r) => r.id === id);
  const stages = [...rows('stage')].sort((a, b) => a.sort_order - b.sort_order);
  const employeeNames = rows('employee')
    .filter((e) => e.is_active !== false)
    .map((e) => e.name || e.employee_name)
    .filter(Boolean);
  const saved = rows('production_task_board_preview') as unknown as Task[];
  return rows('item_part').flatMap((part) => {
    const item = find('item', part.item_id);
    const jobs = rows('job').filter((j) => j.item_part_id === part.id);
    if (!item || !jobs.length) return [];
    const stored = saved.find((t) => t.itemPartId === part.id);
    const ordered = [...jobs].sort(
      (a, b) =>
        stages.findIndex((s) => s.id === a.stage_id) - stages.findIndex((s) => s.id === b.stage_id),
    );
    const current = jobs.find((j) => j.latest === true) || ordered.at(-1)!;
    const links = rows('variant_item').filter((v) => v.item_part_id === part.id);
    const sizes = rows('item_size_list')
      .filter((s) => s.item_id === item.id)
      .sort(
        (a, b) =>
          (find('size_list', a.size_list_id)?.sort_order || 0) -
          (find('size_list', b.size_list_id)?.sort_order || 0),
      );
    const pieces: PieceEntry[] = links.flatMap((link, index) =>
      sizes.map((size) => {
        const planned = Number(
          rows('item_cut_ratio').find((r) => r.item_size_list_id === size.id)?.pieces || 0,
        );
        const currentLink = rows('variant_item_per_job').find(
          (v) => v.job_id === current.id && v.variant_item_id === link.id,
        );
        const currentPiece = rows('stage_pieces').find(
          (p) => p.variant_item_per_job_id === currentLink?.id && p.item_size_list_id === size.id,
        );
        const last = [...ordered]
          .filter((job) => job.id !== current.id)
          .reverse()
          .flatMap((job) => {
            const map = rows('variant_item_per_job').find(
              (v) => v.job_id === job.id && v.variant_item_id === link.id,
            );
            const row = rows('stage_pieces').find(
              (p) => p.variant_item_per_job_id === map?.id && p.item_size_list_id === size.id,
            );
            return row ? [row] : [];
          })[0];
        return {
          variant: String(find('variant', link.variant_id)?.variant_name || link.id),
          size: String(find('size_list', size.size_list_id)?.size || size.id),
          incoming: currentPiece
            ? Number(currentPiece.pieces_stock_in)
            : last
              ? Number(last.pieces_stock_out)
              : Math.floor(planned / links.length) + (index < planned % links.length ? 1 : 0),
          output: '',
        };
      }),
    );
    const checklist = rows('production_checklist').find((c) => c.item_id === item.id);
    const task: Task = stored || {
      id: `production-${part.id}`,
      itemId: item.id,
      itemPartId: part.id,
      name: `${item.product_description || item.style_code} · ${find('part_list', part.part_list_id)?.part || 'Part'}`,
      style: item.style_code,
      brand:
        find('brand_list', item.brand_id)?.brand ||
        find('brand_list', item.brand_id)?.brand_name ||
        find('brand_list', item.brand_id)?.name ||
        'Unassigned',
      part: find('part_list', part.part_list_id)?.part || 'Part',
      stage: find('stage', current.stage_id)?.name || '',
      status: find('item_status_list', current.item_status_list_id)?.status || 'Yet to start',
      assignees: [],
      priority: 'Normal',
      due: current.due_date || '',
      flags: [],
      progress: 0,
      pieces: sizes.reduce(
        (n, size) =>
          n +
          Number(rows('item_cut_ratio').find((r) => r.item_size_list_id === size.id)?.pieces || 0),
        0,
      ),
      worker:
        find('contacts', find('job_worker', current.job_worker_id)?.contacts_id)?.company_name ||
        'In-house',
      attempts: ordered.map((job) => ({
        id: job.id,
        stage: find('stage', job.stage_id)?.name || '',
        code: job.job_code,
        started: job.start_date || '',
        completed: job.complete_date || null,
        status: find('item_status_list', job.item_status_list_id)?.status || 'Yet to start',
      })),
      currentJobId: current.id,
      path: ordered.map((job) => job.id),
      events: [],
      checklist: Object.fromEntries(
        Object.entries(fields).map(([label, key]) => [
          label,
          find('item_status_list', checklist?.[key])?.status || 'Yet to start',
        ]),
      ),
    };
    return [
      {
        ...task,
        pieces: sizes.reduce(
          (n, size) =>
            n +
            Number(
              rows('item_cut_ratio').find((r) => r.item_size_list_id === size.id)?.pieces || 0,
            ),
          0,
        ),
        style: item.style_code,
        itemId: item.id,
        itemPartId: part.id,
        stageOptions: stages.map((s) => s.name),
        stageTypes: Object.fromEntries(
          stages.map((s) => [s.name, find('stage_type', s.stage_type_id)?.name || 'Unassigned']),
        ),
        imageAttachmentId: item.image_attachment ? String(item.image_attachment) : undefined,
        employeeNames,
        flagOptions: rows('flags_list').map((f) => f.name),
        untrackedStages: stages.filter((s) => s.pp_stage || !s.track_pieces).map((s) => s.name),
        jobInputs: {
          ...Object.fromEntries(
            jobs.map((job) => [
              job.id,
              links.flatMap((link) =>
                sizes.flatMap((size) => {
                  const vj = rows('variant_item_per_job').find(
                    (v) => v.job_id === job.id && v.variant_item_id === link.id,
                  );
                  const p = rows('stage_pieces').find(
                    (r) => r.variant_item_per_job_id === vj?.id && r.item_size_list_id === size.id,
                  );
                  return p
                    ? [
                        {
                          variant: String(
                            find('variant', link.variant_id)?.variant_name || link.id,
                          ),
                          size: String(find('size_list', size.size_list_id)?.size || size.id),
                          incoming: Number(p.pieces_stock_in),
                          output: '',
                        },
                      ]
                    : [];
                }),
              ),
            ]),
          ),
          ...stored?.jobInputs,
        },
        pieceSchema: stored?.pieceSchema || pieces,
      },
    ];
  });
}
export function savePortalTasks(data: Data, tasks: Task[]): Data {
  const next = structuredClone(data);
  next.production_task_board_preview = structuredClone(tasks) as unknown as Row[];
  // Project reviewed preview fields back to existing portal records, preserving all IDs/links.
  for (const task of tasks) {
    const employee = (name: string) =>
      next.employee.find((e) => (e.name || e.employee_name) === name)?.id;
    for (const attempt of task.attempts) {
      let job = next.job.find((j) => j.id === attempt.id);
      if (!job) {
        job = {
          id: attempt.id,
          item_part_id: task.itemPartId,
          job_code: attempt.code,
          stage_id: next.stage.find((s) => s.name === attempt.stage)?.id,
          job_worker_id: null,
          start_date: attempt.started || null,
        };
        next.job.push(job);
      }
      job.latest = attempt.id === task.currentJobId;
      job.complete_date = attempt.completed;
      job.item_status_list_id =
        next.item_status_list.find((s) => s.status === attempt.status)?.id ||
        job.item_status_list_id;
      if (job.latest) {
        job.due_date = task.due || null;
        job.item_status_list_id =
          next.item_status_list.find((s) => s.status === task.status)?.id ||
          job.item_status_list_id;
      }
    }
    for (const handover of task.handovers || []) {
      const job = next.job.find((j) => j.id === handover.job);
      if (job) job.verify_employee_id = employee(handover.employee);
      for (const piece of handover.pieces) {
        const variant = next.variant_item.find(
          (link) =>
            link.item_part_id === task.itemPartId &&
            next.variant.find((v) => v.id === link.variant_id)?.variant_name === piece.variant,
        );
        const size = next.item_size_list.find(
          (link) =>
            link.item_id === task.itemId &&
            next.size_list.find((s) => s.id === link.size_list_id)?.size === piece.size,
        );
        if (!variant || !size) throw Error('The item variant or size changed. Reopen the task.');
        let link = next.variant_item_per_job.find(
          (v) => v.job_id === handover.job && v.variant_item_id === variant.id,
        );
        if (!link) {
          link = { id: crypto.randomUUID(), job_id: handover.job, variant_item_id: variant.id };
          next.variant_item_per_job.push(link);
        }
        let row = next.stage_pieces.find(
          (p) => p.variant_item_per_job_id === link.id && p.item_size_list_id === size.id,
        );
        if (!row) {
          row = {
            id: crypto.randomUUID(),
            variant_item_per_job_id: link.id,
            item_size_list_id: size.id,
          };
          next.stage_pieces.push(row);
        }
        row.pieces_stock_in = piece.incoming;
        row.pieces_stock_out = Number(piece.output);
      }
    }
    if (task.checklist && task.itemId) {
      let checklist = next.production_checklist.find((c) => c.item_id === task.itemId);
      if (!checklist) {
        checklist = { id: crypto.randomUUID(), item_id: task.itemId };
        next.production_checklist.push(checklist);
      }
      for (const [label, key] of Object.entries(fields))
        checklist[key] =
          next.item_status_list.find((s) => s.status === task.checklist?.[label])?.id || null;
    }
  }
  return next;
}

export function startPortalProduction(data: Data, partId: string, employeeId: string): Data {
  const next = structuredClone(data);
  const part = next.item_part.find((p) => p.id === partId);
  const stage = [...next.stage].sort((a, b) => a.sort_order - b.sort_order)[0];
  if (!part || !stage) throw Error('Select an existing item part and configure the first stage.');
  if (next.job.some((j) => j.item_part_id === partId))
    throw Error('Production already exists for this part.');
  if (!next.employee.some((e) => e.id === employeeId && e.is_active !== false))
    throw Error('Select an active employee.');
  const status = next.item_status_list.find((s) => s.status === 'Yet to start');
  if (!status) throw Error('The Yet to start status is missing.');
  const variants = next.variant_item
    .filter((v) => v.item_part_id === partId)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sizes = next.item_size_list.filter((s) => s.item_id === part.item_id);
  const tracked = stage.track_pieces && !stage.pp_stage;
  if (tracked && (!variants.length || !sizes.length))
    throw Error('Complete the item variants and sizes before starting.');
  const jobId = crypto.randomUUID();
  next.job.push({
    id: jobId,
    item_part_id: partId,
    stage_id: stage.id,
    job_code: `LOCAL/${jobId.slice(0, 8)}`,
    start_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
    due_date: null,
    complete_date: null,
    job_worker_id: null,
    item_status_list_id: status.id,
    verify_employee_id: employeeId,
    latest: true,
  });
  for (const [i, variant] of variants.entries()) {
    const link = { id: crypto.randomUUID(), job_id: jobId, variant_item_id: variant.id };
    next.variant_item_per_job.push(link);
    if (tracked)
      for (const size of sizes) {
        const raw = next.item_cut_ratio.find((r) => r.item_size_list_id === size.id)?.pieces;
        const count = Number(raw);
        if (raw == null || String(raw).trim() === '' || !Number.isSafeInteger(count) || count < 0)
          throw Error('Enter planned whole pieces for every item size in Items first.');
        next.stage_pieces.push({
          id: crypto.randomUUID(),
          variant_item_per_job_id: link.id,
          item_size_list_id: size.id,
          pieces_stock_in:
            Math.floor(count / variants.length) + (i < count % variants.length ? 1 : 0),
          pieces_stock_out: 0,
        });
      }
  }
  return next;
}
