// A receipt starts with an order or a finished fabric batch. Keep dependent
// values together so switching sources cannot leave a hidden supplier/item.
export function receiptModeFor(header) {
  return header.dyed_fabric_item_id ? 'fabric' : header.purchase_order_id ? 'order' : '';
}
export function switchReceiptMode(header, mode) {
  return {
    ...header,
    purchase_order_id: null,
    raw_material_purchase_order_item_id: null,
    raw_material_item_id: null,
    dyed_fabric_item_id: null,
    raw_material_supplier_list_id: null,
    _receiptMode: mode,
  };
}
export function updateReceipt(data, header, key, value) {
  const next = { ...header, [key]: value || null };
  if (key === 'purchase_order_id') {
    next.raw_material_purchase_order_item_id = null;
    next.raw_material_item_id = null;
    const order = data.raw_material_purchase_order.find((row) => row.id === value);
    next.raw_material_supplier_list_id = order?.raw_material_supplier_list_id ?? null;
    next.dyed_fabric_item_id = null;
  }
  if (key === 'raw_material_purchase_order_item_id') {
    const line = data.raw_material_purchase_order_item.find((row) => row.id === value);
    next.raw_material_item_id = line?.raw_material_item_id ?? null;
  }
  if (key === 'dyed_fabric_item_id') {
    next.raw_material_purchase_order_item_id = null;
    next.purchase_order_id = null;
    next.raw_material_item_id = null;
    next.raw_material_supplier_list_id = null;
  }
  return next;
}
export function receiptFields(spec, data, mode, header) {
  const byKey = Object.fromEntries(spec.header.map((f) => [f.key, f]));
  const order = data.raw_material_purchase_order.find((r) => r.id === header.purchase_order_id);
  const source =
    mode === 'order'
      ? [
          { ...byKey.purchase_order_id, required: true },
          {
            ...byKey.raw_material_supplier_list_id,
            required: true,
            disabled: true,
            options: data.raw_material_supplier_list
              .filter((r) => r.id === order?.raw_material_supplier_list_id)
              .map((r) => [
                r.id,
                data.contacts.find((c) => c.id === r.contacts_id)?.company_name || '—',
              ]),
          },
          {
            ...byKey.raw_material_purchase_order_item_id,
            required: true,
            disabled: !order,
            options: data.raw_material_purchase_order_item
              .filter((r) => r.raw_material_purchase_order_id === order?.id)
              .map((r) => {
                const m = data.raw_material_item.find((m) => m.id === r.raw_material_item_id),
                  unit = data.unit_of_measure.find((u) => u.id === m?.unit_of_measure_id)?.unit;
                return [r.id, `${m?.name} · ${r.quantity} ${unit} ordered · Line ${r.id}`];
              }),
          },
        ]
      : mode === 'fabric'
        ? [{ ...byKey.dyed_fabric_item_id, required: true }]
        : [];
  return {
    ...spec,
    header: mode
      ? [
          ...source,
          ...['date', 'quantity', 'price', 'invoice_number', 'verified_by_employee_id'].map(
            (key) => byKey[key],
          ),
        ]
      : [],
  };
}
export function normaliseReceipt(data, header) {
  if (!header.dyed_fabric_item_id && !header.raw_material_item_id)
    throw Error('Choose exactly one material or dyed-fabric batch.');
  if (header.dyed_fabric_item_id) {
    header.purchase_order_id = null;
    header.raw_material_purchase_order_item_id = null;
    header.raw_material_supplier_list_id = null;
  } else {
    if (!header.purchase_order_id) throw Error('Select a purchase order or a fabric batch first.');
    const order = data.raw_material_purchase_order.find((p) => p.id === header.purchase_order_id);
    if (!order) throw Error('The linked raw material purchase order is missing.');
    if (!header.raw_material_supplier_list_id)
      throw Error('Select the supplier for this purchase order.');
    if (header.raw_material_supplier_list_id !== order.raw_material_supplier_list_id)
      throw Error('Receipt supplier must match the purchase order supplier.');
    const matches = data.raw_material_purchase_order_item.filter(
      (line) =>
        line.raw_material_purchase_order_id === order.id &&
        line.raw_material_item_id === header.raw_material_item_id,
    );
    const line = header.raw_material_purchase_order_item_id
      ? data.raw_material_purchase_order_item.find(
          (row) => row.id === header.raw_material_purchase_order_item_id,
        )
      : matches.length === 1
        ? matches[0]
        : null;
    if (!line || line.raw_material_purchase_order_id !== order.id)
      throw Error('The material is not on the selected purchase order.');
    if (header.raw_material_item_id && header.raw_material_item_id !== line.raw_material_item_id)
      throw Error('The selected order item does not match this material.');
    header.raw_material_item_id = line.raw_material_item_id;
    header.raw_material_purchase_order_item_id = line.id;
  }
  if (!header.sku) {
    let n = data.raw_material_check_in.length + 1;
    while (data.raw_material_check_in.some((r) => r.sku === `RCV-${String(n).padStart(6, '0')}`))
      n++;
    header.sku = `RCV-${String(n).padStart(6, '0')}`;
  }
}
