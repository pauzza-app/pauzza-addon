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
const ID_FORMAT = /^[a-z0-9-]{1,40}$/
const MERCHANT_ID_FORMAT = /^[a-z0-9-]{1,24}$/
// Pop-ups choose a built-in line by name and carry no text.
export const POPUP_TEMPLATES: readonly string[] = ['daily-offer', 'limit-lounge']
const VERSION_FORMAT = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/
const ISO_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const HOST_FORMAT = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export type Campaign = {
  id: string
  codeModel: 'list' | 'generated'
  opensAt: string
  claimBy: string
  useBy: string
  minInstallAgeSeconds: number
  hourlyBudget: number
  totalBudget: number
}

export type ServerOffer = {
  id: string
  merchantId: string
  brand: string
  text: string
  category: string
  link?: string
  campaign: Campaign
}

export type PopupRule = { id: string; template: string; maxPerDay: number }

export type Catalogue = {
  v: 1
  seq: number
  issuedAt: string
  expiresAt: string
  minAddonVersion: string
  allowedLinkHosts: string[]
  categories: { id: string; label: string }[]
  offers: ServerOffer[]
  schedule: { timeZone: 'Asia/Tbilisi'; dailyOfferOpens: string; firstPresentAfterSeconds: number }
  popupRules: PopupRule[]
}

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

const isPlainHost = (host: unknown): host is string => typeof host === 'string' && HOST_FORMAT.test(host) && !host.split('.').some(label => label.startsWith('xn--'))

// The host of a signed destination, or undefined: https only, an exact host
// from the signed list, no user name, port or punycode. The add-on never opens
// this address itself; it shows the host beside its own fixed link.
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

  return FORBIDDEN_WORDS.find(word => (word === 'pin' ? /\bpin\b/.test(lower) : lower.includes(word)))
}

export function validateCatalogue(data: unknown): { ok: true; catalogue: Catalogue } | { ok: false; errors: string[] } {
  const errors: Errors = []
  const top = ['v', 'seq', 'issuedAt', 'expiresAt', 'minAddonVersion', 'allowedLinkHosts', 'categories', 'offers', 'schedule', 'popupRules']

  if (!exactKeys(data, top, [], 'catalogue', errors)) {
    return { ok: false, errors }
  }

  if (data.v !== 1) {
    errors.push('v must be 1')
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

  const hosts = data.allowedLinkHosts

  if (!Array.isArray(hosts) || hosts.length > 50 || !hosts.every(isPlainHost)) {
    errors.push('allowedLinkHosts must be plain lower-case host names')
  }

  const allowed = Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === 'string') : []
  const ids = new Set<string>()
  const campaignIds = new Set<string>()
  const categoryIds = new Set<string>()

  if (!Array.isArray(data.categories) || data.categories.length > KNOWN_CATEGORIES.length) {
    errors.push('categories must be a short list')
  } else {
    data.categories.forEach((category: unknown, index: number) => {
      const where = `categories[${index}]`

      if (!exactKeys(category, ['id', 'label'], [], where, errors)) {
        return
      }

      if (typeof category.id !== 'string' || !KNOWN_CATEGORIES.includes(category.id) || categoryIds.has(category.id)) {
        errors.push(`${where}: unknown or repeated category`)
      } else {
        categoryIds.add(category.id)
      }

      if (checkText(category.label, MAX_LABEL) === undefined) {
        errors.push(`${where}: label not allowed`)
      }
    })
  }

  if (!Array.isArray(data.offers) || data.offers.length > MAX_LIST) {
    errors.push('offers must be a short list')
  } else {
    data.offers.forEach((offer: unknown, index: number) => {
      const where = `offers[${index}]`

      if (!exactKeys(offer, ['id', 'merchantId', 'brand', 'text', 'category', 'campaign'], ['link'], where, errors)) {
        return
      }

      if (typeof offer.id !== 'string' || !ID_FORMAT.test(offer.id) || ids.has(offer.id)) {
        errors.push(`${where}: bad or repeated id`)
      } else {
        ids.add(offer.id)
      }

      if (typeof offer.merchantId !== 'string' || !MERCHANT_ID_FORMAT.test(offer.merchantId)) {
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

      if (typeof offer.category !== 'string' || !KNOWN_CATEGORIES.includes(offer.category)) {
        errors.push(`${where}: unknown category`)
      }

      if (offer.link !== undefined && checkLink(offer.link, allowed) === undefined) {
        errors.push(`${where}: link not allowed`)
      }

      const campaign = offer.campaign
      const at = `${where}.campaign`

      if (!exactKeys(campaign, ['id', 'codeModel', 'opensAt', 'claimBy', 'useBy', 'minInstallAgeSeconds', 'hourlyBudget', 'totalBudget'], [], at, errors)) {
        return
      }

      if (typeof campaign.id !== 'string' || !ID_FORMAT.test(campaign.id) || campaignIds.has(campaign.id)) {
        errors.push(`${at}: bad or repeated id`)
      } else {
        campaignIds.add(campaign.id)
      }

      if (campaign.codeModel !== 'list' && campaign.codeModel !== 'generated') {
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

      if (!isInt(campaign.hourlyBudget, 1, 100_000)) {
        errors.push(`${at}: bad hourlyBudget`)
      }

      if (!isInt(campaign.totalBudget, 1, 1_000_000)) {
        errors.push(`${at}: bad totalBudget`)
      }
    })
  }

  const schedule = data.schedule

  if (exactKeys(schedule, ['timeZone', 'dailyOfferOpens', 'firstPresentAfterSeconds'], [], 'schedule', errors)) {
    if (schedule.timeZone !== 'Asia/Tbilisi') {
      errors.push('schedule.timeZone must be Asia/Tbilisi')
    }

    if (typeof schedule.dailyOfferOpens !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.dailyOfferOpens)) {
      errors.push('schedule.dailyOfferOpens must be HH:MM')
    }

    if (!isInt(schedule.firstPresentAfterSeconds, 0, 86_400)) {
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

      if (typeof rule.template !== 'string' || !POPUP_TEMPLATES.includes(rule.template)) {
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
// good list, silently.
export async function acceptCatalogue(text: unknown, opts: { pinnedKeys: PinnedKeys; lastSeq: number; now: number; addonVersion: string }): Promise<AcceptResult> {
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
