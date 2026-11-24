import { SCENARIOS, type Scenario } from './scenarios'

/** Structural problems in the scenario data. Empty means the scenarios are runnable. */
export function validateScenarios(scenarios: Scenario[] = SCENARIOS): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const s of scenarios) {
    if (!/^[a-z0-9_]+$/.test(s.id)) problems.push(`${s.id}: id must be snake_case`)
    if (seen.has(s.id)) problems.push(`${s.id}: duplicate id`)
    seen.add(s.id)
    if (s.turns.length === 0) problems.push(`${s.id}: no turns`)
    if (s.rules.length === 0) problems.push(`${s.id}: no judging rule attached`)
    if (!s.opening?.length && !s.turns.some((t) => t.checks?.length) && !s.final?.length) problems.push(`${s.id}: no checks at all`)
    s.turns.forEach((t, i) => { if (!t.user.trim()) problems.push(`${s.id}: turn ${i + 1} is empty`) })
  }
  return problems
}

/** Human-readable plan for --dry-run. Touches no network. */
export function renderPlan(scenarios: Scenario[] = SCENARIOS): string {
  const lines: string[] = []
  let turns = 0
  for (const s of scenarios) {
    turns += s.turns.length
    lines.push(`- ${s.id} [${s.language}] ${s.title}`)
    lines.push(`    rules: ${s.rules.join(', ')}`)
    if (s.opening?.length) lines.push(`    opening: ${s.opening.map((c) => c.name).join('; ')}`)
    s.turns.forEach((t, i) => {
      lines.push(`    turn ${i + 1}: "${t.user}"`)
      for (const c of t.checks ?? []) lines.push(`      · ${c.name}`)
    })
    for (const c of s.final ?? []) lines.push(`    final · ${c.name}`)
  }
  lines.push('', `${scenarios.length} scenarios, ${turns} caller turns (each is one real LLM response, plus tool webhooks).`)
  return lines.join('\n')
}
