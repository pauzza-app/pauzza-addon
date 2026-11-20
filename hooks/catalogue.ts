// The on-device check of the signed offer list. Pure. Ported from the server's
// own check of the same list (also called `acceptCatalogue`): keep the two in
// step.
//
// Everything the server sends is treated as hostile. The list is shown only if
// its signature is from a key built into this release and every field fits a
// closed shape; anything else is refused whole and the last good list stays.
// Nothing here can throw.
//
// One deliberate difference from the server: text is held to this add-on's own
// character rules (`offers.ts`, English letters only), which are stricter than
// the server's. A list the device would not show is refused, never cleaned.

import { verify } from './ed25519'
import { checkText as checkOfferText, CODE_FORMAT, KNOWN_CATEGORIES, MAX_CATALOG_CHARS, MAX_TEXT } from './offers'

export { CODE_FORMAT }
export const MAX_ENVELOPE_BYTES = MAX_CATALOG_CHARS
const MAX_LABEL = 24
const MAX_LIST = 200
const MAX_LIFETIME_DAYS = 14
// Shared with the rest of the add-on: ids, x.y.z versions and Tbilisi time.
export const ID_FORMAT = /^[a-z0-9-]{1,40}$/
const MERCHANT_ID_FORMAT = /^[a-z0-9-]{1,24}$/
// Pop-ups choose a built-in line by name and carry no text.
export const POPUP_TEMPLATES: readonly string[] = ['daily-offer', 'limit-lounge']
export const POPUP_TEMPLATES_V2: readonly string[] = ['daily-offer', 'limit-lounge', 'event-start', 'news']
// Format 2: where an offer shows, and the built-in looks of a campaign (event).
export const SLOTS: readonly string[] = ['daily', 'limit-5h', 'limit-week', 'present']
export const EVENT_LOOKS: readonly string[] = ['sale', 'black-friday', 'new-year', 'valentine', 'summer', 'back-to-school', 'special', 'spotlight', 'fresh']
// Format 2 categories: 20 built in and 4 the owner names. Format 1 keeps KNOWN_CATEGORIES.
export const CATEGORIES_V2: readonly string[] = ['food', 'drinks', 'groceries', 'tickets', 'gadgets', 'fashion', 'beauty', 'health', 'sport', 'travel', 'transport', 'education', 'software', 'services', 'finance', 'insurance', 'home', 'games', 'kids', 'other', 'custom-1', 'custom-2', 'custom-3', 'custom-4']
const MAX_EVENTS = 3
const MAX_EVENT_DAYS = 62
const MIN_PRESENT_AGE_SECONDS = 60
// Format 2 carries no merchant, code type or budget: those stay on the server, and the list holds only
// their sealed fingerprint, which this add-on checks for shape and never reads.
const PRIVATE_DIGEST_FORMAT = /^[0-9a-f]{64}$/
// Georgia has kept UTC+4 all year since 2005, with no daylight saving, so
// Tbilisi time is a fixed offset.
export const TBILISI_OFFSET_MS = 4 * 3_600_000
const HHMM_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/
export const VERSION_FORMAT = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/
const ISO_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const HOST_FORMAT = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

// What this add-on reads of a campaign and an offer, in either format. Format 1 also carries the
// merchant, the code type and both budgets (CampaignV1, ServerOfferV1); format 2 does not (those stay on
// the server), and nothing here reads them.
export type Campaign = {
  id: string
  opensAt: string
  claimBy: string
  useBy: string
  minInstallAgeSeconds: number
}

export type ServerOffer = {
  id: string
  brand: string
  text: string
  category: string
  link?: string
  campaign: Campaign
}

export type CampaignV1 = Campaign & { codeModel: 'list' | 'generated'; hourlyBudget: number; totalBudget: number }
export type ServerOfferV1 = ServerOffer & { merchantId: string; campaign: CampaignV1 }

export type PopupRule = { id: string; template: string; maxPerDay: number }

export type Slot = 'daily' | 'limit-5h' | 'limit-week' | 'present'
export type EventLook = 'sale' | 'black-friday' | 'new-year' | 'valentine' | 'summer' | 'back-to-school' | 'special' | 'spotlight' | 'fresh'
export type CatalogueEvent = { id: string; name: string; startsAt: string; endsAt: string; look: EventLook }
export type ServerOfferV2 = ServerOffer & { slot?: Slot; eventId?: string }

type CatalogueBase = {
  seq: number
  issuedAt: string
  expiresAt: string
  minAddonVersion: string
  allowedLinkHosts: string[]
  categories: { id: string; label: string }[]
  popupRules: PopupRule[]
}

export type CatalogueV1 = CatalogueBase & {
  v: 1; offers: ServerOfferV1[]; schedule: { timeZone: 'Asia/Tbilisi'; dailyOfferOpens: string; firstPresentAfterSeconds: number }
}
export type CatalogueV2 = CatalogueBase & {
  v: 2; latestAddonVersion: string; events: CatalogueEvent[]; offers: ServerOfferV2[]; schedule: { dailyOfferOpens: string }; privateDigest: string
}
export type Catalogue = CatalogueV1 | CatalogueV2

type Envelope = { v: 1; keyId: string; payload: string; sig: string }
type Errors = string[]

// As the server's: surrounding spaces are refused, not trimmed away.
function checkText(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value === value.trim() ? checkOfferText(value, max) : undefined
}

function exactKeys(value: unknown, keys: readonly string[], optional: readonly string[], where: string, errors: Errors): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${where}: not an object`)

    return false
  }

  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) {
      errors.push(`${where}: unknown field`)
    }
  }

  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${where}: missing ${key}`)
    }
  }

  return true
}

const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max

export function parseIso(value: unknown): number {
  return typeof value === 'string' && value.length <= 30 && ISO_FORMAT.test(value) ? Date.parse(value) : NaN
}

function checkIso(value: unknown, where: string, errors: Errors): number {
  const time = parseIso(value)

  if (Number.isNaN(time)) {
    errors.push(`${where}: not a UTC timestamp`)
  }

  return time
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

// Minutes after midnight, Tbilisi time, of an exact minute (seconds and
// milliseconds 0); NaN for any other time.
function tbilisiMinute(time: number): number {
  const local = time + TBILISI_OFFSET_MS

  if (!Number.isFinite(local) || local % 60_000 !== 0) {
    return NaN
  }

  return (((local % 86_400_000) + 86_400_000) % 86_400_000) / 60_000
}

// Sorted by start, each range must start at or after the previous one ends.
function overlaps(ranges: [number, number][]): boolean {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])

  return sorted.some((range, index) => index > 0 && range[0] < sorted[index - 1]![1])
}

const isPlainHost = (host: unknown): host is string => typeof host === 'string' && HOST_FORMAT.test(host) && !host.split('.').some(label => label.startsWith('xn--'))

// The host of a signed destination, or undefined: https only, an exact host
// from the signed list, no user name, port or punycode. The add-on opens only a
// link that passes this on the held, verified list (`offerLink` in display.ts),
// and shows this host as its label.
export function checkLink(url: unknown, allowedHosts: readonly string[]): string | undefined {
  if (typeof url !== 'string' || url.length > 300 || /[\s\\]/.test(url)) {
    return undefined
  }

  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const host = parsed.hostname

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return undefined
  }

  if (!isPlainHost(host) || !allowedHosts.includes(host)) {
    return undefined
  }

  return url.startsWith(`https://${host}/`) || url === `https://${host}` ? host : undefined
}

// The offer review checklist: no addresses, commands, backticks, or requests
// for passwords or payment details. Checked when signing and again here.
const FORBIDDEN_WORDS = [
  'http', 'www', '.com', '.ge', 'curl', 'wget', 'sudo', 'npm', 'install', 'run ', 'paste', 'terminal', 'command',
  'password', 'passcode', 'pin', 'cvv', 'card number', 'bank card', 'login', 'log in', 'sign in', 'verify your', 'account is locked',
]

export function reviewText(text: string): string | undefined {
  const lower = text.toLowerCase()

  return FORBIDDEN_WORDS.find(word => (word === 'pin' ? /\bpin\b/.test(lower) : lower.includes(word))) ?? webAddress(text)
}

// A web address written without its scheme (finding 9 of the 2026-11-12 review). A run of letters,
// digits, dots and dashes is an address when a part after a dot is a top-level name on this short
// list (pizza.ge, EXAMPLE.COM, shop.example.co.uk), when it starts with "www.", or when a path
// follows it (example.zip/deal). Abbreviations and numbers pass: e.g., i.e., a.m., No.1, 2.5, 10.00,
// Mon.-Fri., 9.30am, v2.0. Not caught: an address on another top-level name with neither "www." nor
// a path (deal.zip), or one written with spaces or words for the dot; the owner's review is the last
// check. The block from ADDRESS_TLDS to the end of webAddress is the same text in
// server/supabase/functions/_shared/catalogue.ts: a test there compares them.
export const ADDRESS_TLDS: readonly string[] = ['ai', 'am', 'app', 'az', 'biz', 'by', 'cc', 'co', 'com', 'de', 'dev', 'edu', 'eu', 'ge', 'gov', 'info', 'io', 'kz', 'link', 'me', 'net', 'online', 'org', 'pizza', 'pro', 'ru', 'shop', 'site', 'store', 'tech', 'top', 'tr', 'tv', 'ua', 'uk', 'us', 'xyz', '\u10D2\u10D4']

// The address as written, or undefined.
export function webAddress(text: string): string | undefined {
  for (const found of text.matchAll(/[\p{L}\p{N}.-]+/gu)) {
    const run = found[0]
    const parts = run.toLowerCase().split('.')
    const after = text.charAt((found.index ?? 0) + run.length)

    if (
      parts.some((part, i) => i > 0 && ADDRESS_TLDS.includes(part) && /[\p{L}\p{N}]/u.test(parts[i - 1] ?? '')) ||
      (parts[0] === 'www' && parts.length > 1 && parts[1] !== '') ||
      (after === '/' && /[\p{L}\p{N}]\.\p{L}{2}/u.test(run))
    ) {
      return run.replace(/^[.-]+|[.-]+$/g, '')
    }
  }

  return undefined
}

// Either format, as the server's check. Format 1 has the fields 0.20.2 reads,
// checked as 0.20.2 checks them, with one rule more: this add-on also refuses a
// web address written into a brand, offer text or category label (webAddress,
// finding 9; in format 2 also a campaign name), which 0.20.2 does not check. The
// list's fields are unchanged. Format 2 adds latestAddonVersion, events, an offer's optional slot or
// eventId, the wider set of categories and privateDigest, and has no merchantId,
// codeModel, hourlyBudget or totalBudget, and no schedule timeZone or
// firstPresentAfterSeconds: any of them refuses the list. Which format this
// release wants is acceptCatalogue's choice.
export function validateCatalogue(data: unknown): { ok: true; catalogue: Catalogue } | { ok: false; errors: string[] } {
  const errors: Errors = []
  const v2 = isRecord(data) && data.v === 2
  const top = ['v', 'seq', 'issuedAt', 'expiresAt', 'minAddonVersion', 'allowedLinkHosts', 'categories', 'offers', 'schedule', 'popupRules']

  if (!exactKeys(data, v2 ? [...top, 'latestAddonVersion', 'events', 'privateDigest'] : top, [], 'catalogue', errors)) {
    return { ok: false, errors }
  }

  if (data.v !== 1 && data.v !== 2) {
    errors.push('v must be 1 or 2')
  }

  if (!isInt(data.seq, 1, Number.MAX_SAFE_INTEGER)) {
    errors.push('seq must be a positive integer')
  }

  const issued = checkIso(data.issuedAt, 'issuedAt', errors)
  const expires = checkIso(data.expiresAt, 'expiresAt', errors)

  if (!(expires > issued)) {
    errors.push('expiresAt must be after issuedAt')
  }

  if (expires - issued > MAX_LIFETIME_DAYS * 86_400_000) {
    errors.push('lifetime too long')
  }

  if (typeof data.minAddonVersion !== 'string' || !VERSION_FORMAT.test(data.minAddonVersion)) {
    errors.push('minAddonVersion must be x.y.z')
  }

  if (v2 && (typeof data.latestAddonVersion !== 'string' || !VERSION_FORMAT.test(data.latestAddonVersion))) {
    errors.push('latestAddonVersion must be x.y.z')
  }

  if (v2 && (typeof data.privateDigest !== 'string' || !PRIVATE_DIGEST_FORMAT.test(data.privateDigest))) {
    errors.push('privateDigest must be 64 lower-case hex characters')
  }

  const hosts = data.allowedLinkHosts

  if (!Array.isArray(hosts) || hosts.length > 50 || !hosts.every(isPlainHost)) {
    errors.push('allowedLinkHosts must be plain lower-case host names')
  }

  const allowed = Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === 'string') : []
  const ids = new Set<string>()
  const campaignIds = new Set<string>()
  const categoryIds = new Set<string>()
  const knownCategories = v2 ? CATEGORIES_V2 : KNOWN_CATEGORIES

  if (!Array.isArray(data.categories) || data.categories.length > knownCategories.length) {
    errors.push('categories must be a short list')
  } else {
    data.categories.forEach((category: unknown, index: number) => {
      const where = `categories[${index}]`

      if (!exactKeys(category, ['id', 'label'], [], where, errors)) {
        return
      }

      if (typeof category.id !== 'string' || !knownCategories.includes(category.id) || categoryIds.has(category.id)) {
        errors.push(`${where}: unknown or repeated category`)
      } else {
        categoryIds.add(category.id)
      }

      // A label is a drawer's name: no web address in it either (finding 9).
      const label = checkText(category.label, MAX_LABEL)

      if (label === undefined || webAddress(label) !== undefined) {
        errors.push(`${where}: label not allowed`)
      }
    })
  }

  // Events come before offers, which may name them.
  const eventIds = new Set<string>()
  const eventRanges: [number, number][] = []

  if (v2) {
    if (!Array.isArray(data.events) || data.events.length > MAX_EVENTS) {
      errors.push(`events must be a list of at most ${MAX_EVENTS}`)
    } else {
      data.events.forEach((event: unknown, index: number) => {
        const where = `events[${index}]`

        if (!exactKeys(event, ['id', 'name', 'startsAt', 'endsAt', 'look'], [], where, errors)) {
          return
        }

        if (typeof event.id !== 'string' || !ID_FORMAT.test(event.id) || eventIds.has(event.id)) {
          errors.push(`${where}: bad or repeated id`)
        } else {
          eventIds.add(event.id)
        }

        const name = checkText(event.name, MAX_LABEL)

        if (name === undefined) {
          errors.push(`${where}: name has characters or length that are not allowed`)
        } else if (reviewText(name) !== undefined) {
          errors.push(`${where}: name fails the offer review`)
        }

        const starts = checkIso(event.startsAt, `${where}.startsAt`, errors)
        const ends = checkIso(event.endsAt, `${where}.endsAt`, errors)

        if (!(starts < ends)) {
          errors.push(`${where}: needs startsAt < endsAt`)
        } else if (ends - starts > MAX_EVENT_DAYS * 86_400_000) {
          errors.push(`${where}: longer than ${MAX_EVENT_DAYS} days`)
        } else {
          eventRanges.push([starts, ends])
        }

        if (typeof event.look !== 'string' || !EVENT_LOOKS.includes(event.look)) {
          errors.push(`${where}: unknown look`)
        }
      })

      if (overlaps(eventRanges)) {
        errors.push('events overlap')
      }
    }
  }

  const schedule = data.schedule
  const opensAt = isRecord(schedule) && typeof schedule.dailyOfferOpens === 'string' && HHMM_FORMAT.test(schedule.dailyOfferOpens) ? schedule.dailyOfferOpens : undefined
  const dailyMinute = opensAt === undefined ? NaN : Number(opensAt.slice(0, 2)) * 60 + Number(opensAt.slice(3))
  const dailyRanges: [number, number][] = []

  if (!Array.isArray(data.offers) || data.offers.length > MAX_LIST) {
    errors.push('offers must be a short list')
  } else {
    data.offers.forEach((offer: unknown, index: number) => {
      const where = `offers[${index}]`

      if (!exactKeys(offer, v2 ? ['id', 'brand', 'text', 'category', 'campaign'] : ['id', 'merchantId', 'brand', 'text', 'category', 'campaign'], v2 ? ['link', 'slot', 'eventId'] : ['link'], where, errors)) {
        return
      }

      if (typeof offer.id !== 'string' || !ID_FORMAT.test(offer.id) || ids.has(offer.id)) {
        errors.push(`${where}: bad or repeated id`)
      } else {
        ids.add(offer.id)
      }

      if (!v2 && (typeof offer.merchantId !== 'string' || !MERCHANT_ID_FORMAT.test(offer.merchantId))) {
        errors.push(`${where}: bad merchantId`)
      }

      for (const field of ['brand', 'text'] as const) {
        const text = checkText(offer[field])

        if (text === undefined) {
          errors.push(`${where}: ${field} has characters or length that are not allowed`)
        } else if (reviewText(text) !== undefined) {
          errors.push(`${where}: ${field} fails the offer review`)
        }
      }

      // Format 2: only a category the list carries, so an offer never sits in a drawer that does not exist.
      if (typeof offer.category !== 'string' || !(v2 ? categoryIds.has(offer.category) : KNOWN_CATEGORIES.includes(offer.category))) {
        errors.push(`${where}: unknown category`)
      }

      if (offer.link !== undefined && checkLink(offer.link, allowed) === undefined) {
        errors.push(`${where}: link not allowed`)
      }

      if (offer.slot !== undefined && (typeof offer.slot !== 'string' || !SLOTS.includes(offer.slot))) {
        errors.push(`${where}: unknown slot`)
      }

      if (offer.eventId !== undefined && (typeof offer.eventId !== 'string' || !eventIds.has(offer.eventId))) {
        errors.push(`${where}: eventId names no event`)
      }

      if (offer.slot !== undefined && offer.eventId !== undefined) {
        errors.push(`${where}: slot and eventId together`)
      }

      const campaign = offer.campaign
      const at = `${where}.campaign`

      const campaignKeys = v2 ? ['id', 'opensAt', 'claimBy', 'useBy', 'minInstallAgeSeconds'] : ['id', 'codeModel', 'opensAt', 'claimBy', 'useBy', 'minInstallAgeSeconds', 'hourlyBudget', 'totalBudget']

      if (!exactKeys(campaign, campaignKeys, [], at, errors)) {
        return
      }

      if (typeof campaign.id !== 'string' || !ID_FORMAT.test(campaign.id) || campaignIds.has(campaign.id)) {
        errors.push(`${at}: bad or repeated id`)
      } else {
        campaignIds.add(campaign.id)
      }

      if (!v2 && campaign.codeModel !== 'list' && campaign.codeModel !== 'generated') {
        errors.push(`${at}: codeModel must be list or generated`)
      }

      const opens = checkIso(campaign.opensAt, `${at}.opensAt`, errors)
      const claimBy = checkIso(campaign.claimBy, `${at}.claimBy`, errors)
      const useBy = checkIso(campaign.useBy, `${at}.useBy`, errors)

      if (!(opens < claimBy && claimBy <= useBy)) {
        errors.push(`${at}: needs opensAt < claimBy <= useBy`)
      }

      if (!isInt(campaign.minInstallAgeSeconds, 0, 366 * 86_400)) {
        errors.push(`${at}: bad minInstallAgeSeconds`)
      }

      if (!v2 && !isInt(campaign.hourlyBudget, 1, 100_000)) {
        errors.push(`${at}: bad hourlyBudget`)
      }

      if (!v2 && !isInt(campaign.totalBudget, 1, 1_000_000)) {
        errors.push(`${at}: bad totalBudget`)
      }

      if (offer.slot === 'daily') {
        if (tbilisiMinute(opens) !== dailyMinute) {
          errors.push(`${where}: daily offer must open at dailyOfferOpens, Tbilisi time`)
        }

        if (claimBy - opens > 86_400_000) {
          errors.push(`${where}: daily offer claimBy over 24 hours after opensAt`)
        }

        if (Number.isFinite(opens) && Number.isFinite(claimBy)) {
          dailyRanges.push([opens, claimBy])
        }
      }

      if (offer.slot === 'present' && !isInt(campaign.minInstallAgeSeconds, MIN_PRESENT_AGE_SECONDS, 366 * 86_400)) {
        errors.push(`${where}: present needs minInstallAgeSeconds of at least ${MIN_PRESENT_AGE_SECONDS}`)
      }
    })

    if (overlaps(dailyRanges)) {
      errors.push('daily offers overlap')
    }
  }

  if (exactKeys(schedule, v2 ? ['dailyOfferOpens'] : ['timeZone', 'dailyOfferOpens', 'firstPresentAfterSeconds'], [], 'schedule', errors)) {
    if (!v2 && schedule.timeZone !== 'Asia/Tbilisi') {
      errors.push('schedule.timeZone must be Asia/Tbilisi')
    }

    if (typeof schedule.dailyOfferOpens !== 'string' || !HHMM_FORMAT.test(schedule.dailyOfferOpens)) {
      errors.push('schedule.dailyOfferOpens must be HH:MM')
    }

    if (!v2 && !isInt(schedule.firstPresentAfterSeconds, 0, 86_400)) {
      errors.push('schedule.firstPresentAfterSeconds bad')
    }
  }

  if (!Array.isArray(data.popupRules) || data.popupRules.length > 10) {
    errors.push('popupRules must be a short list')
  } else {
    data.popupRules.forEach((rule: unknown, index: number) => {
      const where = `popupRules[${index}]`

      if (!exactKeys(rule, ['id', 'template', 'maxPerDay'], [], where, errors)) {
        return
      }

      if (typeof rule.id !== 'string' || !ID_FORMAT.test(rule.id)) {
        errors.push(`${where}: bad id`)
      }

      if (typeof rule.template !== 'string' || !(v2 ? POPUP_TEMPLATES_V2 : POPUP_TEMPLATES).includes(rule.template)) {
        errors.push(`${where}: unknown template`)
      }

      if (!isInt(rule.maxPerDay, 0, 4)) {
        errors.push(`${where}: maxPerDay 0-4`)
      }
    })
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, catalogue: data as unknown as Catalogue }
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0))
}

function parseEnvelope(text: unknown): Envelope | undefined {
  // Each character is at least one byte, so this refuses before any encoding.
  if (typeof text !== 'string' || text.length > MAX_ENVELOPE_BYTES || new TextEncoder().encode(text).length > MAX_ENVELOPE_BYTES) {
    return undefined
  }

  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }

  const errors: Errors = []

  if (!exactKeys(data, ['v', 'keyId', 'payload', 'sig'], [], 'envelope', errors) || errors.length > 0) {
    return undefined
  }

  if (data.v !== 1 || typeof data.keyId !== 'string' || !/^[a-z0-9-]{1,20}$/.test(data.keyId)) {
    return undefined
  }

  if (typeof data.payload !== 'string' || typeof data.sig !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(data.sig)) {
    return undefined
  }

  return data as unknown as Envelope
}

// keyId -> raw Ed25519 public key, base64.
export type PinnedKeys = Record<string, string>

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) {
      return left[i] - right[i]
    }
  }

  return 0
}

export type AcceptResult = { ok: true; catalogue: Catalogue; showOffers: boolean } | { ok: false; reason: string }

// What the device does with a fetched list. Any failure means: keep the last
// good list, silently. A list of any format but the one asked for is refused
// ("wrong format"), as the server's check does with its own `format`. The
// format must be named: this add-on asks for format 2 only, and a missing or
// unknown `format` refuses every list.
export async function acceptCatalogue(text: unknown, opts: { pinnedKeys: PinnedKeys; lastSeq: number; now: number; addonVersion: string; format: 1 | 2 }): Promise<AcceptResult> {
  try {
    const envelope = parseEnvelope(text)

    if (envelope === undefined) {
      return { ok: false, reason: 'envelope' }
    }

    const key = Object.hasOwn(opts.pinnedKeys, envelope.keyId) ? opts.pinnedKeys[envelope.keyId] : undefined

    if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key)) {
      return { ok: false, reason: 'unknown key' }
    }

    if (!(await verify(fromBase64(key), fromBase64(envelope.sig), new TextEncoder().encode(envelope.payload)))) {
      return { ok: false, reason: 'signature' }
    }

    let data: unknown

    try {
      data = JSON.parse(envelope.payload)
    } catch {
      return { ok: false, reason: 'payload' }
    }

    // Only a list of the other known format is "wrong format"; any other
    // value of v is the shape check's to refuse.
    if (isRecord(data) && (data.v === 1 || data.v === 2) && data.v !== opts.format) {
      return { ok: false, reason: 'wrong format' }
    }

    if (opts.format !== 1 && opts.format !== 2) {
      return { ok: false, reason: 'wrong format' }
    }

    const checked = validateCatalogue(data)

    if (!checked.ok) {
      return { ok: false, reason: `schema: ${checked.errors[0]}` }
    }

    const catalogue = checked.catalogue

    if (catalogue.seq <= opts.lastSeq) {
      return { ok: false, reason: 'replayed or old seq' }
    }

    if (Date.parse(catalogue.expiresAt) <= opts.now) {
      return { ok: false, reason: 'expired' }
    }

    if (Date.parse(catalogue.issuedAt) > opts.now + 10 * 60_000) {
      return { ok: false, reason: 'issued in the future' }
    }

    // A signed minimum version hides offers from versions known to be unsafe.
    return { ok: true, catalogue, showOffers: VERSION_FORMAT.test(opts.addonVersion) && compareVersions(opts.addonVersion, catalogue.minAddonVersion) >= 0 }
  } catch {
    return { ok: false, reason: 'error' }
  }
}
