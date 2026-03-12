/**
 * Fuzzy & phonetic matching library for company-name resolution.
 * Pure functions, zero external dependencies, <1 ms per call.
 */

// ─── Levenshtein Edit Distance ───────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses the classic dynamic-programming matrix (O(m·n) time, O(min(m,n)) space).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Keep the shorter string as `b` so the DP row is smaller.
  if (a.length < b.length) [a, b] = [b, a]

  const bLen = b.length
  let prev = new Array<number>(bLen + 1)
  let curr = new Array<number>(bLen + 1)

  for (let j = 0; j <= bLen; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[bLen]
}

// ─── Similarity Ratio ────────────────────────────────────────────────────────

/**
 * Normalised similarity: 1 − (distance / max(len_a, len_b)).
 * Returns a value in [0, 1] where 1 means identical.
 */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1 // both empty → identical
  return 1 - levenshtein(a, b) / maxLen
}

// ─── Soundex ─────────────────────────────────────────────────────────────────

/**
 * Standard American Soundex encoding (4-character code).
 */
export function soundex(s: string): string {
  const clean = s.replace(/[^a-zA-Z]/g, '')
  if (clean.length === 0) return '0000'

  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  }

  const first = clean[0].toUpperCase()
  let code = first
  let lastDigit = map[first] || ''

  for (let i = 1; i < clean.length && code.length < 4; i++) {
    const digit = map[clean[i].toUpperCase()] || ''
    if (digit && digit !== lastDigit) {
      code += digit
      lastDigit = digit
    } else if (!digit) {
      // vowels / H / W / Y reset the "last digit" tracker
      lastDigit = ''
    }
  }

  return (code + '0000').slice(0, 4)
}

// ─── Double Metaphone ────────────────────────────────────────────────────────

/**
 * Double Metaphone encoding — returns [primary, alternate] codes.
 * Simplified but covers the most important English/European patterns relevant
 * to company and personal names.
 */
export function doubleMetaphone(s: string): [string, string] {
  const word = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (word.length === 0) return ['', '']

  let primary = ''
  let alternate = ''
  let i = 0
  const len = word.length
  const maxLen = 6

  const at = (pos: number) => (pos >= 0 && pos < len ? word[pos] : '')
  const slice = (pos: number, n: number) => word.slice(pos, pos + n)

  const isVowel = (c: string) => 'AEIOU'.includes(c)

  // Skip silent initial letters
  if (['GN', 'KN', 'PN', 'AE', 'WR'].includes(slice(0, 2))) i = 1

  // Initial X → S
  if (at(0) === 'X') {
    primary += 'S'
    alternate += 'S'
    i = 1
  }

  while (i < len && (primary.length < maxLen || alternate.length < maxLen)) {
    const c = at(i)

    // Skip vowels unless at start
    if (isVowel(c)) {
      if (i === 0) {
        primary += 'A'
        alternate += 'A'
      }
      i++
      continue
    }

    switch (c) {
      case 'B':
        primary += 'P'
        alternate += 'P'
        i += at(i + 1) === 'B' ? 2 : 1
        break

      case 'C':
        if (slice(i, 2) === 'CH') {
          primary += 'X'
          alternate += 'X'
          i += 2
        } else if (slice(i, 2) === 'CK') {
          primary += 'K'
          alternate += 'K'
          i += 2
        } else if ('EIY'.includes(at(i + 1))) {
          primary += 'S'
          alternate += 'S'
          i += 2
        } else {
          primary += 'K'
          alternate += 'K'
          i += at(i + 1) === 'C' && !('EIY'.includes(at(i + 2))) ? 2 : 1
        }
        break

      case 'D':
        if (slice(i, 2) === 'DG' && 'EIY'.includes(at(i + 2))) {
          primary += 'J'
          alternate += 'J'
          i += 3
        } else {
          primary += 'T'
          alternate += 'T'
          i += at(i + 1) === 'D' ? 2 : 1
        }
        break

      case 'F':
        primary += 'F'
        alternate += 'F'
        i += at(i + 1) === 'F' ? 2 : 1
        break

      case 'G':
        if (at(i + 1) === 'H') {
          if (i > 0 && !isVowel(at(i - 1))) {
            // GH after consonant → K
            primary += 'K'
            alternate += 'K'
            i += 2
          } else if (i === 0) {
            // GH at start
            if (at(i + 2) === 'I') {
              primary += 'J'
              alternate += 'J'
            } else {
              primary += 'K'
              alternate += 'K'
            }
            i += 2
          } else {
            // GH is silent
            i += 2
          }
        } else if (at(i + 1) === 'N') {
          // GN — silent G
          i += 1
        } else if ('EIY'.includes(at(i + 1))) {
          primary += 'J'
          alternate += 'K'
          i += 2
        } else {
          primary += 'K'
          alternate += 'K'
          i += at(i + 1) === 'G' ? 2 : 1
        }
        break

      case 'H':
        if (isVowel(at(i + 1)) && (i === 0 || !isVowel(at(i - 1)))) {
          primary += 'H'
          alternate += 'H'
          i += 2
        } else {
          i++
        }
        break

      case 'J':
        primary += 'J'
        alternate += 'H'
        i += at(i + 1) === 'J' ? 2 : 1
        break

      case 'K':
        primary += 'K'
        alternate += 'K'
        i += at(i + 1) === 'K' ? 2 : 1
        break

      case 'L':
        primary += 'L'
        alternate += 'L'
        i += at(i + 1) === 'L' ? 2 : 1
        break

      case 'M':
        primary += 'M'
        alternate += 'M'
        i += at(i + 1) === 'M' ? 2 : 1
        break

      case 'N':
        primary += 'N'
        alternate += 'N'
        i += at(i + 1) === 'N' ? 2 : 1
        break

      case 'P':
        if (at(i + 1) === 'H') {
          primary += 'F'
          alternate += 'F'
          i += 2
        } else {
          primary += 'P'
          alternate += 'P'
          i += at(i + 1) === 'P' ? 2 : 1
        }
        break

      case 'Q':
        primary += 'K'
        alternate += 'K'
        i += at(i + 1) === 'Q' ? 2 : 1
        break

      case 'R':
        primary += 'R'
        alternate += 'R'
        i += at(i + 1) === 'R' ? 2 : 1
        break

      case 'S':
        if (slice(i, 2) === 'SH') {
          primary += 'X'
          alternate += 'X'
          i += 2
        } else if (slice(i, 3) === 'SCH') {
          primary += 'SK'
          alternate += 'SK'
          i += 3
        } else if (slice(i, 2) === 'SC') {
          if ('EIY'.includes(at(i + 2))) {
            primary += 'S'
            alternate += 'S'
          } else {
            primary += 'SK'
            alternate += 'SK'
          }
          i += 3
        } else {
          primary += 'S'
          alternate += 'S'
          i += at(i + 1) === 'S' ? 2 : 1
        }
        break

      case 'T':
        if (slice(i, 2) === 'TH') {
          primary += '0' // theta
          alternate += 'T'
          i += 2
        } else {
          primary += 'T'
          alternate += 'T'
          i += at(i + 1) === 'T' ? 2 : 1
        }
        break

      case 'V':
        primary += 'F'
        alternate += 'F'
        i += at(i + 1) === 'V' ? 2 : 1
        break

      case 'W':
        if (isVowel(at(i + 1))) {
          primary += 'A'
          alternate += 'F'
          i += 2
        } else {
          i++
        }
        break

      case 'X':
        primary += 'KS'
        alternate += 'KS'
        i += at(i + 1) === 'X' ? 2 : 1
        break

      case 'Y':
        if (isVowel(at(i + 1))) {
          primary += 'A'
          alternate += 'A'
          i += 2
        } else {
          i++
        }
        break

      case 'Z':
        primary += 'S'
        alternate += 'S'
        i += at(i + 1) === 'Z' ? 2 : 1
        break

      default:
        i++
    }
  }

  return [primary.slice(0, maxLen), alternate.slice(0, maxLen)]
}

// ─── Company Name Normalization ──────────────────────────────────────────────

const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp',
  'corp', 'corporation', 'ltd', 'limited',
  'gmbh', 'ag', 'sa', 'plc', 'se', 'nv', 'bv',
  'co', 'company', 'group', 'holdings',
  'international', 'intl', 'enterprises', 'partners',
  'solutions', 'technologies', 'systems',
])

/**
 * Normalise a company name for comparison:
 *  - lowercase
 *  - strip common suffixes (Inc, LLC, Corp, Ltd, etc.)
 *  - remove "The" prefix
 *  - strip punctuation and extra whitespace
 */
export function normalizeCompanyName(name: string): string {
  let n = name.toLowerCase()

  // Remove punctuation (but keep alphanumeric, spaces, and &)
  n = n.replace(/[.,!?;:'"()[\]{}\-\/\\#@$%^*_+=~`<>|]/g, ' ')
  // Replace & with space for normalisation
  n = n.replace(/&/g, ' ')
  // Collapse whitespace
  n = n.replace(/\s+/g, ' ').trim()

  // Remove leading "the "
  n = n.replace(/^the\s+/, '')

  // Remove known suffixes — strip from end repeatedly
  let words = n.split(' ')
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
    words.pop()
  }
  // Also remove "l l c" type artifacts (after punctuation removal)
  words = words.filter(w => w.length > 0)
  // Handle "l l c" → filter single letters at the end that spell a suffix
  while (
    words.length > 1 &&
    words[words.length - 1].length === 1 &&
    'llcsa'.includes(words[words.length - 1])
  ) {
    words.pop()
  }

  return words.join(' ').trim()
}

// ─── Known Abbreviation Dictionary ───────────────────────────────────────────

/**
 * Bidirectional abbreviation map.
 * Keys are normalised (lowercase, no punctuation) abbreviation ↔ full name pairs.
 */
const ABBREVIATION_PAIRS: Array<[string, string]> = [
  // Tech
  ['ibm', 'international business machines'],
  ['hp', 'hewlett packard'],
  ['hpe', 'hewlett packard enterprise'],
  ['ms', 'microsoft'],
  ['msft', 'microsoft'],
  ['amzn', 'amazon'],
  ['goog', 'google'],
  ['meta', 'facebook'],
  ['orcl', 'oracle'],
  ['sap', 'sap'],
  ['crm', 'salesforce'],
  ['csco', 'cisco'],
  ['intc', 'intel'],
  ['amd', 'advanced micro devices'],
  ['nvda', 'nvidia'],
  ['tsm', 'taiwan semiconductor manufacturing'],
  ['tsmc', 'taiwan semiconductor manufacturing'],
  ['dell', 'dell technologies'],
  ['hcl', 'hindustan computers'],
  ['tcs', 'tata consultancy services'],

  // Telecom / Conglomerates
  ['att', 'american telephone telegraph'],
  ['at t', 'american telephone telegraph'],
  ['ge', 'general electric'],
  ['gm', 'general motors'],
  ['3m', 'minnesota mining manufacturing'],
  ['mmm', 'minnesota mining manufacturing'],
  ['ups', 'united parcel service'],
  ['fedex', 'federal express'],

  // Consumer / Retail
  ['pg', 'procter gamble'],
  ['p g', 'procter gamble'],
  ['jnj', 'johnson johnson'],
  ['j j', 'johnson johnson'],
  ['ko', 'coca cola'],
  ['pep', 'pepsico'],
  ['wmt', 'walmart'],
  ['tgt', 'target'],
  ['mcd', 'mcdonalds'],
  ['sbux', 'starbucks'],
  ['nke', 'nike'],
  ['pg', 'procter gamble'],

  // Finance
  ['jpm', 'jpmorgan chase'],
  ['gs', 'goldman sachs'],
  ['ms', 'morgan stanley'],
  ['boa', 'bank of america'],
  ['bac', 'bank of america'],
  ['citi', 'citigroup'],
  ['wfc', 'wells fargo'],
  ['hsbc', 'hongkong shanghai banking corporation'],
  ['amex', 'american express'],
  ['axp', 'american express'],
  ['ubs', 'union bank of switzerland'],
  ['cs', 'credit suisse'],
  ['db', 'deutsche bank'],
  ['bnp', 'bnp paribas'],
  ['rbs', 'royal bank of scotland'],
  ['barclays', 'barclays bank'],

  // Automotive
  ['bmw', 'bayerische motoren werke'],
  ['vw', 'volkswagen'],
  ['mb', 'mercedes benz'],
  ['gm', 'general motors'],
  ['toyota', 'toyota motor'],
  ['honda', 'honda motor'],

  // Pharma / Healthcare
  ['pfizer', 'pfizer'],
  ['jnj', 'johnson johnson'],
  ['mrk', 'merck'],
  ['abbv', 'abbvie'],
  ['bmy', 'bristol myers squibb'],
  ['gsk', 'glaxosmithkline'],
  ['azn', 'astrazeneca'],
  ['nvs', 'novartis'],
  ['lly', 'eli lilly'],
  ['unh', 'unitedhealth group'],

  // Energy
  ['xom', 'exxon mobil'],
  ['cvx', 'chevron'],
  ['bp', 'british petroleum'],
  ['rds', 'royal dutch shell'],

  // Media / Entertainment
  ['dis', 'walt disney'],
  ['nflx', 'netflix'],
  ['twtr', 'twitter'],
  ['snap', 'snapchat'],

  // Defence / Aerospace
  ['lmt', 'lockheed martin'],
  ['ba', 'boeing'],
  ['rtx', 'raytheon technologies'],
  ['noc', 'northrop grumman'],
  ['gd', 'general dynamics'],

  // Other
  ['pwc', 'pricewaterhousecoopers'],
  ['ey', 'ernst young'],
  ['kpmg', 'klynveld peat marwick goerdeler'],
  ['bcg', 'boston consulting group'],
  ['mck', 'mckinsey'],
]

/** Build fast lookup maps. Both directions: abbrev→full and full→abbrev. */
function buildAbbrevMaps() {
  const map = new Map<string, Set<string>>()

  function add(key: string, value: string) {
    const s = map.get(key)
    if (s) s.add(value)
    else map.set(key, new Set([value]))
  }

  for (const [abbrev, full] of ABBREVIATION_PAIRS) {
    add(abbrev, full)
    add(full, abbrev)
  }

  return map
}

const ABBREV_MAP = buildAbbrevMaps()

function normalizeForLookup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check whether `abbrev` and `full` are a known abbreviation pair.
 * Bidirectional and case-insensitive. Both sides are normalised before lookup.
 */
export function isKnownAbbreviation(abbrev: string, full: string): boolean {
  const a = normalizeForLookup(abbrev)
  const b = normalizeForLookup(full)

  // Direct lookup: a → set contains b?
  const setA = ABBREV_MAP.get(a)
  if (setA && setA.has(b)) return true

  // Reverse: b → set contains a?
  const setB = ABBREV_MAP.get(b)
  if (setB && setB.has(a)) return true

  // Also try with company name normalization (strips suffixes)
  const aNorm = normalizeCompanyName(abbrev)
  const bNorm = normalizeCompanyName(full)

  const setAN = ABBREV_MAP.get(aNorm)
  if (setAN && setAN.has(bNorm)) return true

  const setBN = ABBREV_MAP.get(bNorm)
  if (setBN && setBN.has(aNorm)) return true

  return false
}

// ─── Fuzzy Company Match (Combined) ──────────────────────────────────────────

export interface FuzzyMatchResult {
  match: boolean
  score: number
  method: 'exact' | 'abbreviation' | 'soundex' | 'levenshtein' | 'none'
}

/**
 * Combined fuzzy company-name matching.
 * Tries methods in order of confidence:
 *  1. Exact match after normalisation  → score 1.0
 *  2. Known abbreviation               → score 1.0
 *  3. Soundex match                     → score 0.9
 *  4. Levenshtein similarity ≥ threshold → actual score
 *  5. No match                          → { match: false, score, method: "none" }
 */
export function fuzzyCompanyMatch(
  a: string,
  b: string,
  threshold = 0.8
): FuzzyMatchResult {
  const normA = normalizeCompanyName(a)
  const normB = normalizeCompanyName(b)

  // 1. Exact match after normalisation
  if (normA === normB) {
    return { match: true, score: 1.0, method: 'exact' }
  }

  // 2. Known abbreviation
  if (isKnownAbbreviation(a, b)) {
    return { match: true, score: 1.0, method: 'abbreviation' }
  }

  // 3. Soundex match (compare first word for single-word names, full for multi)
  const soundexA = soundex(normA)
  const soundexB = soundex(normB)
  if (soundexA !== '0000' && soundexA === soundexB) {
    return { match: true, score: 0.9, method: 'soundex' }
  }

  // 4. Levenshtein similarity
  const sim = similarity(normA, normB)
  if (sim >= threshold) {
    return { match: true, score: sim, method: 'levenshtein' }
  }

  // 5. No match
  return { match: false, score: sim, method: 'none' }
}
