import type { Lang } from './types'

/** Arabic diacritics (tashkeel) and the tatweel stretch character. */
const ARABIC_MARKS = /[ً-ٰٟـ]/g
const ARABIC_LETTER = /[؀-ۿ]/
const ARABIC_INDIC_DIGITS = /[٠-٩]/g
const EXT_ARABIC_INDIC_DIGITS = /[۰-۹]/g

/** Share of letters that are Arabic script, 0..1. */
export function arabicRatio(text: string): number {
  const letters = [...text].filter((c) => /\p{L}/u.test(c))
  if (letters.length === 0) return 0
  return letters.filter((c) => ARABIC_LETTER.test(c)).length / letters.length
}

export function detectLanguage(text: string): Lang {
  return arabicRatio(text) >= 0.4 ? 'ar' : 'en'
}

/** Convert Arabic-Indic digits to ASCII so "٢٠٢٦" and "2026" compare equal. */
export function asciiDigits(text: string): string {
  return text
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXT_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/** Unify the letter variants speech-to-text and people write inconsistently. */
export function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا') // alef variants -> alef
    .replace(/ى/g, 'ي') // alef maqsura -> ya
    .replace(/ة/g, 'ه') // ta marbuta -> ha
    .replace(/ؤ/g, 'و') // hamza on waw -> waw
    .replace(/ئ/g, 'ي') // hamza on ya -> ya
}

/** Strip the definite article and common clitics so "بالتأشيرة" and "تأشيرة" share a stem. */
function stemArabic(token: string): string {
  let t = token
  t = t.replace(/^(وال|بال|كال|فال|لل|ال)/, '')
  if (t.length > 4 && /^و/.test(t)) t = t.slice(1)
  return t
}

function stemEnglish(token: string): string {
  let t = token
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`
  if (t.length > 4 && /(sses|xes|ches|shes)$/.test(t)) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1)
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3)
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2)
  return t
}

/** Lower-case, normalise and stem. Works for English, Arabic, and mixed text. */
export function tokens(text: string): string[] {
  const cleaned = normalizeArabic(asciiDigits(text.toLowerCase()))
  return cleaned
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => (ARABIC_LETTER.test(t) ? stemArabic(t) : stemEnglish(t)))
}

/** Edit distance <= 1 (substitution, insertion, deletion). Cheap tolerance for speech-to-text slips. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
