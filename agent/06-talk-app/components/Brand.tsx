/** The linked-nodes motif from the DSO guide, drawn as simple SVG. Decorative: always aria-hidden. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 124 60" fill="currentColor" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <line x1="30" y1="12" x2="94" y2="12" />
        <line x1="10" y1="30" x2="114" y2="30" />
        <line x1="30" y1="48" x2="94" y2="48" />
      </g>
      <ellipse cx="30" cy="12" rx="13" ry="8" />
      <ellipse cx="94" cy="12" rx="13" ry="8" />
      <ellipse cx="11" cy="30" rx="10" ry="8" />
      <ellipse cx="62" cy="30" rx="13" ry="8" />
      <ellipse cx="113" cy="30" rx="10" ry="8" />
      <ellipse cx="30" cy="48" rx="13" ry="8" />
      <ellipse cx="94" cy="48" rx="13" ry="8" />
    </svg>
  )
}

/** "The Link": nodes joined by a bar. Used here as progress steps. */
export function Link({ steps, active, label }: { steps: string[]; active: number; label: string }) {
  return (
    <ol className="link" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s} className={i < active ? 'link-done' : i === active ? 'link-now' : undefined} aria-current={i === active ? 'step' : undefined}>
          <span className="link-node" />
          <span className="link-text">{s}</span>
        </li>
      ))}
    </ol>
  )
}
