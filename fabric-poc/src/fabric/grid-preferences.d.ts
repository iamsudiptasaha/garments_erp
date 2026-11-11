import type { SupabaseClient } from '@supabase/supabase-js';

/** @public */
export function useGridPreferences<T extends object = Record<string, unknown>>(
  client: SupabaseClient | null | undefined,
  page: string,
  defaults?: T,
): { ready: boolean; preferences: T; save: (patch: Partial<T>) => void; error: string };
