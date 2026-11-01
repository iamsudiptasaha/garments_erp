import { createClient } from '@supabase/supabase-js';
import { getAccessClient } from '../access/client.js';
import { readEnvironment } from '../foundation/environment.js';
export function employeeCommands(client = getAccessClient()) {
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  return {
    load: () => rpc('erp_employee_snapshot'),
    save: (payload, proof) =>
      rpc('erp_save_employee', { p_payload: payload, p_proof: proof || null }),
    reference: (table, id, name, expected) =>
      rpc('erp_save_employee_reference', {
        p_table: table,
        p_id: id || null,
        p_name: name,
        p_expected: expected || null,
      }),
  };
}
function isolatedVerifier() {
  const env = readEnvironment({ ...import.meta.env, VITE_DATA_MODE: 'supabase' });
  return createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'erp-verifier-' + crypto.randomUUID(),
    },
  });
}
// Passwords and verifier sessions never enter localStorage or replace the operator session.
export async function verifyEmployeePassword(
  { email, password, employeeId, actor, payload },
  makeVerifier = isolatedVerifier,
) {
  const verifier = makeVerifier();
  try {
    const signed = await verifier.auth.signInWithPassword({ email, password });
    if (signed.error) throw Error('The selected employee’s password could not be verified.');
    const { data, error } = await verifier.rpc('erp_employee_attestation', {
      p_actor: actor,
      p_employee: employeeId,
      p_payload: payload,
    });
    if (error) throw Error(error.message);
    return data;
  } finally {
    await verifier.auth.signOut({ scope: 'local' });
  }
}
