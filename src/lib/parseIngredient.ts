import type { IngredientLine } from '../types/health'

const FRACTION_MAP: Record<string, number> = {
  '1/2': 0.5, '½': 0.5,
  '1/3': 1 / 3, '⅓': 1 / 3,
  '2/3': 2 / 3, '⅔': 2 / 3,
  '1/4': 0.25, '¼': 0.25,
  '3/4': 0.75, '¾': 0.75,
  '1/8': 0.125, '⅛': 0.125,
}

const WEIGHT_UNITS = new Set(['g', 'gr', 'gramme', 'grammes', 'kg', 'kilo', 'kilos'])
const VOLUME_UNITS = new Set(['ml', 'cl', 'dl', 'l', 'litre', 'litres'])
const SPOON_UNITS = new Set([
  'c. à s.', 'c. a s.', 'c.s.', 'cs', 'cuillere a soupe', 'cuillère à soupe', 'cuilleres a soupe', 'cuillères à soupe',
  'c. à c.', 'c. a c.', 'c.c.', 'cc', 'cuillere a cafe', 'cuillère à café', 'cuilleres a cafe', 'cuillères à café',
])
const COUNT_UNITS = new Set([
  'œuf', 'œufs', 'oeuf', 'oeufs',
  'tranche', 'tranches', 'tortilla', 'tortillas', 'lavash',
  'gousse', 'gousses',
  'feuille', 'feuilles',
  'boite', 'boîte', 'boites', 'boîtes',
  'sachet', 'sachets',
  'pincee', 'pincée', 'pincees', 'pincées',
  'verre', 'verres',
  'pot', 'pots',
  'scoop', 'scoops',
  'portion', 'portions',
  'tasse', 'tasses',
  'paquet', 'paquets',
  'morceau', 'morceaux',
  'filet', 'filets',
])

const NON_SCALABLE_KEYWORDS = [
  'sel', 'poivre', 'épices', 'epices', 'paprika', 'cumin', 'curcuma',
  'origan', 'thym', 'romarin', 'persil', 'basilic', 'coriandre',
  'huile d\'olive', "huile d'olive", 'huile olive', 'vinaigre',
  'pour ', 'sauce ', 'préparation', 'preparation', 'garniture', 'topping',
]

const SECTION_PATTERNS = [/^pour\s+\d+/i, /^sauce\b/i, /^garniture/i, /^topping/i, /^assaisonnement/i, /^marinade/i]

export function parseIngredient(raw: string): IngredientLine {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { raw, kind: 'item', scalable: false }
  }

  if (isSectionHeader(trimmed)) {
    return { raw, kind: 'section', scalable: false }
  }

  const cleaned = trimmed
    .replace(/^[-•*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

  const match = matchQuantity(cleaned)
  if (!match) {
    return { raw: cleaned, kind: 'item', scalable: isStandaloneScalable(cleaned), item: cleaned }
  }

  const { qty, unit, rest } = match
  const item = (rest || cleaned).replace(/^de\s+/i, '').replace(/^d['']/i, '').trim()

  return {
    raw: cleaned,
    kind: 'item',
    scalable: qty > 0,
    qty,
    unit,
    item: item || undefined,
  }
}

export function parseIngredientList(lines: string[]): IngredientLine[] {
  return lines.map((line) => parseIngredient(line))
}

export function scaleIngredient(line: IngredientLine, factor: number): string {
  if (line.kind === 'section') return line.raw
  if (!line.scalable || line.qty === undefined) return line.raw

  const scaledQty = line.qty * factor
  const formattedQty = formatQuantity(scaledQty)
  const unit = line.unit ? ` ${line.unit}` : ''
  const item = line.item ? ` de ${line.item}` : ''
  const cleanedItem = line.unit ? item : line.item ? ` ${line.item}` : ''
  return `${formattedQty}${unit}${cleanedItem}`
}

export function buildScaledLines(structured: IngredientLine[] | undefined, fallbackRaw: string[], factor: number): string[] {
  if (factor === 1) {
    return structured ? structured.map((line) => line.raw) : fallbackRaw
  }
  if (!structured || !structured.length) return fallbackRaw
  return structured.map((line) => scaleIngredient(line, factor))
}

function isSectionHeader(line: string): boolean {
  if (line.endsWith(':')) return true
  return SECTION_PATTERNS.some((pattern) => pattern.test(line))
}

function matchQuantity(line: string): { qty: number; unit?: string; rest: string } | null {
  const fractionEntry = Object.entries(FRACTION_MAP).find(([key]) => line.startsWith(`${key} `) || line.startsWith(`${key}\t`) || line === key)
  if (fractionEntry) {
    const [token, value] = fractionEntry
    const remainder = line.slice(token.length).trim()
    const parsed = parseUnit(remainder)
    return { qty: value, unit: parsed.unit, rest: parsed.rest }
  }

  const numericMatch = line.match(/^(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(.*)$/)
  if (!numericMatch) return null
  const qty = Number(numericMatch[1].replace(',', '.'))
  if (!Number.isFinite(qty)) return null
  const remainder = numericMatch[2].trim()
  const parsed = parseUnit(remainder)
  return { qty, unit: parsed.unit, rest: parsed.rest }
}

function parseUnit(remainder: string): { unit?: string; rest: string } {
  if (!remainder) return { rest: '' }

  const lower = remainder.toLowerCase()

  for (const unit of SPOON_UNITS) {
    if (lower.startsWith(unit)) {
      return { unit: normalizeUnit(unit), rest: remainder.slice(unit.length).trim() }
    }
  }

  const tokenMatch = remainder.match(/^([a-zàâäéèêëïîôöùûüç.]+\.?)\s*(.*)$/i)
  if (!tokenMatch) return { rest: remainder }
  const token = tokenMatch[1]
  const rest = tokenMatch[2]
  const lowerToken = token.toLowerCase().replace(/\.$/, '')

  if (WEIGHT_UNITS.has(lowerToken) || VOLUME_UNITS.has(lowerToken) || COUNT_UNITS.has(lowerToken)) {
    return { unit: normalizeUnit(lowerToken), rest: rest.trim() }
  }

  return { rest: remainder }
}

function normalizeUnit(unit: string): string {
  const lower = unit.toLowerCase()
  if (lower === 'gr' || lower === 'gramme' || lower === 'grammes') return 'g'
  if (lower === 'kilo' || lower === 'kilos') return 'kg'
  if (lower === 'litre' || lower === 'litres') return 'l'
  if (['c. à s.', 'c. a s.', 'c.s.', 'cs', 'cuillere a soupe', 'cuillère à soupe', 'cuilleres a soupe', 'cuillères à soupe'].includes(lower)) return 'c. à s.'
  if (['c. à c.', 'c. a c.', 'c.c.', 'cc', 'cuillere a cafe', 'cuillère à café', 'cuilleres a cafe', 'cuillères à café'].includes(lower)) return 'c. à c.'
  return lower
}

function isStandaloneScalable(line: string): boolean {
  const lower = line.toLowerCase()
  return !NON_SCALABLE_KEYWORDS.some((keyword) => lower === keyword.trim() || lower.startsWith(`${keyword} `))
}

function formatQuantity(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.01) return String(Math.round(value))
  if (Math.abs(value - 0.25) < 0.01) return '1/4'
  if (Math.abs(value - 0.5) < 0.01) return '1/2'
  if (Math.abs(value - 0.75) < 0.01) return '3/4'
  if (Math.abs(value - 1.5) < 0.01) return '1.5'
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
