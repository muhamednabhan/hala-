// Live mode: read the schema.sql tables from Supabase and reuse the same compute functions as mock.
// Not exercised yet (build step 8). Mock mode never touches this file's network code.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildCallDetail, buildConversations, buildFeed, buildLatestCall, computeKpis, filterDb } from './compute';
import { computeInsights } from './insights';
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

  /** Run a write, throw on error, then refresh every widget. */
  const write = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(error.message);
    cache = null;
    listeners.forEach((fn) => fn());
  };
  const nowIso = () => new Date().toISOString();
  const one = async <T,>(table: string, id: string): Promise<T> => {
    const { data, error } = await client.from(table).select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data as T;
  };

  return {
    mode: 'live',
    getSnapshot: async (f) => filterDb(await load(), f),
    updateRequest: (id, patch) => write(client.from('requests').update({ ...patch, updated_at: nowIso() }).eq('id', id)),
    async logFollowup(requestId, type, detail) {
      const r = await one<{ call_id: string; service: string; status: string }>('requests', requestId);
      await write(client.from('events').insert({ call_id: r.call_id, type, service: r.service, payload: { request_id: requestId, detail } }));
      if (r.status === 'open') await write(client.from('requests').update({ status: 'needs_followup', updated_at: nowIso() }).eq('id', requestId));
    },
    answerGap: (id, a) =>
      write(
        client
          .from('knowledge_gaps')
          .update({ status: 'answered', answer_en: a.answer_en, answer_ar: a.answer_ar || null, service: a.service, answered_by: 'admin', answered_at: nowIso() })
          .eq('id', id),
      ),
    setGapStatus: (id, status) => write(client.from('knowledge_gaps').update({ status }).eq('id', id)),
    async updateHandover(id, status) {
      await write(client.from('handovers').update({ status }).eq('id', id));
      if (status === 'resolved') {
        const h = await one<{ call_id: string; service: string | null }>('handovers', id);
        let q = client.from('requests').update({ status: 'solved', updated_at: nowIso() }).eq('call_id', h.call_id).eq('resolution', 'handed_over');
        if (h.service) q = q.eq('service', h.service);
        await write(q);
      }
    },
    updateBooking: (id, patch) => write(client.from('bookings').update({ ...patch, updated_at: nowIso() }).eq('id', id)),
    getKpis: async (f) => computeKpis(await load(), f),
    getLiveFeed: async (f, limit) => buildFeed(await load(), f, limit),
    getCall: async (id) => buildCallDetail(await load(), id),
    getInsights: async (f) => computeInsights(await load(), f),
    getConversations: async (f, q) => buildConversations(await load(), f, q),
    getLatestCall: async (f) => buildLatestCall(await load(), f),
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
