const transactionFields = {
  materialReceipts: {
    inward_date: 'date',
    billed_quantity: 'quantity',
    billed_price: 'price',
    material_category_id: 'material_category_id',
    raw_material_item_id: 'raw_material_item_id',
    dyed_fabric_item_id: 'dyed_fabric_item_id',
    raw_material_purchase_order_item_id: 'raw_material_purchase_order_item_id',
    invoice_number: 'invoice_number',
    verified_by_employee_id: 'verified_by_employee_id',
  },
  materialIssues: Object.fromEntries(
    [
      'raw_material_check_in_id',
      'date',
      'quantity',
      'check_out_type_id',
      'issue_by_employee_id',
      'variant_item_id',
      'stage_id',
      'remarks',
      'reconciliation',
    ].map((field) => [field, field]),
  ),
};

const setupFields = {
  materials: [
    'name',
    'category_list_id',
    'unit_of_measure_id',
    'raw_material_supplier_list_id',
    'description',
  ],
  materialSuppliers: ['contacts_id', 'contact_purpose_id', 'preferred_transport_id'],
  materialCategories: ['type', 'name', 'description', 'type_abbr', 'series'],
  materialUnits: ['unit', 'description'],
  materialIssueTypes: ['name', 'remarks'],
  materialOrders: ['purchase_order_number', 'raw_material_supplier_list_id', 'employee_id'],
};

export const liveInventoryPage = (page) =>
  Object.hasOwn(transactionFields, page) ||
  Object.hasOwn(setupFields, page) ||
  ['materialStock', 'materialMovements'].includes(page);

function projectReceipt(row, orders, lines) {
  const line = lines.find((entry) => entry.id === row.raw_material_purchase_order_item_id);
  const order = orders.find((entry) => entry.id === line?.raw_material_purchase_order_id);
  return {
    ...row,
    date: row.inward_date,
    quantity: row.billed_quantity,
    price: row.billed_price,
    purchase_order_id: order?.id ?? null,
    raw_material_supplier_list_id: order?.raw_material_supplier_list_id ?? null,
  };
}

export function inventoryCommands(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  return {
    async load() {
      const snapshot = await rpc('erp_raw_material_transaction_snapshot');
      return {
        ...snapshot,
        raw_material_check_in: (snapshot.raw_material_check_in || []).map((row) =>
          projectReceipt(
            row,
            snapshot.raw_material_purchase_order || [],
            snapshot.raw_material_purchase_order_item || [],
          ),
        ),
      };
    },
    async save({ resource, table, before, after, id }) {
      const previous = before[table].find((row) => row.id === id);
      const candidate = previous
        ? after[table].find((row) => row.id === id)
        : after[table].find((row) => !before[table].some((old) => old.id === row.id));
      if (!candidate) throw Error('Inventory record could not be identified.');
      if (Object.hasOwn(setupFields, resource)) {
        const values = Object.fromEntries(
          setupFields[resource].map((field) => [
            field,
            candidate[field] === '' ? null : (candidate[field] ?? null),
          ]),
        );
        const lines =
          resource === 'materialOrders'
            ? after.raw_material_purchase_order_item
                .filter((line) => line.raw_material_purchase_order_id === candidate.id)
                .map((line) => ({
                  id: /^\d+$/.test(line.id) ? line.id : null,
                  raw_material_item_id: line.raw_material_item_id,
                  quantity: line.quantity,
                  price: line.price,
                  description: line.description,
                }))
            : null;
        const saved = await rpc('erp_save_raw_material_setup', {
          p_resource: resource,
          p_id: previous?.id ?? null,
          p_updated_at: previous?.updated_at ?? null,
          p_values: values,
          p_lines: lines,
        });
        if (typeof saved.row?.id !== 'string')
          throw Error('Inventory returned an unsafe record identity.');
        return saved;
      }
      const fields = transactionFields[resource];
      const saved = await rpc('erp_save_raw_material_transaction', {
        p_resource: resource,
        p_id: previous?.id ?? null,
        p_updated_at: previous?.updated_at ?? null,
        p_values: Object.fromEntries(
          Object.entries(fields).map(([field, key]) => [
            field,
            candidate[key] === '' ? null : (candidate[key] ?? null),
          ]),
        ),
      });
      if (typeof saved.id !== 'string')
        throw Error('Inventory returned an unsafe record identity.');
      return {
        row:
          resource === 'materialReceipts'
            ? projectReceipt(
                saved,
                before.raw_material_purchase_order,
                before.raw_material_purchase_order_item,
              )
            : saved,
      };
    },
  };
}
