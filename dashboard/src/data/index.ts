import { createMockSource } from './mockSource';
import type { DataSource } from './source';
import { createTeamSource } from './teamSource';

/**
 * VITE_DATA_MODE=mock (default): seeded demo data, always works.
 * VITE_DATA_MODE=live: the team's agent server + ElevenLabs (see README). Keys stay in the dev server.
 */
export function createDataSource(): DataSource {
  return import.meta.env.VITE_DATA_MODE === 'live' ? createTeamSource() : createMockSource();
}

export type { DataSource } from './source';
export * from './types';
