const labStatuses = [
  ['ld-at-dyer', 'At Dyer', 1],
  ['ld-awaiting', 'Awaiting buyer comments', 2],
  ['ld-failed', 'Failed', 3],
  ['ld-swatch', 'Attached Swatch', 4],
  ['ld-comments', 'Approved with comments', 5],
  ['ld-approved', 'Approved', 6],
];
export function upgradeColours(data) {
  if (data.lab_dip && data.lab_dip_version && data.lab_dip_version_status) return data;
  const next = structuredClone(data);
  next.lab_dip ||= [];
  next.lab_dip_version ||= [];
  next.lab_dip_version_status ||= labStatuses.map(([id, status, sort_order]) => ({
    id,
    status,
    sort_order,
  }));
  for (const m of next.color_map_by_brand) {
    const dyers = new Set(
      [
        m.dyer_id,
        ...next.dyeing_program_item
          .filter((i) => i.color_map_by_brand_id === m.id)
          .map((i) => next.dyeing_program.find((p) => p.id === i.dyeing_program_id)?.dyer_id),
      ].filter(Boolean),
    );
    for (const dyer of dyers) {
      if (next.lab_dip.some((l) => l.color_map_by_brand_id === m.id && l.dyer_id === dyer))
        continue;
      const id = crypto.randomUUID();
      next.lab_dip.push({
        id,
        color_map_by_brand_id: m.id,
        dyer_id: dyer,
        edition: 1,
        date: '',
        created_at: null,
        updated_at: null,
      });
      next.lab_dip_version.push({
        id: crypto.randomUUID(),
        lab_dip_id: id,
        version: 1,
        date: '',
        shade_card_no: m.shade_card_no || '',
        shade_card_option: m.shade_card_option || '',
        comments: 'Legacy reference: approval status was not recorded.',
        lab_dip_status_id: null,
        shade_card_image_attachment: null,
        attached_swatch: false,
        created_at: null,
        updated_at: null,
      });
    }
  }
  return next;
}
export function versionsFor(data, id) {
  return (data.lab_dip_version || [])
    .filter((v) => v.lab_dip_id === id)
    .sort((a, b) => a.version - b.version);
}
export function statusFor(data, v) {
  return data.lab_dip_version_status.find((s) => s.id === v?.lab_dip_status_id);
}
export function labClosed(data, id) {
  return versionsFor(data, id).some((v) => (statusFor(data, v)?.sort_order || 0) >= 4);
}
export function labLabels(data, l) {
  const mapping = data.color_map_by_brand.find((m) => m.id === l.color_map_by_brand_id),
    colour = data.color_map.find((c) => c.id === mapping?.color_map_id),
    brand = data.brand_list.find((b) => b.id === mapping?.brand_list_id),
    dyer = data.dyer.find((d) => d.id === l.dyer_id);
  return {
    name: colour?.name || 'Unknown colour',
    brand: brand?.brand || '—',
    dyer: data.contacts.find((c) => c.id === dyer?.contacts_id)?.company_name || '—',
  };
}
export function labRows(data) {
  return (data.lab_dip || []).map((l) => {
    const labels = labLabels(data, l),
      latest = versionsFor(data, l.id).at(-1),
      status = statusFor(data, latest),
      display = !latest
        ? 'No versions yet'
        : !status
          ? 'Status not recorded'
          : latest.version > 1 && status.sort_order <= 3
            ? `Redo ${latest.version} · ${status.status}`
            : status.status;
    return {
      id: l.id,
      documentId: l.id,
      ...labels,
      edition: l.edition,
      version: latest?.version || 0,
      date: latest?.date || '—',
      status: display,
      shade: latest?.shade_card_no || '—',
      option: latest?.shade_card_option || '—',
      comments: latest?.comments || '—',
      attachment: latest?.shade_card_image_attachment
        ? data.attachments.find((a) => a.id === latest.shade_card_image_attachment)?.filename ||
          'Attached'
        : '—',
      updated: latest?.updated_at || 'Unknown',
    };
  });
}
export function saveLabDip(data, input) {
  const next = structuredClone(data),
    now = new Date().toISOString(),
    status = next.lab_dip_version_status.find((s) =>
      input.attached_swatch ? s.sort_order === 4 : s.id === input.lab_dip_status_id,
    );
  if (!status) throw Error('Choose a status.');
  const swatch = Boolean(input.attached_swatch),
    versionDate = input.date;
  let lab = next.lab_dip.find((l) => l.id === input.id);
  if (input.id && !lab) throw Error('This lab dip no longer exists.');
  if (!lab) {
    if (
      !next.color_map_by_brand.some((m) => m.id === input.color_map_by_brand_id) ||
      !next.dyer.some((d) => d.id === input.dyer_id)
    )
      throw Error('Choose a colour mapping and dyer.');
    lab = {
      id: crypto.randomUUID(),
      color_map_by_brand_id: input.color_map_by_brand_id,
      dyer_id: input.dyer_id,
      date: versionDate,
      edition:
        Math.max(
          0,
          ...next.lab_dip
            .filter(
              (l) =>
                l.color_map_by_brand_id === input.color_map_by_brand_id &&
                l.dyer_id === input.dyer_id,
            )
            .map((l) => l.edition),
        ) + 1,
      created_at: now,
      updated_at: now,
    };
    next.lab_dip.push(lab);
  }
  if (labClosed(next, lab.id)) throw Error('This edition is completed. Create a new edition.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || Number.isNaN(Date.parse(input.date)))
    throw Error('Enter a valid version date.');
  if (
    input.shade_card_image_attachment &&
    !next.attachments.some((a) => a.id === input.shade_card_image_attachment)
  )
    throw Error('Choose an existing attachment.');
  const latest = versionsFor(next, lab.id).at(-1);
  if (latest && input.mode !== 'update' && statusFor(next, latest)?.sort_order !== 3)
    throw Error('The latest version must be Failed before adding another version.');
  let version;
  if (input.mode === 'update' && latest) {
    version = next.lab_dip_version.find((v) => v.id === latest.id);
  } else {
    version = {
      id: crypto.randomUUID(),
      lab_dip_id: lab.id,
      version: (latest?.version || 0) + 1,
      created_at: now,
    };
    next.lab_dip_version.push(version);
  }
  if (latest?.date && input.mode !== 'update' && input.date < latest.date)
    throw Error('A new version cannot be dated before the previous version.');
  Object.assign(version, {
    date: versionDate,
    lab_dip_status_id: status.id,
    shade_card_no: swatch ? null : input.shade_card_no?.trim() || null,
    shade_card_option: swatch ? null : input.shade_card_option?.trim() || null,
    shade_card_image_attachment: input.shade_card_image_attachment || null,
    comments: input.comments?.trim() || '',
    attached_swatch: swatch,
    updated_at: now,
  });
  return next;
}
