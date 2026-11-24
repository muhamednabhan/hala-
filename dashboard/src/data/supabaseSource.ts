// Live mode: read the schema.sql tables from Supabase and reuse the same compute functions as mock.
// Not exercised yet (build step 8). Mock mode never touches this file's network code.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildCallDetail, buildFeed, computeKpis } from './compute';
import type { DataSource } from './source';
import type { Db } from './types';

const TABLES = ['calls', 'requests', 'events', 'bookings', 'tasks', 'handovers', 'knowledge_gaps', 'feedback'] as const;

export function createSupabaseSource(url: string, anonKey: string): DataSource {
  const client: SupabaseClient = createClient(url, anonKey);
  let cache: Promise<Db> | null = null;
  const listeners = new Set<() => void>();
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const load = (): Promise<Db> => {
    if (!cache) {
      cache = Promise.all(
        TABLES.map(async (t) => {
          const { data, error } = await client.from(t).select('*').limit(5000);
          if (error) throw new Error(`${t}: ${error.message}`);
          return [t, data ?? []] as const;
        }),
      )
        .then((entries) => Object.fromEntries(entries) as unknown as Db)
        .catch((e) => {
          cache = null; // retry on next read
          throw e;
        });
    }
    return cache;
  };

  return {
    mode: 'live',
    getKpis: async (f) => computeKpis(await load(), f),
    getLiveFeed: async (f, limit) => buildFeed(await load(), f, limit),
    getCall: async (id) => buildCallDetail(await load(), id),
    subscribe(onChange) {
      listeners.add(onChange);
      if (!channel) {
        channel = client
          .channel('dashboard')
          .on('postgres_changes', { event: '*', schema: 'public' }, () => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              cache = null;
              listeners.forEach((fn) => fn());
            }, 300);
          })
          .subscribe();
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && channel) {
          client.removeChannel(channel);
          channel = null;
        }
      };
    },
  };
}
