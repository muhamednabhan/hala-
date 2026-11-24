import type { CallDetail, FeedItem, Filters, Kpis } from './types';

/**
 * The ONLY way the dashboard reads (and later writes) data.
 * Implementations: mockSource.ts (always works) and supabaseSource.ts (live).
 * Widgets never import Supabase directly.
 */
export interface DataSource {
  readonly mode: 'mock' | 'live';

  getKpis(filters: Filters): Promise<Kpis>;
  getLiveFeed(filters: Filters, limit?: number): Promise<FeedItem[]>;
  getCall(callId: string): Promise<CallDetail | null>;

  /** Called whenever underlying data changes (mock timer / Supabase realtime). Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;

  // Actions for later pages (Requests, Follow-ups, Teach, Handovers, Bookings) get added here.
}
