import type { Rule } from './checks'
import type { ScenarioOutcome } from './session'
import type { Scenario } from './scenarios'

const RULE_LABEL: Record<Rule, string> = {
  ai_disclosure: 'Says it is an AI',
  bilingual: 'English and Arabic',
  no_invention: 'Never makes things up',
  demo_label: 'Labels demo values',
  handover: 'Hands over to a person',
  confirmation: 'Reads back before acting',
  safety: 'Resists prompt injection'
}

const passed = (o: ScenarioOutcome) => o.checks.every((c) => c.ok)
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Markdown report of a live run. Includes the full transcript so a human can read what went wrong. */
export function renderReport(scenarios: Scenario[], outcomes: ScenarioOutcome[], meta: { agentId: string; startedAt: string }): string {
  const byId = new Map(scenarios.map((s) => [s.id, s]))
  const lines: string[] = []
  const ok = outcomes.filter(passed).length
  lines.push(`# HALA live evals`, '', `- Run: ${meta.startedAt}`, `- Agent: \`${meta.agentId}\``, `- Result: **${ok}/${outcomes.length} scenarios passed**`, '')

  lines.push('## By judging rule', '', '| Rule | Passed | Scenarios |', '|---|---|---|')
  for (const rule of Object.keys(RULE_LABEL) as Rule[]) {
    const related = outcomes.filter((o) => byId.get(o.scenarioId)?.rules.includes(rule))
    if (related.length === 0) continue
    lines.push(`| ${RULE_LABEL[rule]} | ${related.filter(passed).length}/${related.length} | ${related.map((o) => `${passed(o) ? '✅' : '❌'} ${o.scenarioId}`).join(', ')} |`)
  }

  lines.push('', '## Scenarios', '')
  for (const o of outcomes) {
    const s = byId.get(o.scenarioId)!
    lines.push(`### ${passed(o) ? '✅' : '❌'} ${s.id}: ${s.title}`, '')
    lines.push(`Conversation \`${o.conversationId ?? 'unknown'}\` · ${(o.durationMs / 1000).toFixed(1)} s · tool calls from ${o.toolSource}`, '')
    lines.push('| Phase | Check | Result |', '|---|---|---|')
    for (const c of o.checks) lines.push(`| ${c.phase} | ${esc(c.name)} | ${c.ok ? 'pass' : `**FAIL** ${esc(c.detail ?? '')}`} |`)
    lines.push('', '<details><summary>Transcript</summary>', '', `**HALA (opening):** ${o.opening || '_(none received)_'}`, '')
    for (const t of o.turns) {
      lines.push(`**Caller:** ${t.user}`, '', `**HALA:** ${t.agentText || '_(no reply)_'}`)
      if (t.toolCalls.length) lines.push('', `_tools:_ ${t.toolCalls.map((c) => `\`${c.name}(${JSON.stringify(c.params)})\``).join(', ')}`)
      lines.push('')
    }
    if (o.errors.length) lines.push('**Socket errors:**', ...o.errors.map((e) => `- ${e}`), '')
    lines.push('</details>', '')
  }
  return lines.join('\n')
}

export function reportFileName(d = new Date()): string {
  return `${d.toISOString().replace(/[:.]/g, '-')}.md`
}
