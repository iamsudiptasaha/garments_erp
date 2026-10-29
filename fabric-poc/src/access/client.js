import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../foundation/environment.js';
let client;
export function getAccessClient() {
  if (!client) {
    const env = readEnvironment({ ...import.meta.env, VITE_DATA_MODE: 'supabase' });
    client = createClient(env.url, env.publishableKey);
  }
  return client;
}
