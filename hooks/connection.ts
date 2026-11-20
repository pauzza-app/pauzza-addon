// The connection to the Pauzza server: its saved record, the codes received,
// and what the offer list means right now. Pure: every input is a saved record,
// the clock or a press. Kept apart from the acceptance record on purpose:
// accepting the Terms is never permission to use the network.

import type { Catalogue, PopupRule, ServerOffer, ServerOfferV2 } from './catalogue'
import { CODE_FORMAT, compareVersions, ID_FORMAT, parseIso, VERSION_FORMAT } from './catalogue'
import { CONNECT_PRIVACY_VERSION, CONNECT_TERMS_VERSION, CONNECT_WORDING_VERSION } from './connect-text'
import { UNDO_MS } from './consent'
import { afterFailure, isDue, NEVER_FETCHED, readFetchState } from './fetch-schedule'
import type { FetchState } from './fetch-schedule'
import { checkText } from './offers'
import { ADDON_VERSION, isPublicRef, isToken, isUuid, withdrawRequest } from './server'
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
  // True only on a withdrawn record whose withdrawal came from a change of the
  // accepted texts (`retireChangedTexts`), so the Connect card can say why it
  // is back. A yes or no about the texts: nothing about the person.
  textsChanged: boolean
  // The add-on version that made the Connect press, `x.y.z`; null when unknown
  // (0.20.2 did not save it). Tells an older press from one made by a newer
  // add-on running in another window.
  addonVersion: string | null
}

const readAddonVersion = (value: unknown) => (typeof value === 'string' && VERSION_FORMAT.test(value) ? value : null)

// (An earlier version also saved 'declined'; it now reads as never connected.)
const isStatus = (value: unknown): value is Status => value === 'none' || value === 'connected' || value === 'withdrawn'
const timeOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
const text = (value: unknown) => (typeof value === 'string' && value.length <= 40 ? value : '')

function readVersions(raw: unknown): Versions | null {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Versions>
  const versions = { wordingVersion: text(data.wordingVersion), termsVersion: text(data.termsVersion), privacyVersion: text(data.privacyVersion) }

  return Object.values(versions).every(item => item !== '') ? versions : null
}

// The versions a withdrawal carries. The server does not use them (it copies
// the install's own accepted versions), so any that the request could not
// carry are replaced by this version's: a withdrawal is never dropped for them.
const sendable = (token: string, versions: Versions | null): Versions => (versions !== null && withdrawRequest(token, versions) !== undefined ? versions : CURRENT_VERSIONS)

function readWithdrawal(raw: unknown): Withdrawal | null {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Withdrawal>
  const at = timeOrNull(data.at)

  return isToken(data.token) && at !== null ? { token: data.token, versions: sendable(data.token, readVersions(data.versions)), at, retry: readFetchState(data.retry) } : null
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
    textsChanged: status === 'withdrawn' && data.textsChanged === true,
    addonVersion: readAddonVersion(data.addonVersion),
  }
}

const noted = (record: ConnectionRecord, event: Exclude<Status, 'none'>, now: number, wordingVersion = CONNECT_WORDING_VERSION) =>
  [...record.history, { event, wordingVersion, at: now }].slice(-MAX_HISTORY)

// Were the wording, Terms and Privacy Policy of the saved Connect press the
// ones this version ships? Saved versions that cannot be read count as no:
// the press cannot be shown to cover these texts.
const areCurrentTexts = (versions: Versions | null) =>
  versions !== null &&
  versions.wordingVersion === CURRENT_VERSIONS.wordingVersion &&
  versions.termsVersion === CURRENT_VERSIONS.termsVersion &&
  versions.privacyVersion === CURRENT_VERSIONS.privacyVersion

export const hasCurrentTexts = (record: ConnectionRecord) => areCurrentTexts(record.versions)

// Made by a newer add-on under texts this version does not ship. A press with
// no known add-on version (0.20.2 saved none) counts as older.
const isNewerPress = (addonVersion: string | null, versions: Versions | null) =>
  addonVersion !== null && !areCurrentTexts(versions) && compareVersions(addonVersion, ADDON_VERSION) > 0

// A saved Connect press with a token, whatever texts it was made under.
const holdsToken = (record: ConnectionRecord): record is ConnectionRecord & { token: string } => record.status === 'connected' && record.token !== null

// Connected means a Connect press under the texts this version ships.
export const isConnected = (record: ConnectionRecord): record is ConnectionRecord & { token: string } => holdsToken(record) && hasCurrentTexts(record)

// A Connect press made under other texts by a NEWER add-on, running in another
// window while this one has not been reloaded. It is not this version's to
// judge: this window treats the person as not connected (no list, no claim, no
// Connect card) and says a newer Pauzza is out, but withdraws nothing and saves
// nothing, or it would delete the fresh install on every new Connect. A press
// with no saved add-on version (0.20.2) counts as older.
export const isFromNewerAddon = (record: ConnectionRecord) => holdsToken(record) && isNewerPress(record.addonVersion, record.versions)

// The accepted texts changed since a Connect press made by this version or an
// older one. The person is no longer connected: the old install is withdrawn
// at once, with no undo time and with its own token, and the Connect card asks
// again. Applied each time the record is loaded (`loadConnection`), so no
// caller ever sees the old token outside the waiting withdrawal. Any other
// record comes back unchanged.
export function retireChangedTexts(record: ConnectionRecord, now: number): ConnectionRecord {
  if (!holdsToken(record) || hasCurrentTexts(record) || isFromNewerAddon(record)) {
    return record
  }

  return {
    ...record,
    status: 'withdrawn',
    token: null,
    withdrawal: { token: record.token, versions: sendable(record.token, record.versions), at: now - UNDO_MS, retry: NEVER_FETCHED },
    history: noted(record, 'withdrawn', now, record.versions?.wordingVersion),
    textsChanged: true,
  }
}

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
    textsChanged: false,
    addonVersion: ADDON_VERSION,
  }
}

// Offers stop at once. The token moves into the waiting withdrawal, so nothing
// else can use it; the server is told when the undo time has passed. Also for
// a press made by a newer add-on in another window: switching off, or deleting
// saved data, is the person's own request.
export function disconnect(record: ConnectionRecord, now: number): ConnectionRecord {
  if (!holdsToken(record)) {
    return record
  }

  return {
    ...record,
    status: 'withdrawn',
    token: null,
    withdrawal: { token: record.token, versions: sendable(record.token, record.versions), at: now, retry: NEVER_FETCHED },
    history: noted(record, 'withdrawn', now),
  }
}

// Undo is possible only while the withdrawal has not been sent.
// A withdrawal caused by changed texts has no undo, whatever the clock says.
export const canUndo = (record: ConnectionRecord, now: number) => record.status === 'withdrawn' && !record.textsChanged && record.withdrawal !== null && now - record.withdrawal.at < UNDO_MS && record.withdrawal.retry.lastAttemptAt === null

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

// The Connect press a code was claimed under: the add-on version that made it
// (null when unknown) and its three text versions. It tells this version's
// test codes from codes claimed under a newer add-on's connection in another
// window. Codes saved before this mark existed count as this version's.
export type ClaimedUnder = Versions & { addonVersion: string | null }

// A code received from the server, kept on this computer until its use-by date.
export type StoredCode = { claimId: string; campaignId: string; brand: string; text: string; code: string; useBy: number; claimedAt: number; claimedUnder?: ClaimedUnder }

function readClaimedUnder(raw: unknown): ClaimedUnder | undefined {
  const versions = readVersions(raw)

  return versions === null ? undefined : { ...versions, addonVersion: readAddonVersion((raw as Partial<ClaimedUnder>).addonVersion) }
}

export const claimedUnder = (record: ConnectionRecord): ClaimedUnder | undefined => (record.versions === null ? undefined : { ...record.versions, addonVersion: record.addonVersion })

// A saved code claimed under a newer add-on's connection, under texts this
// version does not ship. This version never reads, shows, changes or deletes
// one: that is the newer add-on's job, and its own test end is not this one's.
export function isNewerCode(item: unknown): boolean {
  const under = readClaimedUnder(typeof item === 'object' && item !== null ? (item as { claimedUnder?: unknown }).claimedUnder : undefined)

  return under !== undefined && isNewerPress(under.addonVersion, under)
}

function readCode(item: any): StoredCode | undefined {
  const brand = checkText(item?.brand)
  const offerText = checkText(item?.text)
  const useBy = timeOrNull(item?.useBy)
  const under = readClaimedUnder(item?.claimedUnder)
  const isValid = isUuid(item?.claimId) && typeof item?.campaignId === 'string' && ID_FORMAT.test(item.campaignId) && typeof item?.code === 'string' && item.code.length <= 30 && CODE_FORMAT.test(item.code)

  return isValid && brand !== undefined && offerText !== undefined && useBy !== null
    ? { claimId: item.claimId, campaignId: item.campaignId, brand, text: offerText, code: item.code, useBy, claimedAt: timeOrNull(item?.claimedAt) ?? 0, ...(under === undefined ? {} : { claimedUnder: under }) }
    : undefined
}

// Reads this version's saved codes, dropping every one that is past its use-by
// date or does not look like a code. The saved record is as untrusted as the
// server. Codes from a newer add-on's connection are left out.
export function readCodes(raw: unknown, now: number): StoredCode[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter(item => !isNewerCode(item)).slice(0, MAX_CODES).flatMap(item => {
    const code = readCode(item)

    return code !== undefined && code.useBy > now ? [code] : []
  })
}

// The saved codes a newer add-on's connection owns, exactly as saved.
export const newerCodes = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw.filter(isNewerCode).slice(0, MAX_CODES) : [])

// What the saved list of codes should hold now: this version's codes still
// within their use-by date (none once its test is over), and a newer add-on's
// codes untouched.
export const codesToKeep = (raw: unknown, now: number, isOver: boolean): unknown[] => [...(isOver ? [] : readCodes(raw, now)), ...newerCodes(raw)]

// Adds a received code, or returns undefined to refuse it: a reply that repeats
// a code or a claim already held for another offer is a replay. `under` marks
// the connection it was claimed under.
export function addCode(codes: readonly StoredCode[], offer: ServerOffer, claim: Claimed, now: number, under?: ClaimedUnder): StoredCode[] | undefined {
  const others = codes.filter(item => item.campaignId !== offer.campaign.id)

  if (others.some(item => item.claimId === claim.claimId || item.code === claim.code)) {
    return undefined
  }

  // The signed use-by date wins over a later one in the reply.
  const signed = parseIso(offer.campaign.useBy)
  const useBy = Number.isNaN(signed) ? claim.useBy : Math.min(claim.useBy, signed)

  return [{ claimId: claim.claimId, campaignId: offer.campaign.id, brand: offer.brand, text: offer.text, code: claim.code, useBy, claimedAt: now, ...(under === undefined ? {} : { claimedUnder: under }) }, ...others].slice(0, MAX_CODES)
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

// Which pop-ups were shown today, which offers have already been announced,
// which campaigns (events) had their start pop-up, the list number whose news
// pop-up was shown, which limit-prize periods had their pop-up, and whether a
// "new offer" pop-up is still owed today (one pop-up shows per refresh; a
// waiting one is not lost, and is recorded only when shown).
export type PopupRecord = { date: string; shown: Record<string, number>; seen: string[]; events: string[]; newsSeq: number | null; limits: string[]; offerDue: boolean }

export function readPopups(raw: unknown, now: number): PopupRecord {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<PopupRecord>
  const today = dayKey(now)
  const shown: Record<string, number> = {}

  if (data.date === today && typeof data.shown === 'object' && data.shown !== null) {
    for (const [id, count] of Object.entries(data.shown).slice(0, 20)) {
      if (ID_FORMAT.test(id) && Number.isInteger(count) && count > 0) {
        shown[id] = Math.min(count, 99)
      }
    }
  }

  return {
    date: today,
    shown,
    seen: Array.isArray(data.seen) ? data.seen.filter(item => typeof item === 'string' && item.length <= 40).slice(-400) : [],
    events: Array.isArray(data.events) ? data.events.filter(item => typeof item === 'string' && ID_FORMAT.test(item)).slice(-20) : [],
    newsSeq: Number.isSafeInteger(data.newsSeq) && (data.newsSeq as number) > 0 ? (data.newsSeq as number) : null,
    limits: Array.isArray(data.limits) ? data.limits.filter(item => typeof item === 'string' && /^limit-(5h:\d{4}-\d{2}-\d{2}|week:\d{1,16})$/.test(item)).slice(-10) : [],
    // Owed for today only: a new day forgets it.
    offerDue: data.date === today && data.offerDue === true,
  }
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

// Where a format 2 offer shows; undefined is the offer list.
export const slotOf = (offer: ServerOffer) => (offer as ServerOfferV2).slot

// The offers "A new offer is open" may announce: normal, daily and campaign
// offers. Never a limit prize or a present: those have their own moments.
export const isAnnounced = (offer: ServerOffer) => slotOf(offer) === undefined || slotOf(offer) === 'daily'

// Offers that have just become ready and were not announced before. Only the
// kinds `which` names count; by default, those `isAnnounced` allows.
export function newlyOpen(record: PopupRecord, catalogue: Catalogue, codes: readonly StoredCode[], firstSeenAt: number | null, now: number, which: (offer: ServerOffer) => boolean = isAnnounced): { record: PopupRecord; count: number } {
  const fresh = catalogue.offers.filter(offer => which(offer) && offerState(offer, codes, firstSeenAt, now) === 'open' && !record.seen.includes(offer.campaign.id)).map(offer => offer.campaign.id)

  return fresh.length === 0 ? { record, count: 0 } : { record: { ...record, seen: [...record.seen, ...fresh].slice(-400) }, count: fresh.length }
}
