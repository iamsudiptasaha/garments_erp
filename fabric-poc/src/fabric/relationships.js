import { latestStatusItem, statusFor } from '../colours/domain.js';
// Database-shaped relationships. Legacy conversion is local-preview-only.
export function programContext(data, line) {
  const group = data.dyeing_program_lab_dip?.find((g) => g.id === line?.dyeing_program_lab_dip_id),
    version = data.lab_dip_version.find(
      (v) => v.id === (group?.lab_dip_version_id ?? line?.lab_dip_version_id),
    ),
    lab = data.lab_dip.find((l) => l.id === version?.lab_dip_id);
  return {
    group,
    version,
    lab,
    mappingId: lab?.color_map_by_brand_id || line?.legacy_color_map_by_brand_id || null,
  };
}
export function batchFor(data, id) {
  return (data.batch_no_lab_dip_version_map || []).find((b) => b.dyed_fabric_item_id === id);
}
export function previousBatchLabel(data, id) {
  return (
    (data.batch_no_lab_dip_version_map || []).find((b) => b.id === id)?.batch_no ||
    (id ? 'Batch unavailable' : '—')
  );
}
export function batchesForVersion(data, versionId, excludeProgramId = null) {
  const edition = data.lab_dip_version.find((v) => v.id === versionId)?.lab_dip_id;
  if (!edition) return [];
  return (data.batch_no_lab_dip_version_map || [])
    .filter((b) => {
      const version = data.lab_dip_version.find((v) => v.id === b.lab_dip_version_id);
      const receipt = data.dyed_fabric_item.find((d) => d.id === b.dyed_fabric_item_id);
      const item = data.dyeing_program_item.find((i) => i.id === receipt?.dyeing_program_item_id);
      return (
        version?.lab_dip_id === edition &&
        (!excludeProgramId || item?.dyeing_program_id !== excludeProgramId)
      );
    })
    .sort((a, b) => a.batch_no.localeCompare(b.batch_no, undefined, { numeric: true }));
}

export function versionsForMapping(data, mappingId, dyerId) {
  return data.lab_dip_version
    .filter((v) =>
      data.lab_dip.some(
        (l) =>
          l.id === v.lab_dip_id && l.color_map_by_brand_id === mappingId && l.dyer_id === dyerId,
      ),
    )
    .sort(
      (a, b) =>
        (latestStatusItem(data, b)?.date || '').localeCompare(
          latestStatusItem(data, a)?.date || '',
        ) ||
        data.lab_dip.find((l) => l.id === b.lab_dip_id).edition -
          data.lab_dip.find((l) => l.id === a.lab_dip_id).edition ||
        b.version - a.version ||
        String(b.id).localeCompare(String(a.id), undefined, { numeric: true }),
    );
}
export function versionLabel(data, id) {
  const v = data.lab_dip_version.find((v) => v.id === id),
    l = data.lab_dip.find((l) => l.id === v?.lab_dip_id),
    date = latestStatusItem(data, v)?.date;
  return v
    ? `Edition ${l?.edition} · Version ${v.version} · ${statusFor(data, v)?.status || 'Status not recorded'}${date ? ' · ' + date : ''}`
    : 'Choose a lab-dip version';
}
export function upgradeFabricRelationships(data) {
  const next = structuredClone(data);
  next.batch_no_lab_dip_version_map ||= [];
  for (const table of ['brand_list', 'yarn_supplier', 'knitter', 'dyer'])
    for (const row of next[table]) {
      if (!row.contacts_id || !row.contact_purpose_id) {
        row.contacts_id ||= null;
        row.contact_purpose_id ||= null;
        row._needsContactLinks = true;
      }
    }
  for (const row of next.dyeing_program_item) {
    if (!row.lab_dip_version_id && row.color_map_by_brand_id) {
      const dyer = next.dyeing_program.find((p) => p.id === row.dyeing_program_id)?.dyer_id,
        editions = next.lab_dip.filter(
          (l) =>
            l.color_map_by_brand_id === row.color_map_by_brand_id &&
            l.dyer_id === dyer &&
            l.edition === 1,
        ),
        versions = next.lab_dip_version.filter(
          (v) => editions.some((l) => l.id === v.lab_dip_id) && v.version === 1,
        );
      if (versions.length === 1) row.lab_dip_version_id = versions[0].id;
      else {
        row.legacy_color_map_by_brand_id = row.color_map_by_brand_id;
        row._needsLabDipSelection = true;
      }
    }
    delete row.color_map_by_brand_id;
  }
  for (const row of next.dyed_fabric_item) {
    if (row.batch_no && !batchFor(next, row.id)) {
      const versionId = next.dyeing_program_item.find(
        (p) => p.id === row.dyeing_program_item_id,
      )?.lab_dip_version_id;
      next.batch_no_lab_dip_version_map.push({
        id: crypto.randomUUID(),
        dyed_fabric_item_id: row.id,
        batch_no: row.batch_no,
        lab_dip_version_id: versionId || null,
      });
    }
    delete row.batch_no;
  }
  for (const row of next.dyeing_program_item) {
    const legacy = next.batch_no_lab_dip_version_map.find((b) => b.batch_no === row.batch_no);
    if (legacy && !next.batch_no_lab_dip_version_map.some((b) => b.id === row.batch_no))
      row.batch_no = legacy.id;
  }
  next.dyeing_program_lab_dip ||= [];
  next.fabric_plan_dyeing_link ||= [];
  for (const row of next.dyeing_program_item) {
    if (row.dyeing_program_lab_dip_id) continue;
    const version = next.lab_dip_version.find((v) => v.id === row.lab_dip_version_id);
    if (!version) continue;
    let group = next.dyeing_program_lab_dip.find(
      (g) => g.dyeing_program_id === row.dyeing_program_id && g.lab_dip_id === version.lab_dip_id,
    );
    if (
      group &&
      (group.lab_dip_version_id !== row.lab_dip_version_id ||
        (group.batch_no || null) !== (row.batch_no || null))
    )
      throw Error('Legacy preview has conflicting edition versions or batches.');
    if (!group) {
      group = {
        id: crypto.randomUUID(),
        dyeing_program_id: row.dyeing_program_id,
        lab_dip_id: version.lab_dip_id,
        lab_dip_version_id: row.lab_dip_version_id,
        batch_no: row.batch_no || null,
      };
      next.dyeing_program_lab_dip.push(group);
    }
    row.dyeing_program_lab_dip_id = group.id;
    delete row.lab_dip_version_id;
    delete row.batch_no;
  }
  return next;
}
