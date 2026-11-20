// What the add-on may say to the Pauzza server, and what it accepts back. Pure.
//
// One address, fixed in the release. Every request is built here from that
// address and a name on a short list; no address is ever taken from a reply.
// Requests carry only the fields below: never code, prompts, conversations,
// file names, usage percentages, waiting time or anything from the machine.

import { CODE_FORMAT, ID_FORMAT, parseIso, VERSION_FORMAT as ADDON_VERSION_FORMAT } from './catalogue'

export const BASE_URL = 'https://pwchzyltlirhiiaxoifb.supabase.co/functions/v1/'
// Must equal the version in `.claude-plugin/plugin.json`. Sent at Connect, and
// compared with the signed list's minimum version.
export const ADDON_VERSION = '0.21.1'

export type Endpoint = 'connect' | 'catalogue2' | 'claim' | 'withdraw'
export type Outgoing = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
export type Reply = { status: number; text: string; headers: Record<string, string> }
export type Versions = { wordingVersion: string; termsVersion: string; privacyVersion: string }

// A reply slower than this counts as no reply.
export const TIMEOUT_MS = 10_000
// Replies to a press are tiny; anything larger is not ours.
export const MAX_REPLY_CHARS = 2048

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/
const REF_FORMAT = /^[0-9A-HJKMNP-TV-Z]{10}$/
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VERSION_FORMAT = /^[0-9A-Za-z.-]{1,20}$/
const DAY_MS = 86_400_000

export const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN_FORMAT.test(value)
export const isPublicRef = (value: unknown): value is string => typeof value === 'string' && REF_FORMAT.test(value)
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_FORMAT.test(value)
const areVersions = (v: Versions) => [v.wordingVersion, v.termsVersion, v.privacyVersion].every(item => typeof item === 'string' && VERSION_FORMAT.test(item))

const post = (endpoint: Endpoint, body: unknown, token?: string): Outgoing => ({
  url: BASE_URL + endpoint,
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
})

// The Connect press: the three versions of what was on screen and the add-on's
// own version. No identifier of any kind.
export function connectRequest(versions: Versions, addonVersion: string): Outgoing | undefined {
  return areVersions(versions) && ADDON_VERSION_FORMAT.test(addonVersion)
    ? post('connect', { wordingVersion: versions.wordingVersion, termsVersion: versions.termsVersion, privacyVersion: versions.privacyVersion, addonVersion })
    : undefined
}

// The offer list, format 2 (slots and campaigns): anonymous. No token, no
// identifier, no cookie, and no header at all: not even If-None-Match, so
// nothing the server chose earlier (its tag) is ever sent back to it
// (finding 6 of the 2026-11-12 review). The request is the same for everyone.
// From 0.21.0 this is the only list asked for; the format 1 address stays for
// 0.20.2 until it ends.
export function catalogueRequest(): Outgoing {
  return { url: `${BASE_URL}catalogue2`, method: 'GET', headers: {} }
}

// A "Get code" press: which offer, and a fresh random key so a repeated press
// cannot take two codes.
export function claimRequest(token: string, campaignId: string, idempotencyKey: string): Outgoing | undefined {
  return isToken(token) && ID_FORMAT.test(campaignId) && isUuid(idempotencyKey) ? post('claim', { campaignId, idempotencyKey }, token) : undefined
}

export function withdrawRequest(token: string, versions: Versions): Outgoing | undefined {
  return isToken(token) && areVersions(versions)
    ? post('withdraw', { wordingVersion: versions.wordingVersion, termsVersion: versions.termsVersion, privacyVersion: versions.privacyVersion }, token)
    : undefined
}

// A reply's JSON object if it is small, well formed and has exactly these keys.
function exactObject(reply: Reply, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof reply.text !== 'string' || reply.text.length > MAX_REPLY_CHARS) {
    return undefined
  }

  try {
    const data = JSON.parse(reply.text)

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return undefined
    }

    const present = Object.keys(data)

    return present.length === keys.length && keys.every(key => Object.hasOwn(data, key)) ? data : undefined
  } catch {
    return undefined
  }
}

export type Connected = { token: string; publicRef: string; firstSeenAt: number }

// The reply to Connect, or undefined for anything unexpected.
export function parseConnect(reply: Reply, now: number): Connected | undefined {
  const data = reply.status === 201 ? exactObject(reply, ['token', 'publicRef', 'firstSeenAt', 'serverTime']) : undefined
  const firstSeenAt = parseIso(data?.firstSeenAt)

  if (data === undefined || !isToken(data.token) || !isPublicRef(data.publicRef) || Number.isNaN(firstSeenAt) || Number.isNaN(parseIso(data.serverTime))) {
    return undefined
  }

  // A first-seen time far from this computer's clock is not believed: it is
  // only used to show when an offer should be ready.
  return { token: data.token, publicRef: data.publicRef, firstSeenAt: Math.abs(firstSeenAt - now) <= DAY_MS ? firstSeenAt : now }
}

export type Claimed = { claimId: string; code: string; useBy: number }
export type ClaimOutcome = { kind: 'ok'; claim: Claimed } | { kind: 'unavailable' } | { kind: 'busy' } | { kind: 'failed' } | { kind: 'offline' }

// The reply to "Get code". The server gives one answer, "unavailable", for sold
// out, too early, ended and not connected, so the device cannot tell them apart.
// A code that is not plain capitals and digits, or already past its date, is
// thrown away.
export function parseClaim(reply: Reply, now: number): ClaimOutcome {
  if (reply.status === 404) {
    return { kind: 'unavailable' }
  }

  if (reply.status === 429) {
    return { kind: 'busy' }
  }

  const data = reply.status === 200 ? exactObject(reply, ['claimId', 'code', 'useBy']) : undefined
  const useBy = parseIso(data?.useBy)

  if (data === undefined || !isUuid(data.claimId) || typeof data.code !== 'string' || data.code.length > 30 || !CODE_FORMAT.test(data.code) || Number.isNaN(useBy) || useBy <= now) {
    return { kind: 'failed' }
  }

  return { kind: 'ok', claim: { claimId: data.claimId, code: data.code, useBy } }
}

// Withdrawal is done when the server says so, or says it knows no such install.
export const isWithdrawn = (reply: Reply) => reply.status === 200 || reply.status === 404
