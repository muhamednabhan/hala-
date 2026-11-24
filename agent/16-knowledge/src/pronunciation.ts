import { createHash } from 'node:crypto'

/**
 * Pronunciation dictionary for HALA: UAE and DSO names, government and business acronyms, Gulf Arabic words written in
 * Latin letters, and a few Arabic-script words that text-to-speech tends to read without short vowels.
 *
 * Alias rules (not phoneme rules) on purpose: they work on every voice model, including the expressive v3 one.
 * The respellings are general-knowledge guidance, NOT verified by DSO: they need a native Emirati ear before judging day.
 */
export interface Rule {
  /** The text as the agent writes it. */
  from: string
  /** How it should be said, in plain letters. */
  say: string
  /** Match upper/lower case exactly. Needed for acronyms that are also words (PRO/pro, NOC/noc). */
  exact?: boolean
  /** Match inside other words too (rare). Default is whole word. */
  inside?: boolean
}

const letters = (s: string) => s.split('').join(' ')
/** Acronyms said letter by letter. Case-sensitive: "PRO" is letters, "pro" is a word. */
const acronym = (...words: string[]): Rule[] => words.map((w) => ({ from: w, say: letters(w.replace(/[^A-Za-z0-9]/g, '')), exact: true }))
const names = (pairs: Record<string, string>): Rule[] => Object.entries(pairs).map(([from, say]) => ({ from, say }))

// ------------------------------------------------------------------ acronyms
const ACRONYMS: Rule[] = [
  ...acronym('DSO', 'DSOA', 'DDP', 'DCC', 'DED', 'DET', 'RTA', 'GDRFA', 'ICP', 'FZCO', 'FZE', 'LLC', 'NOC', 'PRO', 'UBO', 'MOA', 'AOA',
    'VAT', 'TRN', 'KYC', 'AML', 'ESR', 'FTA', 'DLD', 'TDRA', 'RIT', 'UAE', 'EID', 'AED', 'FM', 'HVAC', 'AI', 'IoT', 'SME', 'SMEs', 'R&D', 'MBRSC'),
  { from: 'goAML', say: 'go A M L', exact: true },
  { from: 'FZ-LLC', say: 'F Z L L C', exact: true },
  { from: 'DIEZ', say: 'deez', exact: true },
  { from: 'DIEZA', say: 'dee-eh-zah', exact: true },
  { from: 'DAFZ', say: 'daf-zee', exact: true },
  { from: 'DEWA', say: 'day-wah', exact: true },
  { from: 'MOHRE', say: 'mo-ray', exact: true },
  { from: 'ISIC', say: 'eye-sick', exact: true },
  { from: 'RERA', say: 'reh-rah', exact: true },
  { from: 'SIRA', say: 'see-rah', exact: true },
  { from: 'A5', say: 'A five', exact: true },
  { from: 'TechnoHub 1', say: 'techno-hub one' },
  { from: 'TechnoHub 4', say: 'techno-hub four' },
  { from: 'TechnoHub 5', say: 'techno-hub five' },
  { from: 'WhatsApp', say: 'whats-app' }
]

// ------------------------------------------------------------------ DSO, Dtec, services
const DSO: Rule[] = names({
  HALA: 'hah-lah', Hala: 'hah-lah', HADI: 'hah-dee', Dtec: 'dee-tek', TechnoHub: 'techno-hub', 'Silicon Oasis': 'silicon oh-ay-sis',
  Oasis: 'oh-ay-sis', Oraseya: 'oh-rah-say-ah', Ejari: 'eh-jah-ree', Mulkiya: 'mool-kee-yah', Tasheel: 'tas-heel', Amer: 'ah-mer',
  Tawjeeh: 'taw-jeeh', Tawtheeq: 'taw-theek', Salik: 'sah-lik', Nol: 'nole', Parkin: 'par-kin', Parkonic: 'par-kon-ick', Wojhati: 'woj-hah-tee',
  Ejadah: 'eh-jah-dah', Sprinklr: 'sprinkler', Emirates: 'em-ih-rits', Emirati: 'em-ih-rah-tee', Emiratis: 'em-ih-rah-teez',
  Khaleeji: 'kha-lee-jee', Majlis: 'maj-lis', Souq: 'sook', Abra: 'ab-rah', Esaad: 'ess-ahd', Etisalat: 'eh-tis-ah-lat', Du: 'doo',
  eservices: 'e services', 'e-wallet': 'ee wallet', 'e-licence': 'ee licence', 'e-lease': 'ee lease', 'e-agreement': 'ee agreement',
  Ghaf: 'gaff', Mashreq: 'mash-rik', Emaar: 'ee-mar', Nakheel: 'nah-keel', Damac: 'dah-mak', Binghatti: 'bin-gah-tee', Arabtec: 'ar-ab-tek',
  Semmer: 'sem-er', Cedre: 'say-dra', Fakeeh: 'fah-kay', Wacker: 'vah-ker', Porsche: 'por-shuh', Henkel: 'hen-kel', Talabat: 'tah-lah-bat',
  Hyundai: 'hun-day', Mitsubishi: 'mit-sue-bee-shee', Lulu: 'loo-loo', Choithrams: 'choy-thrams', Spinneys: 'spin-eez', Carrefour: 'car-four',
  Vernus: 'ver-nus', Repton: 'rep-ton', Rochester: 'roch-ester', 'Heriot-Watt': 'hair-ee-ut watt', Wellington: 'wel-ing-ton', Radisson: 'rad-ih-son',
  Alzarooni: 'al-zah-roo-nee', Maktoum: 'mak-toom', Saeed: 'sah-eed', Rashid: 'rah-sheed', Zayed: 'zah-yed', Mohammed: 'mo-ham-med',
  Mohamed: 'mo-ham-med', Muhammad: 'mo-ham-med', Ahmed: 'ah-med', Ahmad: 'ah-mad', Khalifa: 'kha-lee-fah', Sheikh: 'shake', Sheikha: 'shay-kah'
})

// ------------------------------------------------------------------ places
const PLACES: Rule[] = names({
  Dubai: 'doo-bye', Deira: 'day-rah', 'Bur Dubai': 'bur doo-bye', Jumeirah: 'joo-meer-ah', 'Jebel Ali': 'jeb-el ah-lee', 'Al Quoz': 'al kooz',
  'Al Barsha': 'al bar-shah', 'Al Karama': 'al kah-rah-mah', 'Al Satwa': 'al sat-wah', Rashidiya: 'rah-shee-dee-yah', Mirdif: 'mir-diff',
  'Al Qusais': 'al koo-says', 'Al Khawaneej': 'al kha-wah-neej', 'Al Warqa': 'al war-kah', 'Nad Hessa': 'nad hess-ah', 'Nad Al Hamar': 'nad al hah-mar',
  Muhaisnah: 'moo-hay-snah', 'Ras Al Khor': 'ras al khor', 'Al Ain': 'al ayn', 'Al Ain Road': 'al ayn road', 'Burj Khalifa': 'burj kha-lee-fah',
  'Sheikh Zayed Road': 'shake zah-yed road', 'Sheikh Mohammed bin Zayed Road': 'shake mo-ham-med bin zah-yed road',
  'Abu Dhabi': 'ah-boo dah-bee', Sharjah: 'shar-jah', Ajman: 'aj-man', 'Umm Al Quwain': 'oom al koo-wayn', 'Ras Al Khaimah': 'ras al ky-mah',
  Fujairah: 'foo-jy-rah', Etihad: 'eh-tih-had', 'Centrepoint': 'centre-point', 'Dubai Healthcare City': 'doo-bye healthcare city',
  'Al Maktoum Airport': 'al mak-toom airport', 'Palm Jumeirah': 'palm joo-meer-ah', 'Expo City': 'expo city', 'Silicon Central': 'silicon central',
  Karama: 'kah-rah-mah', Satwa: 'sat-wah', Mamzar: 'mam-zar', Barsha: 'bar-shah', Hatta: 'hut-tah', Liwa: 'lee-wah', Khorfakkan: 'khor-fah-kan'
})

// ------------------------------------------------------------------ Gulf Arabic written in Latin letters
const GULF: Rule[] = names({
  Marhaba: 'mar-hah-bah', Ahlan: 'ah-lan', 'Ahlan wa sahlan': 'ah-lan wa sah-lan', Shukran: 'shook-ran', Afwan: 'af-wan', Inshallah: 'in-shah-lah',
  Mashallah: 'mah-shah-lah', Yalla: 'yah-lah', Habibi: 'hah-bee-bee', 'Salaam alaikum': 'sa-laam a-lay-koom', 'Assalamu alaikum': 'as-sa-laa-moo a-lay-koom',
  'Sabah al khair': 'sa-bah al khayr', 'Masa al khair': 'ma-sah al khayr', Ramadan: 'rah-mah-dahn', 'Eid Al Fitr': 'eed al fit-er', 'Eid Al Adha': 'eed al ahd-hah',
  Eid: 'eed', 'Arafah Day': 'ah-rah-fah day', Hijri: 'hij-ree', Muharram: 'moo-har-ram', Shawwal: 'shah-wal', Iftar: 'if-tar', Suhoor: 'soo-hoor',
  Wasta: 'was-tah', Kandura: 'kan-doo-rah', Abaya: 'ah-bay-ah', Ghutra: 'goo-trah'
})

// ------------------------------------------------------------------ Arabic script: short vowels where speech engines guess wrong
const ARABIC: Rule[] = names({
  'هلا': 'هَلا', 'واحة': 'واحَة', 'دبي': 'دُبَيّ', 'السيليكون': 'السِّيليكون', 'تأشيرة': 'تَأشيرَة', 'التأشيرة': 'التَّأشيرَة', 'إيجار': 'إيجار',
  'رخصة': 'رُخصَة', 'الرخصة': 'الرُّخصَة', 'بطاقة': 'بِطاقَة', 'المنشأة': 'المُنشَأة', 'صيانة': 'صِيانَة', 'شكوى': 'شَكوى', 'ممانعة': 'مُمانَعَة',
  'أبشر': 'أَبشِر', 'حياك': 'حَيّاك', 'تفضل': 'تَفَضَّل', 'الإمارات': 'الإِمارات', 'إماراتي': 'إِماراتِيّ', 'موعد': 'مَوعِد', 'مواعيد': 'مَواعيد',
  'مستندات': 'مُستَنَدات', 'الرسوم': 'الرُّسوم', 'ذكاء': 'ذَكاء', 'اصطناعي': 'اصطِناعِيّ', 'مساعدة': 'مُساعِدَة', 'إسعاد': 'إِسعاد', 'المتعاملين': 'المُتَعامِلين',
  'ديسمبر': 'ديسَمبَر', 'نوفمبر': 'نوڤَمبَر'
})

export const RULES: Rule[] = [...ACRONYMS, ...DSO, ...PLACES, ...GULF, ...ARABIC]

/** Request body for the ElevenLabs "add from rules" call. Whole words; case-insensitive unless `exact`. */
export function toApiRules(rules: Rule[] = RULES) {
  const seen = new Set<string>()
  const out: { type: 'alias'; stringToReplace: string; alias: string; caseSensitive: boolean; wordBoundaries: boolean }[] = []
  for (const r of rules) {
    const k = r.exact ? `${r.from}|1` : r.from.toLowerCase()
    if (seen.has(k) || r.from === r.say) continue
    seen.add(k)
    out.push({ type: 'alias', stringToReplace: r.from, alias: r.say, caseSensitive: Boolean(r.exact), wordBoundaries: !r.inside })
  }
  return out
}

/** Changes whenever the rules change, so we only create a new dictionary version when needed. */
export const rulesHash = (rules: Rule[] = RULES) => createHash('sha256').update(JSON.stringify(toApiRules(rules))).digest('hex').slice(0, 12)
