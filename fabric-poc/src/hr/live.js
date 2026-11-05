import { getAccessClient } from '../access/client.js';
export function employeeCommands(client = getAccessClient()) {
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  return {
    load: () => rpc('erp_employee_snapshot'),
    save: (payload) => rpc('erp_save_employee', { p_payload: payload, p_proof: null }),
    setActive: (id, active, expected) =>
      rpc('erp_set_employee_active', { p_id: id, p_active: active, p_expected: expected }),
    reference: (table, id, name, expected) =>
      rpc('erp_save_employee_reference', {
        p_table: table,
        p_id: id || null,
        p_name: name,
        p_expected: expected || null,
      }),
  };
}
