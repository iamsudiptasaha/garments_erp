import { productionContract } from './live-contract.js';
import { liveFileCommands } from '../files/live.js';
export const checklistColumns = {
  'FPT / GPT': 'fpt_gpt_status_id',
  'Photoshoot sample': 'photoshoot_sample_status_id',
  'Shipment sample': 'shipment_sample_status_id',
  'Techpack acquired': 'techpack_aqcuired_status_id',
  'Ordersheet acquired': 'ordersheet_acquired_status_id',
};
const employeeLabel = (e) => `${e.name || 'Employee'} (${e.employee_code || e.id})`;
export function productionTasks(data) {
  const rows = (t) => data[t] || [];
  const find = (t, id) => rows(t).find((r) => r.id === id);
  const stages = [...rows('stage')].sort((a, b) => a.sort_order - b.sort_order);
  return (data.production_records || []).flatMap((record) => {
    const { production, item, item_part: part, jobs, movements, current_path: path } = record;
    const current = jobs.find((j) => j.latest);
    if (!current) return [];
    const stage = find('stage', current.stage_id);
    const status = (job) =>
      find(
        'item_status_list',
        record.statuses.find((s) => s.job_id === job.id)?.item_status_list_id,
      )?.status || 'Yet to start';
    const sizes = rows('item_size_list')
      .filter((s) => s.item_id === item.id)
      .sort(
        (a, b) =>
          (find('size_list', a.size_list_id)?.sort_order || 0) -
          (find('size_list', b.size_list_id)?.sort_order || 0),
      );
    const variants = rows('variant_item').filter((v) => v.item_part_id === part.id);
    const inputs = (job) =>
      variants.flatMap((v) =>
        sizes.map((size) => {
          const vj = rows('variant_item_per_job').find(
            (r) => r.job_id === job.id && r.variant_item_id === v.id,
          );
          const cell = rows('stage_pieces').find(
            (r) => r.variant_item_per_job_id === vj?.id && r.item_size_list_id === size.id,
          );
          return {
            variant: `${find('variant', v.variant_id)?.variant_name || 'Variant'} · ${v.id}`,
            size: find('size_list', size.size_list_id)?.size || size.id,
            variantItemId: v.id,
            itemSizeId: size.id,
            incoming: Number(cell?.pieces_stock_in || 0),
            output: '',
          };
        }),
      );
    const checklist = rows('production_checklist').find((c) => c.item_id === item.id);
    return [
      {
        id: production.id,
        itemId: item.id,
        itemPartId: part.id,
        name: `${item.product_description || item.style_code} · ${find('part_list', part.part_list_id)?.part || 'Part'}`,
        style: item.style_code,
        brand: find('brand_list', item.brand_id)?.brand || 'Unassigned',
        part: find('part_list', part.part_list_id)?.part || 'Part',
        stage: stage?.name || '',
        status: status(current),
        assignees: record.assignees.map((id) => employeeLabel(find('employee', id) || { id })),
        flags: record.flags.map((id) => find('flags_list', id)?.name || id),
        priority: 'Normal',
        due: current.due_date || '',
        progress:
          stages.length > 1 ? Math.round((stages.indexOf(stage) / (stages.length - 1)) * 100) : 0,
        pieces: sizes.reduce(
          (n, s) =>
            n +
            Number(rows('item_cut_ratio').find((r) => r.item_size_list_id === s.id)?.pieces || 0),
          0,
        ),
        worker:
          find('contacts', find('job_worker', current.job_worker_id)?.contacts_id)?.company_name ||
          'In-house',
        currentJobId: current.id,
        path,
        visitId: movements.at(-1)?.id || '0',
        attempts: jobs.map((j) => ({
          id: j.id,
          stage: find('stage', j.stage_id)?.name || '',
          code: j.job_code,
          started: j.start_date || '',
          completed: j.complete_date,
          status: status(j),
        })),
        events: movements.map((m) => ({
          text: `${m.action} · ${find('employee', m.verified_by)?.name || 'Employee'}${m.reason ? ` · ${m.reason}` : ''}`,
          time: m.timestamp || '',
        })),
        stageOptions: stages.map((s) => s.name),
        stageTypes: Object.fromEntries(
          stages.map((s) => [s.name, find('stage_type', s.stage_type_id)?.name || 'Unassigned']),
        ),
        untrackedStages: stages.filter((s) => s.pp_stage || !s.track_pieces).map((s) => s.name),
        employeeNames: rows('employee').map(employeeLabel),
        flagOptions: rows('flags_list').map((f) => f.name),
        statusOptions: rows('item_status_list').map((s) => s.status),
        pieceSchema: inputs(current),
        jobInputs: Object.fromEntries(jobs.map((j) => [j.id, inputs(j)])),
        checklist: Object.fromEntries(
          Object.entries(checklistColumns).map(([label, key]) => [
            label,
            find('item_status_list', checklist?.[key])?.status || '',
          ]),
        ),
        imageAttachmentId: item.image_attachment || undefined,
        imageUrl: data.production_images?.[item.image_attachment],
      },
    ];
  });
}
export function productionChanges(before, after, resource) {
  return Object.entries(productionContract[resource] || {}).flatMap(([table, fields]) => {
    const old = new Map((before[table] || []).map((r) => [r.id, r]));
    const current = new Map((after[table] || []).map((r) => [r.id, r]));
    const values = (row) =>
      Object.fromEntries(fields.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]));
    return [
      ...[...current.values()]
        .filter(
          (r) =>
            !old.has(r.id) || JSON.stringify(values(r)) !== JSON.stringify(values(old.get(r.id))),
        )
        .map((r) => ({ table, id: r.id, before: old.get(r.id) || null, values: values(r) })),
      ...[...old.values()]
        .filter((r) => !current.has(r.id))
        .map((r) => ({ table, id: r.id, before: r, values: null })),
    ];
  });
}
// Shared lookup projections must not erase labels already authorised by another module.
export function mergeProductionSnapshot(base, snapshot) {
  const merged = { ...base, ...snapshot };
  for (const table of ['contacts', 'attachments']) {
    const rows = new Map((base[table] || []).map((r) => [r.id, r]));
    for (const row of snapshot[table] || []) rows.set(row.id, { ...rows.get(row.id), ...row });
    merged[table] = [...rows.values()];
  }
  return merged;
}
export function productionCommands(client) {
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    if (data?._live) {
      for (const rows of Object.values(data))
        if (Array.isArray(rows))
          for (const row of rows)
            for (const [key, value] of Object.entries(row || {}))
              if (
                (key === 'id' || key.endsWith('_id')) &&
                value != null &&
                typeof value !== 'string'
              )
                throw Error(`Unsafe Production identifier: ${key}`);
    }
    return data;
  }
  const load = () => rpc('erp_production_workspace');
  return {
    load,
    async image(id) {
      const result = await liveFileCommands(client).store([]).open({ id });
      return result.url;
    },
    async saveSetup({ resource, before, after, id }) {
      const table = Object.keys(productionContract[resource])[0];
      const previous = (before[table] || []).find((r) => r.id === id);
      const root =
        previous ||
        (after[table] || []).find((r) => !(before[table] || []).some((p) => p.id === r.id));
      if (!root) throw Error('Reload and reopen this record.');
      const changes = productionChanges(before, after, resource);
      return changes.length
        ? rpc('erp_save_production_setup', {
            p_resource: resource,
            p_root: { table, id: root.id, before: previous || null },
            p_action: previous ? 'edit' : 'create',
            p_changes: changes,
          })
        : load();
    },
    async start(data, part, employee) {
      const stage = [...data.stage].sort((a, b) => a.sort_order - b.sort_order)[0];
      await rpc('erp_move_production', {
        p_payload: {
          action: 'start',
          item_part_id: part,
          to_stage_id: stage.id,
          verified_by: employee,
          pieces: [],
        },
        p_proof: null,
      });
      return load();
    },
    async saveTask(data, before, after) {
      const record = data.production_records.find((r) => r.production.id === before.id);
      const handover = after.handovers?.at(-1);
      if (handover && handover.visit === before.visitId) {
        const target = data.stage.find((s) => s.name === handover.destination);
        const source = data.stage.find((s) => s.name === before.stage);
        const rectify = target.sort_order < source.sort_order;
        const employee = data.employee.find((e) => employeeLabel(e) === handover.employee);
        const targetJob = record.jobs.find(
          (j) => j.stage_id === target.id && before.path.includes(j.id),
        );
        await rpc('erp_move_production', {
          p_payload: {
            action: rectify ? 'rectify' : 'advance',
            production_id: before.id,
            from_job_id: before.currentJobId,
            ...(rectify
              ? { to_job_id: targetJob?.id, reason: after.rectifyReason || '' }
              : { to_stage_id: target.id }),
            verified_by: employee?.id,
            expected_transition_id: before.visitId,
            pieces: handover.pieces.map((p) => ({
              variant_item_id: p.variantItemId,
              item_size_list_id: p.itemSizeId,
              pieces_stock_out: Number(p.output),
            })),
          },
          p_proof: null,
        });
        return load();
      }
      if (after.priority !== before.priority)
        throw Error('Priority is unavailable in the live database.');
      const idFor = (table, label, field) =>
        data[table].find((r) => r[field] === label)?.id || null;
      return rpc('erp_edit_production_task', {
        p_id: before.id,
        p_expected: record.revision,
        p_job: before.currentJobId,
        p_status: idFor('item_status_list', after.status, 'status'),
        p_due: after.due || null,
        p_assignees: after.assignees.map((label) => {
          const e = data.employee.find((r) => employeeLabel(r) === label);
          if (!e) throw Error('Reload employee choices.');
          return e.id;
        }),
        p_flags: after.flags.map((f) => idFor('flags_list', f, 'name')),
        p_checklist: Object.fromEntries(
          Object.entries(checklistColumns).map(([label, key]) => [
            key,
            idFor('item_status_list', after.checklist?.[label], 'status'),
          ]),
        ),
        p_expected_checklist:
          data.production_checklist.find((c) => c.item_id === before.itemId) || null,
      });
    },
  };
}
