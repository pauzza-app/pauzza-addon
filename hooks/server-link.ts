// Every network call the add-on makes, and the records they keep. This is the
// only file that touches the network, and `send` is the only function in it
// that does.
//
// The rules, each enforced here and proven by a test:
// - Before the Connect press, nothing is sent: not even the offer list.
// - Accepting the Terms is not permission to connect. Only the saved record of
//   a Connect press is. (Since 2026-11-19 one press does both: the panel saves
//   the acceptance, then calls `connectNow`.)
// - The offer list is fetched on the schedule in `fetch-schedule.ts`, or on
//   the person's own "Try now" or "Check now" press (one shared limit: at most
//   once per 30 seconds): never from a redraw, a status refresh or at a set
//   time of day.
// - A token is sent only on a press (Get code) and on withdrawal.
// - A waiting withdrawal goes before any other call.
// - Any reply that is slow, failed, too large or not exactly as expected counts
//   as no reply, silently.

import type { EngineInterface } from 'claude-code'

import { acceptCatalogue, ID_FORMAT, MAX_ENVELOPE_BYTES } from './catalogue'
import type { Catalogue, PinnedKeys, ServerOffer } from './catalogue'
import { canOfferConnect, isTestOver, setTestEndDate } from './connect-text'
import {
  addCode,
  canSayNoneLeft,
  canUndo,
  claimedUnder,
  codesToKeep,
  connected,
  CURRENT_VERSIONS,
  disconnect,
  forget,
  isConnected,
  isForgotten,
  isFromNewerAddon,
  isLive,
  isWithdrawalDue,
  newerCodes,
  noteContact,
  offerState,
  readCodes,
  readConnection,
  retireChangedTexts,
  undoDisconnect,
  withdrawalDone,
  withdrawalTried,
} from './connection'
import type { ConnectionRecord, StoredCode } from './connection'
import { isRunning, readConsent, UNDO_MS, viewOf } from './consent'
import { afterFailure, afterSuccess, isDue, readFetchState } from './fetch-schedule'
import { ADDON_VERSION, BASE_URL, catalogueRequest, claimRequest, connectRequest, isWithdrawn, MAX_REPLY_CHARS, parseClaim, parseConnect, TIMEOUT_MS, withdrawRequest } from './server'
import type { Outgoing, Reply } from './server'

export const CONNECTION_KEY = 'connection'
export const CODES_KEY = 'codes'
export const CATALOGUE_KEY = 'catalogue'
export const FETCH_KEY = 'fetch'
export const POPUPS_KEY = 'serverPopups'
// When the person last pressed "Try now" or "Check now" on this computer: a
// time only, shared by every session, so a press in another window counts too.
// Nothing is sent.
export const MANUAL_TRY_KEY = 'manualTry'
// At most one "Try now" or "Check now" fetch per 30 seconds on this computer.
export const MANUAL_GAP_MS = 30_000
// The highest format 2 list number this computer has accepted: one whole
// number, the same for everyone who received that list, so it says nothing
// about the person. It outlasts a disconnect, so a list older than one already
// seen is never taken again, even after connecting anew (finding 7 of the
// 2026-11-12 review); the list with this very number is still taken. Only
// "Delete saved data" removes it (register.tsx).
export const LIST_FLOOR_KEY = 'listFloor'
// Offers the server answered "none left" for on this computer, with the list
// number they were learned under: { seq, at: { campaignId: time } }. Kept for
// NONE_LEFT_MS, so the row stays "No codes left" without another press. A newer
// list number, "Check now", a disconnect and "Delete saved data" clear it.
// Nothing is sent: it stays on this computer, like the claimed codes.
export const NONE_LEFT_KEY = 'noneLeft'
export const NONE_LEFT_MS = 3 * 3_600_000
const NONE_LEFT_MAX = 200
const CONSENT_KEY = 'consent'
// How often a session looks at the shared schedule. Looking sends nothing.
export const TICK_MS = 5 * 60_000

type Held = { text: string; seq: number; catalogue: Catalogue; showOffers: boolean }
// What the offer drawers should show.
export type ServerView =
  | { kind: 'local' } // not connected, nothing received yet, or the last list is past its date: the built-in samples
  | { kind: 'paused' } // connected, but this version is older than the signed list allows
  | { kind: 'live'; catalogue: Catalogue }

export type ClaimNote = 'getting' | 'none-left' | 'unavailable' | 'offline'
export type ConnectNote = 'connecting' | 'failed' | 'connected'
export type DisconnectNote = 'done'
// After a "Try now" press: under way, too soon after the last one, or no answer.
export type TryNote = 'trying' | 'wait' | 'failed'
// After a "Check now" press in Settings: the same, and for a good answer
// whether it held the list already shown ('same') or a newer one ('new').
export type CheckNote = 'checking' | 'wait' | 'failed' | 'same' | 'new'
// Which button was pressed: "Try now" on the main screen, "Check now" in Settings.
export type ManualPress = 'try' | 'check'

// Forgotten when the session ends.
// The public keys this release trusts for the signed offer list (the active key
// and the offline backup), read from the add-on's own `release.json`. Public
// keys only: the private keys stay with the owner. While there are none, every
// list from the server is refused and the built-in samples stay.
let pinnedKeys: PinnedKeys = {}
let release: Promise<void> | undefined
let held: Held | undefined
let heldFrom: string | undefined
let work: Promise<unknown> = Promise.resolve()
let connectNote: ConnectNote | undefined
let disconnectNote: DisconnectNote | undefined
let tryNote: TryNote | undefined
// Kept apart from `tryNote`, so neither screen shows the other's line.
let checkNote: CheckNote | undefined
const claimNotes = new Map<string, { note: ClaimNote; at: number }>()
// How long "not available" stays on a row before the button comes back.
const NOTE_MS = 15 * 60_000

function readKeys(raw: unknown): PinnedKeys {
  const keys: PinnedKeys = {}

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [id, key] of Object.entries(raw).slice(0, 4)) {
      if (/^[a-z0-9-]{1,20}$/.test(id) && typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key)) {
        keys[id] = key
      }
    }
  }

  return keys
}

// Reads the two values fixed in the release: the day the test ends (none for
// Stage B) and the trusted public keys. They travel with the add-on's own
// files, like its code; nothing the server, the saved records or a setting
// supplies reaches them. A file that cannot be read, or is not an object,
// offers no Connect at all (an end date left out of a good file means none).
export function loadRelease($: EngineInterface): Promise<void> {
  release ??= (async () => {
    try {
      const data = JSON.parse(await $.fs.read(`${$.plugin.root}/release.json`))

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('release.json is not an object')
      }

      setTestEndDate(data.testEndDate)
      pinnedKeys = readKeys(data.catalogueKeys)
    } catch {
      setTestEndDate(null)
      pinnedKeys = {}
    }
  })()

  return release
}

export const currentConnectNote = () => connectNote
export const currentDisconnectNote = () => disconnectNote
export const currentTryNote = () => tryNote
export const currentCheckNote = () => checkNote

// The "Check now" note goes when Settings is opened afresh, unless a check is under way.
export function clearCheckNote() {
  if (checkNote !== 'checking') {
    checkNote = undefined
  }
}

// The one-time notes go when the panel closes.
export function clearOnceNotes() {
  if (connectNote !== 'connecting') {
    connectNote = undefined
  }

  disconnectNote = undefined

  if (tryNote !== 'trying') {
    tryNote = undefined
  }

  clearCheckNote()
}

export function claimNote(campaignId: string, now: number): ClaimNote | undefined {
  const entry = claimNotes.get(campaignId)

  return entry !== undefined && (entry.note === 'getting' || now - entry.at < NOTE_MS) ? entry.note : undefined
}

// ---------------------------------------------------------------- "No codes left", remembered

export type NoneLeft = { seq: number; at: Record<string, number> }
let noneLeft: NoneLeft = { seq: 0, at: {} }

// A saved value read back: a positive list number and up to NONE_LEFT_MAX
// offer ids with a time each. Anything else is an empty record.
export function readNoneLeft(raw: unknown): NoneLeft {
  const empty: NoneLeft = { seq: 0, at: {} }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return empty
  }

  const { seq, at } = raw as { seq?: unknown; at?: unknown }

  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || typeof at !== 'object' || at === null || Array.isArray(at)) {
    return empty
  }

  const kept: Record<string, number> = {}

  for (const [id, time] of Object.entries(at).slice(0, NONE_LEFT_MAX)) {
    if (ID_FORMAT.test(id) && typeof time === 'number' && Number.isFinite(time)) {
      kept[id] = time
    }
  }

  return { seq, at: kept }
}

// Called by every status refresh (register.tsx), like the codes and the connection.
export async function loadNoneLeft($: EngineInterface): Promise<void> {
  noneLeft = readNoneLeft(await $.store.get(NONE_LEFT_KEY))
}

// Whether this offer was answered "none left" lately, under the list now in hand.
// A time ahead of the clock (a clock turned back) does not count.
export function isNoneLeftRemembered(campaignId: string, now: number): boolean {
  const at = Object.hasOwn(noneLeft.at, campaignId) ? noneLeft.at[campaignId] : undefined

  return held !== undefined && noneLeft.seq === held.seq && at !== undefined && now >= at && now - at < NONE_LEFT_MS
}

async function saveNoneLeft($: EngineInterface, next: NoneLeft): Promise<void> {
  noneLeft = next

  if (Object.keys(next.at).length === 0) {
    await $.store.delete(NONE_LEFT_KEY)
  } else {
    await $.store.set(NONE_LEFT_KEY, next)
  }
}

// One offer's answer: remembered under the list in hand, or forgotten. Entries
// from an older list or past NONE_LEFT_MS are dropped on the way.
async function noteNoneLeft($: EngineInterface, campaignId: string, isNoneLeft: boolean, now: number): Promise<void> {
  const seq = held?.seq

  if (seq === undefined) {
    return
  }

  const stored = readNoneLeft(await $.store.get(NONE_LEFT_KEY))
  const at = Object.fromEntries(Object.entries(stored.seq === seq ? stored.at : {}).filter(([id, time]) => id !== campaignId && now >= time && now - time < NONE_LEFT_MS))

  if (isNoneLeft && Object.keys(at).length < NONE_LEFT_MAX) {
    at[campaignId] = now
  }

  await saveNoneLeft($, { seq, at })
}

async function forgetNoneLeft($: EngineInterface): Promise<void> {
  noneLeft = { seq: 0, at: {} }
  await $.store.delete(NONE_LEFT_KEY)
}

// THE ONLY NETWORK CALL IN THE ADD-ON. The address must begin with the one
// built-in address, and nothing from a reply is ever fetched.
async function send($: EngineInterface, request: Outgoing, maxChars: number): Promise<Reply | undefined> {
  if (!request.url.startsWith(BASE_URL)) {
    return undefined
  }

  try {
    const reply = await new Promise<any>(resolve => {
      const timer = $.clock.after(TIMEOUT_MS, () => resolve(undefined))
      const done = (value: unknown) => {
        timer.cancel()
        resolve(value)
      }

      $.http.fetch(request.url, { method: request.method, headers: request.headers, ...(request.body === undefined ? {} : { body: request.body }) }).then(done, () => done(undefined))
    })

    if (typeof reply !== 'object' || reply === null || !Number.isInteger(reply.status) || typeof reply.text !== 'string') {
      return undefined
    }

    // Something answered, but with more than could be ours: an answer no caller accepts.
    if (reply.text.length > maxChars) {
      return { status: 0, text: '', headers: {} }
    }

    const headers = typeof reply.headers === 'object' && reply.headers !== null ? reply.headers : {}

    return { status: reply.status, text: reply.text, headers }
  } catch {
    return undefined
  }
}

// One piece of network work at a time in a session.
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = work.then(job, job)
  work = next.catch(() => undefined)

  return next
}

// Every reader of the connection comes through here, so a Connect press made
// under other texts than this version ships never reads as connected: its
// token is already in a waiting withdrawal. Reading saves nothing and sends
// nothing; `networkTick` saves the change and sends the withdrawal.
export async function loadConnection($: EngineInterface): Promise<ConnectionRecord> {
  return retireChangedTexts(readConnection(await $.store.get(CONNECTION_KEY)), await $.clock.now())
}

export async function loadCodes($: EngineInterface, now: number): Promise<StoredCode[]> {
  return isTestOver(now) ? [] : readCodes(await $.store.get(CODES_KEY), now)
}

// Deletes every code past its use-by date from the saved record. When the test
// is over, its codes go too. Codes claimed under a newer add-on's connection in
// another window are kept exactly as they are, at any time: they are not this
// version's test codes.
export async function pruneCodes($: EngineInterface, now: number): Promise<StoredCode[]> {
  const raw = await $.store.get(CODES_KEY)
  const isOver = isTestOver(now)
  const kept = codesToKeep(raw, now, isOver)

  if (raw !== undefined && raw !== null && (!Array.isArray(raw) || raw.length !== kept.length)) {
    if (kept.length === 0) {
      await $.store.delete(CODES_KEY)
    } else {
      await $.store.set(CODES_KEY, kept)
    }
  }

  return isOver ? [] : readCodes(raw, now)
}

async function isAccepted($: EngineInterface, now: number): Promise<boolean> {
  return isRunning(viewOf(readConsent(await $.store.get(CONSENT_KEY)), now))
}

// The saved list is checked again before it is believed: the saved record is
// trusted no more than the server.
async function holdSaved($: EngineInterface, now: number) {
  const raw = (await $.store.get(CATALOGUE_KEY)) as { text?: unknown } | undefined
  const text = typeof raw?.text === 'string' ? raw.text : undefined

  if (text === heldFrom) {
    return
  }

  heldFrom = text
  held = undefined

  if (text === undefined) {
    return
  }

  // Format 2 only. A format 1 list saved by 0.20.2 is refused here, and the
  // add-on shows no offers until the next list arrives.
  const checked = await acceptCatalogue(text, { pinnedKeys, lastSeq: 0, now, addonVersion: ADDON_VERSION, format: 2 })

  if (checked.ok) {
    held = { text, seq: checked.catalogue.seq, catalogue: checked.catalogue, showOffers: checked.showOffers }
  }
}

// What to show now. Reads memory only: no store, no network. The last good
// signed list is shown until its own end date (14 days at most), then the
// built-in samples.
export function serverView(connection: ConnectionRecord, now: number): ServerView {
  if (!isConnected(connection) || held === undefined || !isLive(held.catalogue, now) || isTestOver(now)) {
    return { kind: 'local' }
  }

  return held.showOffers ? { kind: 'live', catalogue: held.catalogue } : { kind: 'paused' }
}

// The newest add-on version the signed list names, while a format 2 list is
// held and in date, even when its minimum version hides the offers. Reads
// memory only. It is a version number, never words: the hint is built in.
export function signedLatestVersion(connection: ConnectionRecord, now: number): string | undefined {
  if (!isConnected(connection) || held === undefined || !isLive(held.catalogue, now) || isTestOver(now) || held.catalogue.v !== 2) {
    return undefined
  }

  return held.catalogue.latestAddonVersion
}

// True while the last try to fetch the list failed.
export async function isUnreachable($: EngineInterface): Promise<boolean> {
  return readFetchState(await $.store.get(FETCH_KEY)).failures > 0
}

// The saved highest list number, or 0 for anything but a positive whole number.
export const readListFloor = (raw: unknown): number => (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : 0)

// Everything the server sent, after a disconnect. The highest list number
// (LIST_FLOOR_KEY) stays: it is not about the person.
async function forgetServerData($: EngineInterface) {
  await $.store.delete(CATALOGUE_KEY)
  await $.store.delete(FETCH_KEY)
  await $.store.delete(POPUPS_KEY)
  await $.store.delete(MANUAL_TRY_KEY)
  await forgetNoneLeft($)
  held = undefined
  heldFrom = undefined
  claimNotes.clear()
}

async function sendWithdrawal($: EngineInterface, isForced: boolean): Promise<boolean> {
  const now = await $.clock.now()
  const record = await loadConnection($)

  if (record.withdrawal === null) {
    return true
  }

  if (!isForced && !isWithdrawalDue(record, now)) {
    return false
  }

  const request = withdrawRequest(record.withdrawal.token, record.withdrawal.versions)
  await $.store.set(CONNECTION_KEY, withdrawalTried(record, now, Math.random()))
  const reply = request === undefined ? undefined : await send($, request, MAX_REPLY_CHARS)

  // (A withdrawal that cannot even be built can never be sent: it is dropped.)
  if (request !== undefined && (reply === undefined || !isWithdrawn(reply))) {
    $.ui.invalidate('ui.render')

    return false
  }

  const after = await loadConnection($)

  if (after.withdrawal?.token === record.withdrawal.token) {
    await $.store.set(CONNECTION_KEY, withdrawalDone(after))
    await forgetServerData($)
    disconnectNote = 'done'
  }

  $.ui.invalidate('ui.render')

  return true
}

// Fetches the signed list when the schedule says it is due. With `isManual`
// (only from the person's own "Try now" or "Check now" press) it fetches now, whatever the
// schedule says, and a failure leaves the schedule exactly as it was: the
// automatic waits are neither reset nor shortened. A success clears them, as
// any success does. Says whether a good list is now in hand.
async function fetchCatalogue($: EngineInterface, isManual = false): Promise<boolean> {
  const now = await $.clock.now()
  const record = await loadConnection($)

  if (!isConnected(record) || !(await isAccepted($, now)) || isTestOver(now)) {
    return false
  }

  // The server has forgotten this install by now: stop, and ask again.
  if (isForgotten(record, now)) {
    await $.store.set(CONNECTION_KEY, forget(record))
    await forgetServerData($)
    $.ui.invalidate('ui.render')

    return false
  }

  await holdSaved($, now)
  const state = readFetchState(await $.store.get(FETCH_KEY))

  if (!isManual && !isDue(state, now)) {
    return false
  }

  // Written before the call, so another session does not fetch as well, and a
  // call that never returns still backs off. A manual try writes nothing here.
  if (!isManual) {
    await $.store.set(FETCH_KEY, afterFailure(state, now, Math.random()))
  }

  // No If-None-Match is sent, so a 304 answers nothing that was asked: like any
  // other unexpected reply, it counts as no reply.
  const reply = await send($, catalogueRequest(), MAX_ENVELOPE_BYTES)
  let isGood = reply !== undefined && held !== undefined && reply.status === 200 && reply.text === held.text

  if (!isGood && reply !== undefined && reply.status === 200) {
    const saved = (await $.store.get(CATALOGUE_KEY)) as { seq?: unknown; format?: unknown } | undefined
    // Each format counts its own list numbers, so a number saved by 0.20.2
    // (format 1, with no format noted) says nothing about format 2.
    const savedSeq = saved?.format === 2 && Number.isSafeInteger(saved?.seq) ? (saved.seq as number) : 0
    // The highest number ever accepted here counts too, so a disconnect does
    // not let an older signed list back in. It counts inclusively (one below it
    // is the last refused number): after switching off, or the 12-month forget,
    // a new Connect gets the list the server still serves, which is that same
    // list, and it must be taken again. acceptCatalogue itself is unchanged: it
    // mirrors the server's check.
    const lastSeq = Math.max(held?.seq ?? 0, savedSeq, readListFloor(await $.store.get(LIST_FLOOR_KEY)) - 1)
    const checked = await acceptCatalogue(reply.text, { pinnedKeys, lastSeq, now: await $.clock.now(), addonVersion: ADDON_VERSION, format: 2 })

    // Still connected? The person may have switched off while this was under way.
    if (checked.ok && isConnected(await loadConnection($))) {
      await $.store.set(CATALOGUE_KEY, { text: reply.text, seq: checked.catalogue.seq, format: 2 })
      held = { text: reply.text, seq: checked.catalogue.seq, catalogue: checked.catalogue, showOffers: checked.showOffers }
      heldFrom = reply.text
      isGood = true
    }
  }

  if (isGood && isConnected(await loadConnection($))) {
    await $.store.set(FETCH_KEY, afterSuccess(await $.clock.now(), Math.random()))

    // Raised, never lowered: also for a list already held from before this was kept.
    if (held !== undefined && held.seq > readListFloor(await $.store.get(LIST_FLOOR_KEY))) {
      await $.store.set(LIST_FLOOR_KEY, held.seq)
    }

    // A note from an earlier press must not come back with a later failure.
    if (tryNote !== 'trying') {
      tryNote = undefined
    }

    clearCheckNote()
  }

  $.ui.invalidate('ui.render')

  return isGood
}

// The person pressed "Try now" (main screen, while the server could not be
// reached) or "Check now" (Settings, while connected). One fetch of the signed
// list at once, through `send` and the same checks, at most once per 30
// seconds on this computer, whichever of the two was pressed. Called only from
// those presses: never from a hook, a timer or a pop-up. Each button keeps its
// own note; nothing new is saved.
export function tryNow($: EngineInterface, from: ManualPress = 'try'): Promise<void> {
  const isCheck = from === 'check'

  if (isCheck ? checkNote === 'checking' : tryNote === 'trying') {
    return work.then(() => undefined)
  }

  if (isCheck) {
    checkNote = 'checking'
  } else {
    tryNote = 'trying'
  }

  $.ui.invalidate('ui.render')

  return inTurn(async () => {
    let note: Exclude<CheckNote, 'checking'> | undefined = 'failed'

    try {
      const now = await $.clock.now()

      // "Check now" forgets which offers had none left, so each can be tried afresh at once: the saved
      // record and the one-time notes. Even a press too soon after the last does this (it sends nothing).
      if (isCheck) {
        await forgetNoneLeft($)

        for (const [id, entry] of claimNotes) {
          if (entry.note === 'none-left') {
            claimNotes.delete(id)
          }
        }
      }

      const last = await $.store.get(MANUAL_TRY_KEY)
      // A time set ahead by a clock that was later turned back does not block for good.
      const isTooSoon = typeof last === 'number' && Number.isFinite(last) && now >= last && now - last < MANUAL_GAP_MS

      if (isTooSoon) {
        note = 'wait'

        return
      }

      if (!isConnected(await loadConnection($))) {
        note = undefined

        return
      }

      await loadRelease($)
      await $.store.set(MANUAL_TRY_KEY, now)
      // The list on screen before the press: a different number after it means new offers.
      const shownSeq = held?.seq

      if (await fetchCatalogue($, true)) {
        note = held?.seq === shownSeq ? 'same' : 'new'
      }
    } catch {
      // Quiet: the calm notice stays.
    } finally {
      if (isCheck) {
        checkNote = note
      } else {
        // "Try now" says nothing after a success: its button and line simply go.
        tryNote = note === 'wait' || note === 'failed' ? note : undefined
      }

      $.ui.invalidate('ui.render')
    }
  })
}

// Looks at the schedule and does what is due: a waiting withdrawal first, then
// the offer list. Called at session start, every few minutes, and after a
// Connect or disconnect press. Never from a redraw or a status refresh.
export function networkTick($: EngineInterface, isStart = false): Promise<void> {
  return inTurn(async () => {
    try {
      const now = await $.clock.now()
      const stored = readConnection(await $.store.get(CONNECTION_KEY))
      let record = retireChangedTexts(stored, now)

      // The accepted texts changed since the Connect press: saved as withdrawn,
      // with no undo time, before anything is sent. The withdrawal below goes
      // first, as for any disconnect; nothing else follows it.
      if (record !== stored) {
        await $.store.set(CONNECTION_KEY, record)
        $.ui.invalidate('ui.render')
      }

      if (isConnected(record)) {
        await loadRelease($)
      }

      // The test has ended: withdraw without waiting, and delete what the
      // server sent. The withdrawal is the last thing this add-on sends.
      if (isTestOver(now)) {
        await pruneCodes($, now)

        if (isConnected(record)) {
          record = disconnect(record, now - UNDO_MS)
          await $.store.set(CONNECTION_KEY, record)
          $.ui.invalidate('ui.render')
        }
      }

      // Never connected and nothing waiting: nothing to do, and nothing is sent.
      if (!isConnected(record) && record.withdrawal === null) {
        return
      }

      // At a session's start a waiting withdrawal is tried at once, whatever the
      // back-off says, so that it goes before anything else.
      await sendWithdrawal($, isStart && record.withdrawal !== null && now - record.withdrawal.at >= UNDO_MS)
      await fetchCatalogue($)
    } catch {
      // Quiet: the next tick tries again.
    }
  })
}

// Loads the saved list into memory at session start, without the network.
export async function wakeServerLink($: EngineInterface) {
  try {
    if (isConnected(await loadConnection($))) {
      await loadRelease($)
      await holdSaved($, await $.clock.now())
    }
  } catch {
    held = undefined
  }
}

// The Connect press, called by the panel just after it has saved the
// acceptance the same press gives. This is the first moment anything may be
// sent. If it fails, the acceptance stands and the card offers the press again.
export function connectNow($: EngineInterface): Promise<void> {
  if (connectNote === 'connecting') {
    return Promise.resolve()
  }

  connectNote = 'connecting'
  disconnectNote = undefined
  $.ui.invalidate('ui.render')

  return inTurn(async () => {
    let note: ConnectNote | undefined = 'failed'

    try {
      await loadRelease($)
      const now = await $.clock.now()
      const before = await loadConnection($)

      // (A press made by a newer add-on in another window: never a second install from here.)
      if (!(await isAccepted($, now)) || isConnected(before) || isFromNewerAddon(before) || !canOfferConnect(now)) {
        note = undefined

        return
      }

      // Pressed again inside the undo time: nothing was sent, nothing needs sending.
      if (canUndo(before, now)) {
        await $.store.set(CONNECTION_KEY, undoDisconnect(before, now))
        note = undefined

        return
      }

      // An earlier withdrawal goes first; if it cannot be sent, neither is this.
      if (!(await sendWithdrawal($, true))) {
        return
      }

      disconnectNote = undefined
      const request = connectRequest(CURRENT_VERSIONS, ADDON_VERSION)
      const reply = request === undefined ? undefined : await send($, request, MAX_REPLY_CHARS)
      const parsed = reply === undefined ? undefined : parseConnect(reply, await $.clock.now())

      if (parsed === undefined) {
        return
      }

      await $.store.set(CONNECTION_KEY, connected(await loadConnection($), parsed, await $.clock.now()))
      await $.store.delete(FETCH_KEY)
      note = 'connected'
      await fetchCatalogue($)
    } catch {
      // Quiet: the card shows the calm notice.
    } finally {
      connectNote = note
      $.ui.invalidate('ui.render')
    }
  })
}

// The switch in settings. Offers stop now; the server is told after the undo
// time, or at once when the person asked for their data to be deleted.
export async function disconnectNow($: EngineInterface, isImmediate = false) {
  const now = await $.clock.now()
  const record = await loadConnection($)

  // Also a press made by a newer add-on in another window: this is the person's own request.
  if (!isConnected(record) && !isFromNewerAddon(record)) {
    return
  }

  await $.store.set(CONNECTION_KEY, disconnect(record, isImmediate ? now - UNDO_MS : now))
  connectNote = undefined
  disconnectNote = undefined
  claimNotes.clear()

  if (isImmediate) {
    await networkTick($)
  } else {
    $.clock.after(UNDO_MS + 100, () => void networkTick($))
  }
}

// "Delete saved data" also forgets why the last withdrawal happened, so the
// Connect card no longer says the texts changed.
export function forgetTextsChanged($: EngineInterface): Promise<void> {
  return inTurn(async () => {
    const record = readConnection(await $.store.get(CONNECTION_KEY))

    if (record.textsChanged) {
      await $.store.set(CONNECTION_KEY, { ...record, textsChanged: false })
    }
  })
}

export async function undoDisconnectNow($: EngineInterface) {
  const now = await $.clock.now()
  const record = await loadConnection($)

  if (canUndo(record, now)) {
    await $.store.set(CONNECTION_KEY, undoDisconnect(record, now))
  }
}

// The "Get code" press. The server decides whether a code is given; the device
// only keeps what it gets, if it looks like a code.
export function claimOffer($: EngineInterface, offer: ServerOffer): Promise<StoredCode | undefined> {
  const campaignId = offer.campaign.id

  if (claimNotes.get(campaignId)?.note === 'getting') {
    return Promise.resolve(undefined)
  }

  claimNotes.set(campaignId, { note: 'getting', at: 0 })
  $.ui.invalidate('ui.render')

  return inTurn(async () => {
    let note: ClaimNote | undefined = 'unavailable'

    try {
      await loadRelease($)
      const now = await $.clock.now()
      const record = await loadConnection($)
      const view = serverView(record, now)
      const signed = view.kind === 'live' ? view.catalogue.offers.find(item => item.id === offer.id && item.campaign.id === campaignId) : undefined
      const codes = await loadCodes($, now)

      // Only an offer in the signed list, and only while it shows as ready. A
      // press is tried even when the last list fetch failed: it is the person's
      // own press, and the server may be back.
      if (!isConnected(record) || signed === undefined || isTestOver(now) || !(await isAccepted($, now)) || offerState(signed, codes, record.firstSeenAt, now) !== 'open') {
        note = undefined

        return undefined
      }

      const request = claimRequest(record.token, campaignId, crypto.randomUUID())
      const reply = request === undefined ? undefined : await send($, request, MAX_REPLY_CHARS)
      const after = await $.clock.now()
      const outcome = reply === undefined ? ({ kind: 'offline' } as const) : parseClaim(reply, after)

      if (outcome.kind !== 'ok') {
        // No reply at all: say so, and leave the button for another try.
        note = outcome.kind === 'offline' ? 'offline' : outcome.kind === 'unavailable' && canSayNoneLeft(signed, codes, record, after) ? 'none-left' : 'unavailable'

        // Only "none left" is remembered; "not available" (reason unknown) forgets it.
        if (outcome.kind !== 'offline') {
          await noteNoneLeft($, campaignId, note === 'none-left', after)
        }

        return undefined
      }

      const updated = addCode(await loadCodes($, after), signed, outcome.claim, after, claimedUnder(record))

      if (updated === undefined) {
        return undefined
      }

      // A newer add-on's codes, saved by another window, stay as they are.
      await $.store.set(CODES_KEY, [...updated, ...newerCodes(await $.store.get(CODES_KEY))])
      await noteNoneLeft($, campaignId, false, after)
      const latest = await loadConnection($)

      if (isConnected(latest)) {
        await $.store.set(CONNECTION_KEY, noteContact(latest, after))
      }

      note = undefined

      return updated[0]
    } catch {
      return undefined
    } finally {
      if (note === undefined) {
        claimNotes.delete(campaignId)
      } else {
        claimNotes.set(campaignId, { note, at: await $.clock.now().catch(() => 0) })
      }

      $.ui.invalidate('ui.render')
    }
  })
}
