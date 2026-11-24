import { createMockSource } from './mockSource';
import type { DataSource } from './source';
import { createTeamSource } from './teamSource';

const KEY = 'hala:mode';
type Mode = 'mock' | 'live';

/** Live data is possible when the build knows at least one feed is configured on the server. */
export const liveAvailable = () => {
  const p = __HALA_PROXY__;
  return p.supabase || p.eleven || p.talk;
};

/**
 * Which data to show: the header switch (remembered per browser) wins, then VITE_DATA_MODE, then demo.
 * Demo data always works, so a pitch never depends on the network.
 */
export function currentMode(): Mode {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }
  if (saved === 'mock' || saved === 'live') return saved === 'live' && !liveAvailable() ? 'mock' : saved;
  return import.meta.env.VITE_DATA_MODE === 'live' && liveAvailable() ? 'live' : 'mock';
}

export function switchMode(mode: Mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: falls back to VITE_DATA_MODE */
  }
  window.location.reload();
}

export function createDataSource(): DataSource {
  return currentMode() === 'live' ? createTeamSource() : createMockSource();
}

export type { DataSource } from './source';
export * from './types';
