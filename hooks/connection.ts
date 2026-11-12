// The connection to the Pauzza server: its saved record, the codes received,
// and what the offer list means right now. Pure: every input is a saved record,
// the clock or a press. Kept apart from the acceptance record on purpose:
// accepting the Terms is never permission to use the network.

import type { Catalogue, PopupRule, ServerOffer } from './catalogue'
import { CODE_FORMAT, parseIso } from './catalogue'
import { CONNECT_PRIVACY_VERSION, CONNECT_TERMS_VERSION, CONNECT_WORDING_VERSION } from './connect-text'
import { UNDO_MS } from './consent'
import { afterFailure, isDue, NEVER_FETCHED, readFetchState } from './fetch-schedule'
import type { FetchState } from './fetch-schedule'
import { checkText } from './offers'
import { isPublicRef, isToken, isUuid } from './server'
import type { Claimed, Connected, Versions } from './server'
import { dayKey } from './waiting-pays'

export const CURRENT_VERSIONS: Versions = { wordingVersion: CONNECT_WORDING_VERSION, termsVersion: CONNECT_TERMS_VERSION, privacyVersion: CONNECT_PRIVACY_VERSION }
// The server forgets an install after 12 months without a press that reaches
// it. From then on the press can no longer be proven, so the add-on stops
// fetching and asks again.
export const FORGOTTEN_AFTER_MS = 365 * 86_400_000
const MAX_HISTORY = 50
const MAX_CODES = 200

type Status = 'none' | 'connected' | 'withdrawn'
// A withdrawal waiting to reach the server. It is sent before anything else.
export type Withdrawal = { token: string; versions: Versions; at: number; retry: FetchState }

export type ConnectionRecord = {
  status: Status
  token: string | null
  publicRef: string | null
  firstSeenAt: number | null
  lastContactAt: number | null
  versions: Versions | null
  at: number | null
  withdrawal: Withdrawal | null
  history: { event: Exclude<Status, 'none'>; wordingVersion: string; at: number }[]
}

// (An earlier version also saved 'declined'; it now reads as never connected.)
const isStatus = (value: unknown): value is Status => value === 'none' || value === 'connected' || value === 'withdrawn'
const timeOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
const text = (value: unknown) => (typeof value === 'string' && value.length <= 40 ? value : '')

function readVersions(raw: unknown): Versions | null {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Versions>
  const versions = { wordingVersion: text(data.wordingVersion), termsVersion: text(data.termsVersion), privacyVersion: text(data.privacyVersion) }

  return Object.values(versions).every(item => item !== '') ? versions : null
}

function readWithdrawal(raw: unknown): Withdrawal | null {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Withdrawal>
  const versions = readVersions(data.versions)
  const at = timeOrNull(data.at)

  return isToken(data.token) && versions !== null && at !== null ? { token: data.token, versions, at, retry: readFetchState(data.retry) } : null
}

// Anything unreadable counts as never connected: a connection is never assumed.
export function readConnection(raw: unknown): ConnectionRecord {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ConnectionRecord>
  const token = isToken(data.token) ? data.token : null
  const status = isStatus(data.status) ? data.status : 'none'

  return {
    // "Connected" without a usable token is not connected.
    status: status === 'connected' && token === null ? 'none' : status,
    token: status === 'connected' ? token : null,
    publicRef: status === 'connected' && isPublicRef(data.publicRef) ? data.publicRef : null,
    firstSeenAt: timeOrNull(data.firstSeenAt),
    lastContactAt: timeOrNull(data.lastContactAt),
    versions: readVersions(data.versions),
    at: timeOrNull(data.at),
    withdrawal: readWithdrawal(data.withdrawal),
    history: Array.isArray(data.history) ? data.history.slice(-MAX_HISTORY) : [],
  }
}

const noted = (record: ConnectionRecord, event: Exclude<Status, 'none'>, now: number) =>
  [...record.history, { event, wordingVersion: CONNECT_WORDING_VERSION, at: now }].slice(-MAX_HISTORY)

export const isConnected = (record: ConnectionRecord): record is ConnectionRecord & { token: string } => record.status === 'connected' && record.token !== null

export function connected(record: ConnectionRecord, reply: Connected, now: number): ConnectionRecord {
  return {
    ...record,
    status: 'connected',
    token: reply.token,
    publicRef: reply.publicRef,
    firstSeenAt: reply.firstSeenAt,
    lastContactAt: now,
    versions: CURRENT_VERSIONS,
    at: now,
    withdrawal: null,
    history: noted(record, 'connected', now),
  }
}

// Offers stop at once. The token moves into the waiting withdrawal, so nothing
// else can use it; the server is told when the undo time has passed.
export function disconnect(record: ConnectionRecord, now: number): ConnectionRecord {
  if (!isConnected(record)) {
    return record
  }

  return {
    ...record,
    status: 'withdrawn',
    token: null,
    withdrawal: { token: record.token, versions: record.versions ?? CURRENT_VERSIONS, at: now, retry: NEVER_FETCHED },
    history: noted(record, 'withdrawn', now),
  }
}

// Undo is possible only while the withdrawal has not been sent.
export const canUndo = (record: ConnectionRecord, now: number) => record.status === 'withdrawn' && record.withdrawal !== null && now - record.withdrawal.at < UNDO_MS && record.withdrawal.retry.lastAttemptAt === null

export function undoDisconnect(record: ConnectionRecord, now: number): ConnectionRecord {
  if (!canUndo(record, now) || record.withdrawal === null) {
    return record
  }

  // The original press still stands: nothing was sent, so nothing new is recorded.
  return { ...record, status: 'connected', token: record.withdrawal.token, withdrawal: null, history: record.history.slice(0, -1) }
}

export const undoSecondsLeft = (record: ConnectionRecord, now: number) => Math.max(1, Math.ceil((UNDO_MS - (now - (record.withdrawal?.at ?? now))) / 1000))

// True when the waiting withdrawal should be sent now.
export function isWithdrawalDue(record: ConnectionRecord, now: number): boolean {
  return record.withdrawal !== null && now - record.withdrawal.at >= UNDO_MS && isDue(record.withdrawal.retry, now)
}

// Marks an attempt before it is made, so two sessions do not both send.
export function withdrawalTried(record: ConnectionRecord, now: number, random: number): ConnectionRecord {
  return record.withdrawal === null ? record : { ...record, withdrawal: { ...record.withdrawal, retry: afterFailure(record.withdrawal.retry, now, random) } }
}

// The server has deleted the install (or never knew it): forget the rest.
export const withdrawalDone = (record: ConnectionRecord): ConnectionRecord => ({ ...record, token: null, publicRef: null, firstSeenAt: null, lastContactAt: null, withdrawal: null })

export const noteContact = (record: ConnectionRecord, now: number): ConnectionRecord => ({ ...record, lastContactAt: now })

export const isForgotten = (record: ConnectionRecord, now: number) => isConnected(record) && now - (record.lastContactAt ?? record.at ?? 0) > FORGOTTEN_AFTER_MS

// Back to never connected, with no call: there is nothing left to withdraw.
export const forget = (record: ConnectionRecord): ConnectionRecord => ({ ...withdrawalDone(record), status: 'none', versions: null })

// ---------------------------------------------------------------- codes

// A code received from the server, kept on this computer until its use-by date.
export type StoredCode = { claimId: string; campaignId: string; brand: string; text: string; code: string; useBy: number; claimedAt: number }

function readCode(item: any): StoredCode | undefined {
  const brand = checkText(item?.brand)
  const offerText = checkText(item?.text)
  const useBy = timeOrNull(item?.useBy)
  const isValid = isUuid(item?.claimId) && typeof item?.campaignId === 'string' && /^[a-z0-9-]{1,40}$/.test(item.campaignId) && typeof item?.code === 'string' && item.code.length <= 30 && CODE_FORMAT.test(item.code)

  return isValid && brand !== undefined && offerText !== undefined && useBy !== null ? { claimId: item.claimId, campaignId: item.campaignId, brand, text: offerText, code: item.code, useBy, claimedAt: timeOrNull(item?.claimedAt) ?? 0 } : undefined
}

// Reads the saved codes, dropping every one that is past its use-by date or
// does not look like a code. The saved record is as untrusted as the server.
export function readCodes(raw: unknown, now: number): StoredCode[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.slice(0, MAX_CODES).flatMap(item => {
    const code = readCode(item)

    return code !== undefined && code.useBy > now ? [code] : []
  })
}

// Adds a received code, or returns undefined to refuse it: a reply that repeats
// a code or a claim already held for another offer is a replay.
export function addCode(codes: readonly StoredCode[], offer: ServerOffer, claim: Claimed, now: number): StoredCode[] | undefined {
  const others = codes.filter(item => item.campaignId !== offer.campaign.id)

  if (others.some(item => item.claimId === claim.claimId || item.code === claim.code)) {
    return undefined
  }

  // The signed use-by date wins over a later one in the reply.
  const signed = parseIso(offer.campaign.useBy)
  const useBy = Number.isNaN(signed) ? claim.useBy : Math.min(claim.useBy, signed)

  return [{ claimId: claim.claimId, campaignId: offer.campaign.id, brand: offer.brand, text: offer.text, code: claim.code, useBy, claimedAt: now }, ...others].slice(0, MAX_CODES)
}

// What is drawn while a claimed code is hidden: every character masked except
// the last four, the dash kept. A code too short for that shows no part of it.
export function maskCode(code: string): string {
  const hidden = code.slice(0, -4)

  return hidden.replace(/-/g, '').length >= 4 ? hidden.replace(/[^-]/g, '•') + code.slice(-4) : code.replace(/[^-]/g, '•')
}

// The server gives one answer for sold out, too early, a daily limit and an
// install it no longer knows. "No codes left" is said only when this device's
// own schedule and counts rule the others out; otherwise the reason is unknown.
export const DAILY_CLAIM_LIMIT = 5
const CLOCK_MARGIN_MS = 2 * 60_000

export function canSayNoneLeft(offer: ServerOffer, codes: readonly StoredCode[], record: ConnectionRecord, now: number): boolean {
  const readyAt = Math.max(Date.parse(offer.campaign.opensAt), (record.firstSeenAt ?? now) + offer.campaign.minInstallAgeSeconds * 1000)
  const isWellOpen = now - readyAt >= CLOCK_MARGIN_MS && Date.parse(offer.campaign.claimBy) - now >= CLOCK_MARGIN_MS
  const claimedLately = codes.filter(item => now - item.claimedAt < 86_400_000).length
  const isKnown = isConnected(record) && !isForgotten(record, now)

  return isWellOpen && claimedLately < DAILY_CLAIM_LIMIT - 1 && isKnown
}

// ---------------------------------------------------------------- the list, now

export type OfferState = 'claimed' | 'open' | 'soon' | 'ended'

// What the device shows for an offer. Display only: the server decides, on its
// own clock, whether a code is really given.
export function offerState(offer: ServerOffer, codes: readonly StoredCode[], firstSeenAt: number | null, now: number): OfferState {
  if (codes.some(item => item.campaignId === offer.campaign.id)) {
    return 'claimed'
  }

  if (now >= Date.parse(offer.campaign.claimBy)) {
    return 'ended'
  }

  const readyAt = Math.max(Date.parse(offer.campaign.opensAt), (firstSeenAt ?? now) + offer.campaign.minInstallAgeSeconds * 1000)

  return now >= readyAt ? 'open' : 'soon'
}

export const isLive = (catalogue: Catalogue, now: number) => Date.parse(catalogue.expiresAt) > now

// ---------------------------------------------------------------- pop-ups

// Which pop-ups were shown today, and which offers have already been announced.
export type PopupRecord = { date: string; shown: Record<string, number>; seen: string[] }

export function readPopups(raw: unknown, now: number): PopupRecord {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<PopupRecord>
  const today = dayKey(now)
  const shown: Record<string, number> = {}

  if (data.date === today && typeof data.shown === 'object' && data.shown !== null) {
    for (const [id, count] of Object.entries(data.shown).slice(0, 20)) {
      if (/^[a-z0-9-]{1,40}$/.test(id) && Number.isInteger(count) && count > 0) {
        shown[id] = Math.min(count, 99)
      }
    }
  }

  return { date: today, shown, seen: Array.isArray(data.seen) ? data.seen.filter(item => typeof item === 'string' && item.length <= 40).slice(-400) : [] }
}

// Takes one showing of the first rule with this template that has any left
// today. The signed list sets how many; it never supplies the words.
export function takePopup(record: PopupRecord, rules: readonly PopupRule[], template: string): { record: PopupRecord; isAllowed: boolean } {
  const rule = rules.find(item => item.template === template && (Object.hasOwn(record.shown, item.id) ? record.shown[item.id] : 0) < item.maxPerDay)

  if (rule === undefined) {
    return { record, isAllowed: false }
  }

  return { record: { ...record, shown: { ...record.shown, [rule.id]: (Object.hasOwn(record.shown, rule.id) ? record.shown[rule.id] : 0) + 1 } }, isAllowed: true }
}

// Offers that have just become ready and were not announced before.
export function newlyOpen(record: PopupRecord, catalogue: Catalogue, codes: readonly StoredCode[], firstSeenAt: number | null, now: number): { record: PopupRecord; count: number } {
  const fresh = catalogue.offers.filter(offer => offerState(offer, codes, firstSeenAt, now) === 'open' && !record.seen.includes(offer.campaign.id)).map(offer => offer.campaign.id)

  return fresh.length === 0 ? { record, count: 0 } : { record: { ...record, seen: [...record.seen, ...fresh].slice(-400) }, count: fresh.length }
}
