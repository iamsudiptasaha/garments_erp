import { saveVerifiedDyedBill } from './bill-verification.js';
import { latestStatusItem, legacyStatusItems } from '../colours/domain.js';
import { fabricContract, fabricColumnTypes } from './live-contract.js';
export const liveFabricPage = (key) => Object.hasOwn(fabricContract, key);
export function emptyLiveFabric(template) {
  return Object.fromEntries(
    Object.keys(template).map((k) => [k, Array.isArray(template[k]) ? [] : template[k]]),
  );
}
function editable(row, fields) {
  return Object.fromEntries(fields.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]));
}
function versionWrite(data, row) {
  const item = latestStatusItem(data, row);
  if (!item) throw Error('Lab-dip version is missing its current status item.');
  // Compatibility transport only: the document RPC atomically writes review fields
  // into lab_dip_version_item; these are not physical version columns.
  return {
    ...row,
    date: item.date,
    comments: item.comments,
    lab_dip_status_id: item.lab_dip_status_id,
  };
}
export function fabricChanges(before, after, resource) {
  const contract = fabricContract[resource];
  if (!contract) throw Error('This section is not connected for live saving.');
  const changes = [];
  for (const [table, fields] of Object.entries(contract)) {
    const old = new Map((before[table] || []).map((r) => [r.id, r])),
      current = new Map((after[table] || []).map((r) => [r.id, r]));
    for (const r of current.values()) {
      const previous = old.get(r.id),
        isVersion = table === 'lab_dip_version',
        values = editable(isVersion ? versionWrite(after, r) : r, fields);
      const priorValues =
        previous && editable(isVersion ? versionWrite(before, previous) : previous, fields);
      if (!previous || JSON.stringify(values) !== JSON.stringify(priorValues))
        changes.push({ table, id: r.id, before: previous || null, values });
    }
    for (const r of old.values())
      if (!current.has(r.id)) changes.push({ table, id: r.id, before: r, values: null });
  }
  if (resource === 'programs') {
    const key = (l) => `${l.item_part_fabric_id}:${l.dyeing_program_item_id}`;
    const old = new Map((before.fabric_plan_dyeing_link || []).map((l) => [key(l), l]));
    const current = new Map((after.fabric_plan_dyeing_link || []).map((l) => [key(l), l]));
    for (const [id, values] of current)
      if (!old.has(id))
        changes.push({
          table: 'fabric_plan_dyeing_link',
          id,
          before: null,
          values,
          reviewed_required_kg:
            after._program_planner_totals?.[values.dyeing_program_item_id] ?? null,
        });
    for (const [id, previous] of old)
      if (!current.has(id))
        changes.push({ table: 'fabric_plan_dyeing_link', id, before: previous, values: null });
  }
  return changes;
}
function reviewSnapshot(data) {
  // Compatibility projection for roles whose snapshot omits review-history rows.
  return data?.lab_dip_version && !data.lab_dip_version_item
    ? { ...data, lab_dip_version_item: legacyStatusItems(data.lab_dip_version) }
    : data;
}
export function liveFabricCommands(client, createVerifierClient) {
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return reviewSnapshot(data);
  }
  return {
    load: async () => {
      const snapshot = await rpc('erp_fabric_snapshot');
      const verifiers = await client.rpc('erp_dyed_bill_verifiers');
      // Existing Fabric pages remain usable while the reviewed migration is pending.
      // Bill saves stay blocked when no verification service is available.
      if (verifiers.error && verifiers.error.code !== 'PGRST202')
        throw Error(verifiers.error.message);
      return {
        ...snapshot,
        dyed_bill_verifiers: Array.isArray(verifiers.data) ? verifiers.data : [],
      };
    },
    save: ({ resource, root, action, before, after, verification }) => {
      const changes = fabricChanges(before, after, resource);
      if (resource === 'dyeBills') {
        if (!createVerifierClient) throw Error('Employee verification is unavailable.');
        if (!changes.length)
          changes.push({
            table: root.table,
            id: root.id,
            before: root.before,
            values: editable(root.before, fabricContract.dyeBills.dyed_fabric_bill),
          });
        return saveVerifiedDyedBill(
          client,
          createVerifierClient,
          { resource, root, action, changes },
          verification,
          before.dyed_bill_verifiers || [],
        ).then(reviewSnapshot);
      }
      // A single review-only edit uses the owning child API and its revision check.
      // New versions and mixed metadata/review edits stay in one document transaction.
      if (resource === 'labDips' && action === 'edit' && changes.length === 1) {
        const change = changes[0];
        if (change.table === 'lab_dip_version' && change.before && change.values) {
          const metadata = fabricContract.labDips.lab_dip_version.filter(
            (key) => !['date', 'comments', 'lab_dip_status_id'].includes(key),
          );
          if (
            metadata.every((key) => (change.before[key] ?? null) === (change.values[key] ?? null))
          ) {
            const previous = latestStatusItem(before, change.before);
            if (!previous?.id) throw Error('Reload the current Lab Dip review before saving.');
            return rpc('erp_add_lab_dip_review', {
              p_version: change.id,
              p_status: change.values.lab_dip_status_id,
              p_date: change.values.date,
              p_comments: change.values.comments,
              p_expected_review: previous.id,
            });
          }
        }
      }
      return changes.length
        ? rpc('erp_save_fabric_document', {
            p_resource: resource,
            p_root: root,
            p_action: action,
            p_changes: changes,
          })
        : rpc('erp_fabric_snapshot');
    },
  };
}
export function assertLiveIdentifiers(snapshot) {
  for (const [table, types] of Object.entries(fabricColumnTypes))
    for (const row of snapshot[table] || [])
      for (const [key, type] of Object.entries(types))
        if (type === 'bigint' && row[key] != null && typeof row[key] !== 'string')
          throw Error(`Unsafe identifier received for ${table}.${key}`);
  return snapshot;
}
export function fabricRoot(resource, before, after, editor) {
  const contract = fabricContract[resource],
    tables =
      resource === 'suppliers' ? ['yarn_supplier', 'knitter', 'dyer'] : [Object.keys(contract)[0]];
  for (const table of tables) {
    const added = (after[table] || []).find(
      (r) => !(before[table] || []).some((old) => old.id === r.id),
    );
    if (added) return { table, id: added.id, before: null };
  }
  let table = tables[0],
    id = editor.id;
  if (resource === 'suppliers') {
    [table, id] = id.split(':');
  }
  const row = (before[table] || []).find((r) => r.id === id);
  if (!row) throw Error('Cannot identify the record being saved. Reload and reopen it.');
  return { table, id, before: row };
}
