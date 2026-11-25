import type { HandoverReason } from '@hala/core'

/**
 * A backstop behind the prompt, not a replacement for it. The agent is told to decline jokes, tests, nonsense and
 * impossible requests itself, with no tool call. If it calls the hand-over tool anyway, this keeps an obvious time-waster
 * out of the staff queue.
 *
 * It is deliberately narrow. It only looks at the soft reasons, and only for words that say the request was not serious
 * (the agent writes the summary in English and describes what the caller wanted). A real fee dispute, legal question,
 * upset caller, emergency or request for a person is NEVER filtered: wrongly refusing one of those is far worse than
 * letting a joke through.
 */
const ALWAYS_STAFF: ReadonlySet<HandoverReason> = new Set<HandoverReason>(['fee_dispute', 'legal_question', 'upset_caller', 'caller_requested', 'emergency'])

const NOT_SERIOUS = new RegExp(
  '\\b(?:' + [
    'jok(?:e|es|ed|ing)', 'kidding', 'prank(?:s|ed|ing)?', 'troll(?:s|ed|ing)?', 'for fun', 'for laughs', 'messing (?:around|with)', 'playing around',
    'not serious(?:ly)?', 'nonsense', 'gibberish', 'riddles?', 'flirt(?:s|ed|ing)?', 'marry (?:me|him|her|them)', 'marriage proposal',
    'time travel', 'teleport(?:ing|ation)?', '(?:to|on|from) (?:mars|the moon)', 'aliens?', 'unicorns?', 'dragons?', 'santa',
    'testing (?:the |this )?(?:bot|robot|ai|hala|you)', 'tests? (?:the |this )?(?:bot|robot|ai|hala)'
  ].join('|') + ')\\b',
  'i'
)

export type HandoverTriage = { route: 'staff' } | { route: 'decline'; why: string }

export function triageHandover(a: { reason: HandoverReason; summary: string }): HandoverTriage {
  if (ALWAYS_STAFF.has(a.reason)) return { route: 'staff' }
  const hit = NOT_SERIOUS.exec(a.summary)
  return hit ? { route: 'decline', why: `the request was not serious ("${hit[0].toLowerCase()}")` } : { route: 'staff' }
}
