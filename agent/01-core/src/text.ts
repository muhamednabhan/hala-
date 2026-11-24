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

/**
 * Spoken Arabic uses verbs ("أجدد", "ألغي", "نضيف") where written keywords use nouns ("تجديد",
 * "إلغاء", "إضافة"). Map the common action forms onto one canonical token so both match.
 * Keys are post-normalisation stems (see normalizeArabic + stemArabic).
 */
const ARABIC_ACTIONS: Record<string, string[]> = {
  تجديد: ['جدد', 'اجدد', 'نجدد', 'يجدد', 'تجدد', 'مجدد', 'تجديد'],
  غاء: ['غي', 'نلغي', 'يلغي', 'تلغي', 'الغي', 'غاء', 'الغاء'],
  تعديل: ['عدل', 'اعدل', 'نعدل', 'يعدل', 'تعدل', 'تعديل'],
  اضافه: ['اضيف', 'نضيف', 'يضيف', 'تضيف', 'ضيف', 'اضافه', 'اضافة'],
  تغيير: ['غير', 'اغير', 'نغير', 'يغير', 'تغير', 'تغيير'],
  انتهاء: ['انتهت', 'تنتهي', 'ينتهي', 'انتهي', 'منتهيه', 'منتهي', 'انتهاء', 'خلصت', 'تخلص'],
  توظيف: ['نوظف', 'اوظف', 'يوظف', 'توظيف', 'وظف']
}
const ARABIC_CANON = new Map<string, string>(
  Object.entries(ARABIC_ACTIONS).flatMap(([canon, forms]) => forms.map((f) => [f, canon] as const))
)

/** Strip the definite article, glued prepositions and pronoun endings so word forms share a stem. */
function stemArabic(token: string): string {
  let t = token
  t = t.replace(/^(وال|بال|كال|فال|لل|ال)/, '')
  if (t.length > 4 && /^و/.test(t)) t = t.slice(1)
  // Single-letter prepositions glued to the word: "لتجديد" (for renewal), "برخصة" (with a licence).
  if (t.length >= 6 && /^[بلكف]/.test(t)) t = t.slice(1)
  // Pronoun endings: "تجديدها" (renewing it) -> "تجديد".
  if (t.length >= 6 && /(ها|هم|هن)$/.test(t)) t = t.slice(0, -2)
  // Feminine noun + possessive: "تأشيرتي" (my visa), "رخصتنا" (our licence) -> ta marbuta form.
  if (t.length >= 6) t = t.replace(/ت(ي|ك|نا)$/, 'ه')
  return ARABIC_CANON.get(t) ?? t
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
