/**
 * Dummy phone numbers. The iOS app lets the user pick any number, so nothing here is "verified":
 * the number is an identity label for the demo, not proof of who is texting.
 */

/** "+971 50 123 4567" -> "+971501234567". Returns undefined when it is not a plausible number. */
export function normalizePhone(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return undefined
  return `+${digits.replace(/^00/, '')}`
}

/** Same person if the last 8 digits match: bookings store whatever the caller said ("050 123 4567"). */
export function samePhone(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '')
  const db = b.replace(/\D/g, '')
  if (da.length < 7 || db.length < 7) return false
  return da.slice(-8) === db.slice(-8)
}

/** Last four digits only. Safe for event feeds and for the agent to read aloud. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.length >= 4 ? `***${d.slice(-4)}` : '***'
}
