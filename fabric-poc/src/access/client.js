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

export async function getLoginMethods() {
  const env = readEnvironment({ ...import.meta.env, VITE_DATA_MODE: 'supabase' });
  const response = await fetch(new URL('/auth/v1/settings', env.url), {
    headers: { apikey: env.publishableKey },
  });
  if (!response.ok) throw Error('Login settings could not be loaded.');
  const settings = await response.json();
  return { phone: settings.external?.phone === true, email: settings.external?.email === true };
}
