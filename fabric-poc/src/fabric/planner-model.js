// Projection only: required kg, estimates and status are calculated by PostgreSQL.
export function plannerRequirements(snapshot) {
  const byId = (rows = []) => new Map(rows.map((row) => [String(row.id), row]));
  const variants = byId(snapshot.variants),
    labs = byId(snapshot.lab_dips);
  const fabrics = byId(snapshot.fabric_types),
    parts = byId(snapshot.sub_parts),
    statuses = byId(snapshot.statuses);
  return [...byId(snapshot.requirements).values()].flatMap((requirement) => {
    const parent = variants.get(String(requirement.variant_item_id));
    if (!parent) return [];
    const lab = labs.get(String(requirement.lab_dip_id));
    return [
      {
        id: String(requirement.id),
        documentId: String(requirement.id),
        variantItemId: String(parent.id),
        variantId: String(requirement.variant_id),
        colour: lab?.colour || 'Unclassified',
        style: parent.style_code || '—',
        variant: parent.variant || '—',
        part: parent.part || '—',
        subpart:
          requirement.sub_part_name ||
          parts.get(String(requirement.sub_part_list_id))?.part ||
          'Unspecified',
        lab: lab?.name || 'Unclassified',
        labId: requirement.lab_dip_id,
        fabricId: 'fabric-' + requirement.fabric_type_id,
        fabric: fabrics.get(String(requirement.fabric_type_id))?.name || 'Unclassified',
        required: Number(requirement.required_kg || 0),
        status:
          statuses.get(String(requirement.item_part_fabric_status_id))?.type || 'Unclassified',
        requirement,
        parent,
      },
    ];
  });
}
export const plannerFields = [
  ['colour', 'Colour'],
  ['style', 'Style Code'],
  ['variant', 'Variant'],
  ['part', 'Production Part'],
  ['subpart', 'Fabric Sub-part'],
  ['lab', 'Lab Dip'],
];
export function plannerFabrics(records) {
  return [
    ...new Map(records.map((r) => [r.fabricId, { id: r.fabricId, name: r.fabric }])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
export function plannerMatrix(records, fabrics) {
  return records.map((r) => ({
    ...r,
    ...Object.fromEntries(fabrics.map((f) => [f.id, f.id === r.fabricId ? r.required : ''])),
  }));
}
export function plannerGroups(records) {
  return [...new Set(records.map((r) => r.colour))]
    .sort()
    .map((colour) => ({ colour, records: records.filter((r) => r.colour === colour) }));
}
export function plannerTotal(records, fabricId) {
  return records.filter((r) => r.fabricId === fabricId).reduce((sum, r) => sum + r.required, 0);
}
export function plannerSheetRows(records, fabrics) {
  const total = (rows, colour, summary) => ({
    id: summary + ':' + colour,
    colour,
    style: '',
    variant: '',
    part: '',
    subpart: '',
    lab: '',
    status: '',
    summary,
    displayValues: { colour: [summary === 'subtotal' ? colour + ' subtotal' : colour] },
    ...Object.fromEntries(fabrics.map((f) => [f.id, plannerTotal(rows, f.id)])),
  });
  return plannerGroups(records)
    .flatMap((g) => [...plannerMatrix(g.records, fabrics), total(g.records, g.colour, 'subtotal')])
    .concat(total(records, 'Grand total', 'grand'));
}
