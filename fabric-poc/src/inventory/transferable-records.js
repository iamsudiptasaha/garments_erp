export function receiptQuantity(head) {
  const unit = ['piece', 'pieces'].includes(head.unit)
    ? Number(head.quantity) === 1
      ? 'piece'
      : 'pieces'
    : head.unit || '';
  return `${head.quantity} ${unit}`.trim();
}
export function transferableHeads(data) {
  const state = new Map((data.transferable_receipt_state || []).map((r) => [r.id, r]));
  return (data.raw_material_check_in || [])
    .filter((r) => r.is_transferable)
    .map((r) => {
      const material = (data.raw_material_item || []).find((m) => m.id === r.raw_material_item_id);
      return {
        ...r,
        ...state.get(r.id),
        material: material?.name || '—',
        unit:
          (data.unit_of_measure || []).find((u) => u.id === material?.unit_of_measure_id)?.unit ||
          '',
        events: (data.transferable_item_movement || []).filter(
          (e) => e.raw_material_check_in_id === r.id,
        ),
      };
    });
}
