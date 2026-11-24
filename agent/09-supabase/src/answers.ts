import type { SupabaseOptions } from './stores'

/** One row of hala_knowledge_answers: a question callers asked, and what DSO staff answered. */
export interface KnowledgeAnswer {
  id: string
  question: string
  serviceId?: string
  answerEn?: string
  answerAr?: string
  status: string
  answeredAt?: string
  updatedAt: string
  timesUsed: number
}

/** Read-only fetch of the staff answer bank. Plain fetch, service key, server side only. */
export async function listKnowledgeAnswers(o: SupabaseOptions, limit = 1000): Promise<KnowledgeAnswer[]> {
  const f = o.fetch ?? fetch
  const base = o.url.replace(/\/$/, '')
  const res = await f(`${base}/rest/v1/hala_knowledge_answers?select=*&order=updated_at.desc&limit=${limit}`, {
    headers: { apikey: o.serviceKey, authorization: `Bearer ${o.serviceKey}` }
  })
  if (!res.ok) throw new Error(`hala_knowledge_answers: HTTP ${res.status}`)
  const rows = (await res.json()) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: String(r.id), question: String(r.question ?? ''), serviceId: (r.service_id as string) || undefined,
    answerEn: ((r.answer_en as string) || '').trim() || undefined, answerAr: ((r.answer_ar as string) || '').trim() || undefined,
    status: String(r.status ?? ''), answeredAt: (r.answered_at as string) || undefined, updatedAt: String(r.updated_at), timesUsed: Number(r.times_used ?? 0)
  }))
}
