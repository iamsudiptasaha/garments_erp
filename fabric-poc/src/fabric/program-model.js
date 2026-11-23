import { programContext } from './relationships.js';

const clone = (value) => structuredClone(value);
const kg = (value) => Math.round(Number(value) * 1000) / 1000;
export function programDraft(data, id) {
  return {
    header: clone(
      data.dyeing_program.find((p) => p.id === id) || {
        id: crypto.randomUUID(),
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
        dyer_id: '',
        dyeing_program_status_id: '1',
      },
    ),
    groups: clone((data.dyeing_program_lab_dip || []).filter((g) => g.dyeing_program_id === id)),
    items: clone(data.dyeing_program_item.filter((i) => i.dyeing_program_id === id)),
    recalculations: {},
    links: clone(
      (data.fabric_plan_dyeing_link || []).filter((l) =>
        data.dyeing_program_item.some(
          (i) => i.id === l.dyeing_program_item_id && i.dyeing_program_id === id,
        ),
      ),
    ),
  };
}
export function reconcileProgramLinks(draft, itemId, selectedIds, requirements) {
  const next = clone(draft),
    item = next.items.find((i) => i.id === itemId);
  const group = next.groups.find((g) => g.id === item?.dyeing_program_lab_dip_id);
  if (!group) throw Error('Choose an edition group first.');
  const ids = [...new Set(selectedIds)],
    existing = next.links.filter((l) => l.dyeing_program_item_id === itemId);
  const rows = ids.map((id) => {
    const r = requirements.find((r) => r.id === id);
    if (!r || r.lab_dip_id !== group.lab_dip_id || r.fabric_type_id !== item.fabric_type_id)
      throw Error('Planner links must match the exact edition and fabric type.');
    return r;
  });
  next.links = next.links
    .filter((l) => l.dyeing_program_item_id !== itemId)
    .concat(ids.map((id) => ({ item_part_fabric_id: id, dyeing_program_item_id: itemId })));
  if (ids.some((id) => !existing.some((l) => l.item_part_fabric_id === id))) {
    const total = kg(rows.reduce((sum, r) => sum + Number(r.required_kg), 0));
    item.quantity = total;
    next.recalculations = { ...next.recalculations, [itemId]: total };
  }
  return next;
}
export function addPlannerRequirements(draft, labId, versionId, selectedIds, requirements) {
  let next = clone(draft),
    group = next.groups.find((g) => g.lab_dip_id === labId);
  if (!labId || !versionId) throw Error('Explicitly select an edition and version.');
  if (!group) {
    if (next.groups.length >= 6) throw Error('A program permits at most six edition groups.');
    group = {
      id: crypto.randomUUID(),
      dyeing_program_id: next.header.id,
      lab_dip_id: labId,
      lab_dip_version_id: versionId,
      batch_no: null,
    };
    next.groups.push(group);
  } else if (group.lab_dip_version_id !== versionId)
    throw Error('Manage the existing group version before adding requirements.');
  const selected = selectedIds.map((id) => requirements.find((r) => r.id === id));
  if (!selected.length || selected.some((r) => !r || r.lab_dip_id !== labId))
    throw Error('Select matching planner requirements.');
  for (const fabric of new Set(selected.map((r) => r.fabric_type_id))) {
    let item = next.items.find(
      (i) => i.dyeing_program_lab_dip_id === group.id && i.fabric_type_id === fabric,
    );
    if (!item) {
      item = {
        id: crypto.randomUUID(),
        dyeing_program_id: next.header.id,
        dyeing_program_lab_dip_id: group.id,
        fabric_type_id: fabric,
        quantity: 0,
        comments: '',
      };
      next.items.push(item);
    }
    const complete = next.links
      .filter((l) => l.dyeing_program_item_id === item.id)
      .map((l) => l.item_part_fabric_id);
    next = reconcileProgramLinks(
      next,
      item.id,
      [...complete, ...selected.filter((r) => r.fabric_type_id === fabric).map((r) => r.id)],
      requirements,
    );
  }
  return next;
}
export function saveProgram(data, draft) {
  const next = clone(data),
    id = draft.header.id;
  const existing = data.dyeing_program.find((p) => p.id === id);
  if (!draft.header.dyer_id || !draft.header.date) throw Error('Select the program date and dyer.');
  if (
    !draft.groups.length ||
    draft.groups.length > 6 ||
    new Set(draft.groups.map((g) => g.lab_dip_id)).size !== draft.groups.length
  )
    throw Error('Select one to six distinct editions.');
  if (!draft.items.length) throw Error('Add at least one fabric item.');
  for (const group of draft.groups) {
    const lab = data.lab_dip.find((l) => l.id === group.lab_dip_id),
      version = data.lab_dip_version.find((v) => v.id === group.lab_dip_version_id);
    if (!lab || lab.dyer_id !== draft.header.dyer_id || version?.lab_dip_id !== lab.id)
      throw Error('Select an edition for this dyer and explicitly select its version.');
    if (!draft.items.some((i) => i.dyeing_program_lab_dip_id === group.id))
      throw Error('Remove empty edition groups before saving.');
    if (group.batch_no) {
      const batch = data.batch_no_lab_dip_version_map.find((b) => b.id === group.batch_no);
      if (
        data.lab_dip_version.find((v) => v.id === batch?.lab_dip_version_id)?.lab_dip_id !==
        group.lab_dip_id
      )
        throw Error('Batch No. must belong to the same edition.');
      const receipt = data.dyed_fabric_item.find((d) => d.id === batch.dyed_fabric_item_id);
      if (
        data.dyeing_program_item.find((i) => i.id === receipt?.dyeing_program_item_id)
          ?.dyeing_program_id === id
      )
        throw Error('A program cannot use its own output as Batch No.');
    }
  }
  const oldItems = data.dyeing_program_item.filter((i) => i.dyeing_program_id === id);
  for (const group of draft.groups)
    if (
      (data.dyeing_program_lab_dip || []).some(
        (g) => g.id === group.id && g.dyeing_program_id !== id,
      )
    )
      throw Error('An edition group cannot move between programs.');
  for (const item of draft.items) {
    if (data.dyeing_program_item.some((i) => i.id === item.id && i.dyeing_program_id !== id))
      throw Error('A line cannot be moved from another document.');
    if (
      !draft.groups.some((g) => g.id === item.dyeing_program_lab_dip_id) ||
      !data.fabric_type.some((f) => f.id === item.fabric_type_id) ||
      !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) < 0 ||
      item.quantity === ''
    )
      throw Error('Each row requires a fabric type and non-negative ordered kg.');
    const receipt = data.dyed_fabric_item.some((d) => d.dyeing_program_item_id === item.id);
    if (
      receipt &&
      programContext(data, item).version?.id !==
        draft.groups.find((g) => g.id === item.dyeing_program_lab_dip_id).lab_dip_version_id
    )
      throw Error('Recorded receipt provenance prevents changing this edition/version.');
  }
  if (
    oldItems.some(
      (i) =>
        !draft.items.some((n) => n.id === i.id) &&
        data.dyed_fabric_item.some((d) => d.dyeing_program_item_id === i.id),
    )
  )
    throw Error('Rows with recorded receipts cannot be removed.');
  const header = { ...existing, ...draft.header, program_number: existing?.program_number ?? null };
  if (data._live && existing?.date && existing.date.slice(0, 10) === header.date)
    header.date = existing.date;
  next.dyeing_program = existing
    ? next.dyeing_program.map((p) => (p.id === id ? header : p))
    : [...next.dyeing_program, header];
  next.dyeing_program_lab_dip = (next.dyeing_program_lab_dip || [])
    .filter((g) => g.dyeing_program_id !== id)
    .concat(draft.groups);
  next.dyeing_program_item = next.dyeing_program_item
    .filter((i) => i.dyeing_program_id !== id)
    .concat(draft.items.map((i) => ({ ...i, quantity: Number(i.quantity) })));
  next._program_planner_totals = draft.recalculations || {};
  next.fabric_plan_dyeing_link = (next.fabric_plan_dyeing_link || [])
    .filter((l) => !oldItems.some((i) => i.id === l.dyeing_program_item_id))
    .concat(draft.links);
  return next;
}
