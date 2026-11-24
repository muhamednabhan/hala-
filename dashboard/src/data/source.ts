import type { Booking, CallDetail, ConversationRow, Db, FeedItem, Filters, Insight, Kpis, RequestStatus } from './types';

export interface RequestPatch {
  status?: RequestStatus;
  assigned_to?: string | null;
  note?: string | null;
}

export interface GapAnswer {
  answer_en: string;
  answer_ar?: string | null;
  service: string;
}

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
  /** Patterns found in the collected data (pitch: "what the data is telling us"). */
  getInsights(filters: Filters): Promise<Insight[]>;
  /** Conversations with ElevenLabs transcripts; `query` searches transcript + summary. */
  getConversations(filters: Filters, query?: string): Promise<ConversationRow[]>;
  /** Most recent call (in progress or just ended) with its live transcript. */
  getLatestCall(filters: Filters): Promise<CallDetail | null>;

  /** Called whenever underlying data changes (mock timer / Supabase realtime). Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;

  /** All tables after the global filter bar; list pages derive their rows from this. */
  getSnapshot(filters: Filters): Promise<Db>;

  // ---- Admin actions (every button that changes data goes through here) ----
  updateRequest(id: string, patch: RequestPatch): Promise<void>;
  /** Logs `followup_sent` / `callback_scheduled` against a request. */
  logFollowup(requestId: string, type: 'followup_sent' | 'callback_scheduled', detail: string): Promise<void>;
  /** Teach the agent: the agent's lookup_admin_answers tool reads answered gaps. */
  answerGap(id: string, answer: GapAnswer): Promise<void>;
  setGapStatus(id: string, status: 'waiting' | 'out_of_scope'): Promise<void>;
  /** picked_up / resolved; resolving also marks the handed-over request solved. */
  updateHandover(id: string, status: 'picked_up' | 'resolved'): Promise<void>;
  updateBooking(id: string, patch: { status: Booking['status']; slot_at?: string }): Promise<void>;
}
