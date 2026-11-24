/** Tiny in-memory sliding window per client. Enough to stop a loop on a demo laptop. */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) { hits.set(key, recent); return false }
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 5000) hits.clear()
    return true
  }
}

export const clientKey = (req: Request) =>
  req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
