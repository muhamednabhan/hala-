import { createMockSource } from './mockSource';
import type { DataSource } from './source';
import { createSupabaseSource } from './supabaseSource';

/** Picks the data source from VITE_DATA_MODE. Falls back to mock so the demo never breaks. */
export function createDataSource(): DataSource {
  const env = import.meta.env;
  if (env.VITE_DATA_MODE === 'live') {
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
      return createSupabaseSource(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    }
    console.warn('[data] VITE_DATA_MODE=live but Supabase env vars are missing — using mock data.');
  }
  return createMockSource();
}

export type { DataSource } from './source';
export * from './types';
