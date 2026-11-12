// Parsing and labelling of the bundled fictional catalogue. No engine calls.
//
// Every field is treated as hostile, as it will be once a server supplies it:
// only expected characters pass (English letters, digits, listed punctuation and
// emoji; no other script, so no look-alike names), and an offer with anything else is refused
// whole rather than cleaned. Nothing here can throw.

import { isMeterId } from './meters'
import type { MeterId } from './meters'

export type Prize = { id: string; brand: string; text: string; code: string }
export type Offer = Prize & { category: string; addedAt: string; sponsored: boolean; score: number }
export type Reward = Prize & { minutes: number }
export type Drop = Prize & { quantity: number }
export type Category = { id: string; label: string }
export type Catalog = {
  categories: Category[]
  offers: Offer[]
  rewards: Reward[]
  milestones: Reward[]
  dailyPresent: boolean
  defaultMeters: MeterId[]
  welcomeReward: Prize | undefined
  burnFive: Prize | undefined
  burnWeek: Prize | undefined
  goodPaceReward: Prize | undefined
  finishReward: Prize | undefined
  drops: Drop[]
}

export const MAX_TEXT = 60
const MAX_LABEL = 24
// A string longer than this is refused before any character is looked at.
const MAX_RAW = 240
// The whole catalogue. A larger file is ignored and the last good one stays.
export const MAX_CATALOG_CHARS = 256 * 1024
const MAX_LIST = 200

// Codes are typed by hand and pasted into checkouts, so they are kept plain:
// capitals and digits, with at most one dash. Never loosened for a merchant.
export const CODE_FORMAT = /^[A-Z0-9]{4,20}(-[A-Z0-9]{2,8})?$/
// This build carries fictional prizes only.
const FICTIONAL_CODE = /^TEST-[A-Z0-9]{4}$/
const FICTIONAL_BRAND = /^Test /
const ID_FORMAT = /^[a-z0-9-]{1,40}$/
export const KNOWN_CATEGORIES: readonly string[] = ['food', 'drinks', 'tickets', 'gadgets']

const PUNCTUATION = new Set(Array.from(' -%.,!?:;\'"()&+/№«»„“”’–—'))
const EMOJI = new Set(Array.from('🍕☕🎁🎟🎧🥤⭐🥟🍷🧃'))

const isLatin = (code: number) => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
const isDigit = (code: number) => code >= 0x30 && code <= 0x39

function isAllowed(char: string): boolean {
  const code = char.codePointAt(0) ?? 0

  return isLatin(code) || isDigit(code) || PUNCTUATION.has(char) || EMOJI.has(char)
}

// The text if every character is expected, else undefined. Never cleans.
export function checkText(value: unknown, maxLength = MAX_TEXT): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_RAW) {
    return undefined
  }

  const chars = Array.from(value.trim())

  if (chars.length === 0 || chars.length > maxLength || !chars.every(isAllowed)) {
    return undefined
  }

  return chars.join('')
}

function checkId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_FORMAT.test(value) ? value : undefined
}

export function isKnownCategory(value: unknown): value is string {
  return typeof value === 'string' && KNOWN_CATEGORIES.includes(value)
}

function parsePrize(item: any): Prize | undefined {
  const id = checkId(item?.id)
  const brand = checkText(item?.brand)
  const text = checkText(item?.text)
  const code = typeof item?.code === 'string' && item.code.length <= 40 ? item.code : undefined

  if (id === undefined || brand === undefined || text === undefined || code === undefined) {
    return undefined
  }

  const isValid = FICTIONAL_BRAND.test(brand) && CODE_FORMAT.test(code) && FICTIONAL_CODE.test(code)

  return isValid ? { id, brand, text, code } : undefined
}

function parseList<T>(value: unknown, parse: (item: any) => T | undefined): T[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, MAX_LIST).flatMap(item => {
    const parsed = parse(item)

    return parsed === undefined ? [] : [parsed]
  })
}

function parseOffer(item: any): Offer | undefined {
  const prize = parsePrize(item)
  const addedAt = typeof item?.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.addedAt) ? item.addedAt : undefined
  const score = Number.isFinite(item?.score) ? Math.min(100, Math.max(0, item.score)) : 0

  return prize && addedAt !== undefined && isKnownCategory(item?.category)
    ? { ...prize, category: item.category, addedAt, sponsored: item?.sponsored === true, score }
    : undefined
}

function parseReward(item: any): Reward | undefined {
  const prize = parsePrize(item)

  return prize && Number.isFinite(item?.minutes) && item.minutes > 0 && item.minutes <= 24 * 60 ? { ...prize, minutes: item.minutes } : undefined
}

function parseDrop(item: any): Drop | undefined {
  const prize = parsePrize(item)

  return prize && Number.isInteger(item?.quantity) && item.quantity > 0 && item.quantity <= 1_000_000 ? { ...prize, quantity: item.quantity } : undefined
}

function parseCategory(item: any): Category | undefined {
  const label = checkText(item?.label, MAX_LABEL)

  return isKnownCategory(item?.id) && label !== undefined ? { id: item.id, label } : undefined
}

export const EMPTY_CATALOG: Catalog = {
  categories: [],
  offers: [],
  rewards: [],
  milestones: [],
  dailyPresent: false,
  defaultMeters: [],
  welcomeReward: undefined,
  burnFive: undefined,
  burnWeek: undefined,
  goodPaceReward: undefined,
  finishReward: undefined,
  drops: [],
}

// An oversized, unreadable or broken catalogue never stops the add-on: the
// last good one stays, or nothing is offered.
export function parseCatalog(raw: unknown, lastGood: Catalog = EMPTY_CATALOG): Catalog {
  if (typeof raw !== 'string' || raw.length > MAX_CATALOG_CHARS) {
    return lastGood
  }

  try {
    const data = JSON.parse(raw)

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return lastGood
    }

    const ids = new Set<string>()
    const categories = parseList(data.categories, parseCategory).filter(category => !ids.has(category.id) && ids.add(category.id))

    return {
      categories,
      offers: parseList(data.offers, parseOffer),
      rewards: parseList(data.rewards, parseReward).sort((a, b) => a.minutes - b.minutes),
      milestones: parseList(data.milestones, parseReward).sort((a, b) => a.minutes - b.minutes),
      dailyPresent: data.dailyPresent === true,
      defaultMeters: Array.isArray(data.defaultMeters) ? data.defaultMeters.slice(0, 10).filter(isMeterId) : [],
      welcomeReward: parsePrize(data.welcomeReward),
      burnFive: parsePrize(data.burnFive),
      burnWeek: parsePrize(data.burnWeek),
      goodPaceReward: parsePrize(data.goodPaceReward),
      finishReward: parsePrize(data.finishReward),
      drops: parseList(data.drops, parseDrop),
    }
  } catch {
    return lastGood
  }
}

// Chosen categories first; within each group, recently copied, then newest.
// In the Limit Lounge the highest-scored offers come before all of that.
export function sortOffers(offers: readonly Offer[], categories: readonly string[], recent: readonly string[], isLounge = false): Offer[] {
  const recentRank = (offer: Offer) => {
    const index = recent.indexOf(offer.id)

    return index === -1 ? recent.length : index
  }

  return [...offers].sort(
    (a, b) =>
      (isLounge ? b.score - a.score : 0) ||
      Number(categories.includes(b.category)) - Number(categories.includes(a.category)) ||
      recentRank(a) - recentRank(b) ||
      b.addedAt.localeCompare(a.addedAt),
  )
}
