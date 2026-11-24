import { createHash } from 'node:crypto'
import type { KnowledgeAnswer } from '@hala/supabase'

/** Rows with one of these statuses are trusted. Anything else (pending, rejected, draft) never reaches the agent. */
export const PUBLISHED_STATUSES = ['answered', 'approved', 'published', 'done', 'resolved'] as const

export const DOC_PREFIX = 'HALA 07-live-answers'

export const isUsable = (a: KnowledgeAnswer) =>
  (PUBLISHED_STATUSES as readonly string[]).includes(a.status.trim().toLowerCase()) && Boolean(a.answerEn || a.answerAr) && a.question.trim().length > 2

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The knowledge-base document built from the staff answer bank. Stable ordering, so the same rows always give the same
 * text and the same hash: nothing is re-uploaded unless an answer actually changed.
 */
export function buildAnswersDoc(rows: KnowledgeAnswer[]): { name: string; text: string; count: number } | undefined {
  const usable = rows.filter(isUsable).sort((a, b) => (a.serviceId ?? '').localeCompare(b.serviceId ?? '') || a.question.localeCompare(b.question) || a.id.localeCompare(b.id))
  if (usable.length === 0) return undefined
  const entries = usable.map((a) => [
    `## Question: ${oneLine(a.question)}`,
    ...(a.serviceId ? [`- Service: ${a.serviceId}`] : []),
    ...(a.answerEn ? [`- [STAFF ANSWER] English: ${oneLine(a.answerEn)}`] : []),
    ...(a.answerAr ? [`- [STAFF ANSWER] Arabic: ${oneLine(a.answerAr)}`] : []),
    `- Confirmed by DSO staff${a.answeredAt ? ` on ${a.answeredAt.slice(0, 10)}` : ''}.`
  ].join('\n'))
  const text = [
    '# HALA live answers from DSO staff',
    '',
    'These are answers that people at DSO wrote to questions callers asked and the agent could not answer before.',
    '[STAFF ANSWER] means a person at DSO confirmed it: say it plainly, in the caller\'s language, shortened for speech, and do not add anything.',
    'If a caller\'s question is only similar to one here, not the same, say you are not sure and offer a person. Fees and times mentioned here may be demo values: say so if the answer says so.',
    '',
    ...entries.flatMap((e) => [e, ''])
  ].join('\n')
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 8)
  return { name: `${DOC_PREFIX} #${hash}`, text, count: usable.length }
}
