// The acceptance step. Pure: every input is the saved record, the clock or a
// press in the panel. Kept apart from the prizes record, so deleting saved data
// does not count as an answer. The record stays on this computer.

import { CONSENT_TEXT, TERMS_EFFECTIVE, TERMS_VERSION, WORDING_VERSION } from './consent-text'

export const UNDO_MS = 10_000
const INVITE_DAYS_MS = 7 * 24 * 60 * 60_000
const MAX_HISTORY = 50

type Status = 'none' | 'given' | 'declined' | 'withdrawn'
type Terms = { version: string; effective: string }

export type ConsentRecord = {
  status: Status
  wordingVersion: string | null
  termsVersion: string | null
  at: number | null
  inviteFirstSeen: number | null
  dismissedTermsVersion: string | null
  deletePending: boolean
  history: { event: Exclude<Status, 'none'>; wordingVersion: string; termsVersion: string; at: number }[]
}

export type ConsentView = 'ask' | 'declined' | 'withdrawn' | 'active' | 'update-notice' | 'update-required'

const CURRENT: Terms = { version: TERMS_VERSION, effective: TERMS_EFFECTIVE }
const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null)
const numberOrNull = (value: unknown) => (typeof value === 'number' ? value : null)
const isStatus = (value: unknown): value is Status => value === 'none' || value === 'given' || value === 'declined' || value === 'withdrawn'

// Anything unreadable counts as never asked: acceptance is never assumed.
export function readConsent(raw: unknown): ConsentRecord {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ConsentRecord>

  return {
    status: isStatus(data.status) ? data.status : 'none',
    wordingVersion: textOrNull(data.wordingVersion),
    termsVersion: textOrNull(data.termsVersion),
    at: numberOrNull(data.at),
    inviteFirstSeen: numberOrNull(data.inviteFirstSeen),
    dismissedTermsVersion: textOrNull(data.dismissedTermsVersion),
    deletePending: data.deletePending === true,
    history: Array.isArray(data.history) ? data.history : [],
  }
}

function localMidnight(date: string): number {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(year, month - 1, day).getTime()
}

export function viewOf(record: ConsentRecord, now: number, terms: Terms = CURRENT): ConsentView {
  if (record.status === 'none') {
    return 'ask'
  }

  if (record.status !== 'given') {
    return record.status
  }

  if (record.termsVersion === terms.version) {
    return 'active'
  }

  return now < localMidnight(terms.effective) ? 'update-notice' : 'update-required'
}

// Only these two may read usage, count, or show anything from the catalogue.
export const isRunning = (view: ConsentView) => view === 'active' || view === 'update-notice'

function changed(record: ConsentRecord, status: Exclude<Status, 'none'>, now: number, terms: Terms, extra: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    ...record,
    status,
    at: now,
    wordingVersion: WORDING_VERSION,
    termsVersion: status === 'given' ? terms.version : record.termsVersion,
    history: [...record.history, { event: status, wordingVersion: WORDING_VERSION, termsVersion: terms.version, at: now }].slice(-MAX_HISTORY),
    ...extra,
  }
}

export const accept = (record: ConsentRecord, now: number, terms: Terms = CURRENT) => changed(record, 'given', now, terms, { dismissedTermsVersion: null, deletePending: false })
export const decline = (record: ConsentRecord, now: number, terms: Terms = CURRENT) => changed(record, 'declined', now, terms)
// The record keeps the Terms and wording versions of the acceptance it ends,
// so that its Undo can bring back exactly that acceptance.
export const withdraw = (record: ConsentRecord, now: number, terms: Terms = CURRENT) => changed(record, 'withdrawn', now, terms, { deletePending: true, wordingVersion: record.wordingVersion ?? WORDING_VERSION })

// The Undo of "Pauzza is on", inside its undo time: the acceptance that was
// withdrawn comes back exactly, with its own Terms and wording versions. It is
// never an acceptance of the current texts: only the Connect press gives that.
// So an earlier Terms version stays earlier, and is still asked again.
export function undoWithdraw(record: ConsentRecord, now: number): ConsentRecord {
  if (record.status !== 'withdrawn' || !record.deletePending || record.termsVersion === null || record.wordingVersion === null || shouldDelete(record, now)) {
    return record
  }

  const { termsVersion, wordingVersion } = record

  return {
    ...record,
    status: 'given',
    at: now,
    deletePending: false,
    history: [...record.history, { event: 'given' as const, wordingVersion, termsVersion, at: now }].slice(-MAX_HISTORY),
  }
}
export const dismissUpdate = (record: ConsentRecord, terms: Terms = CURRENT): ConsentRecord => ({ ...record, dismissedTermsVersion: terms.version })
export const noteInviteSeen = (record: ConsentRecord, now: number): ConsentRecord => (record.inviteFirstSeen === null ? { ...record, inviteFirstSeen: now } : record)
export const shouldDelete = (record: ConsentRecord, now: number) => record.deletePending && record.at !== null && now - record.at >= UNDO_MS
export const finishDelete = (record: ConsentRecord): ConsentRecord => ({ ...record, deletePending: false })
export const undoSecondsLeft = (record: ConsentRecord, now: number) => Math.max(1, Math.ceil((UNDO_MS - (now - (record.at ?? now))) / 1000))

// What the line under the chat box must say instead of the meter, or null for
// the usual line.
export function consentLine(view: ConsentView, record: ConsentRecord, now: number, terms: Terms = CURRENT): { line: string | undefined } | null {
  const isDismissed = record.dismissedTermsVersion === terms.version

  switch (view) {
    case 'active':
      return null
    case 'ask':
      return { line: record.inviteFirstSeen === null || now - record.inviteFirstSeen < INVITE_DAYS_MS ? CONSENT_TEXT.invite : undefined }
    case 'update-notice':
      return isDismissed ? null : { line: CONSENT_TEXT.updateLine }
    case 'update-required':
      return { line: isDismissed ? undefined : CONSENT_TEXT.updateLine }
    default:
      return { line: undefined }
  }
}
