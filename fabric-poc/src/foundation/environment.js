/** Validate public browser configuration without creating a network client. */
export function readEnvironment(env = {}) {
  const mode = env.VITE_DATA_MODE || 'demo';
  if (!['demo', 'supabase'].includes(mode)) {
    throw new Error('VITE_DATA_MODE must be demo or supabase.');
  }
  // Configuration validation does not make the current demo a live application.
  if (mode === 'demo') return Object.freeze({mode});

  let url;
  try { url = new URL(env.VITE_SUPABASE_URL); }
  catch { throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('VITE_SUPABASE_URL must be an HTTPS origin without credentials.');
  }
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (!publishableKey.startsWith('sb_publishable_') || publishableKey.length <= 'sb_publishable_'.length) {
    throw new Error('Use a Supabase publishable key in browser configuration.');
  }
  return Object.freeze({mode, url: url.origin, publishableKey, schema:'garments_erp'});
}
