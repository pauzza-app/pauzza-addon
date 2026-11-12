// Every network call the add-on makes, and the records they keep. This is the
// only file that touches the network, and `send` is the only function in it
// that does.
//
// The rules, each enforced here and proven by a test:
// - Before the Connect press, nothing is sent: not even the offer list.
// - Accepting the Terms is not permission to connect. Only the saved record of
//   a Connect press is.
// - The offer list is fetched on the schedule in `fetch-schedule.ts`: never
//   from a redraw, a status refresh or at a set time of day.
// - A token is sent only on a press (Get code) and on withdrawal.
// - A waiting withdrawal goes before any other call.
// - Any reply that is slow, failed, too large or not exactly as expected counts
//   as no reply, silently.

import type { EngineInterface } from 'claude-code'

import { acceptCatalogue, MAX_ENVELOPE_BYTES } from './catalogue'
import type { Catalogue, PinnedKeys, ServerOffer } from './catalogue'
import { canOfferConnect, isTestOver, setTestEndDate } from './connect-text'
import {
  addCode,
  canSayNoneLeft,
  canUndo,
  connected,
  CURRENT_VERSIONS,
  disconnect,
  forget,
  isConnected,
  isForgotten,
  isLive,
  isWithdrawalDue,
  noteContact,
  offerState,
  readCodes,
  readConnection,
  undoDisconnect,
  withdrawalDone,
  withdrawalTried,
} from './connection'
import type { ConnectionRecord, StoredCode } from './connection'
import { isRunning, readConsent, UNDO_MS, viewOf } from './consent'
import { afterFailure, afterSuccess, isDue, readFetchState } from './fetch-schedule'
import { ADDON_VERSION, BASE_URL, catalogueRequest, claimRequest, connectRequest, isEtag, isWithdrawn, MAX_REPLY_CHARS, parseClaim, parseConnect, TIMEOUT_MS, withdrawRequest } from './server'
import type { Outgoing, Reply } from './server'

export const CONNECTION_KEY = 'connection'
export const CODES_KEY = 'codes'
export const CATALOGUE_KEY = 'catalogue'
export const FETCH_KEY = 'fetch'
export const POPUPS_KEY = 'serverPopups'
const CONSENT_KEY = 'consent'
// How often a session looks at the shared schedule. Looking sends nothing.
export const TICK_MS = 5 * 60_000

type Held = { text: string; seq: number; etag: string | undefined; catalogue: Catalogue; showOffers: boolean }
// What the offer drawers should show.
export type ServerView =
  | { kind: 'local' } // not connected, nothing received yet, or the last list is past its date: the built-in samples
  | { kind: 'paused' } // connected, but this version is older than the signed list allows
  | { kind: 'live'; catalogue: Catalogue }

export type ClaimNote = 'getting' | 'none-left' | 'unavailable' | 'offline'
export type ConnectNote = 'connecting' | 'failed' | 'connected'
export type DisconnectNote = 'done'

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

// Reads the two values fixed in the release: the day the test ends and the
// trusted public keys. They travel with the add-on's own files, like its code;
// nothing the server, the saved records or a setting supplies reaches them.
export function loadRelease($: EngineInterface): Promise<void> {
  release ??= (async () => {
    try {
      const data = JSON.parse(await $.fs.read(`${$.plugin.root}/release.json`))

      setTestEndDate(data?.testEndDate)
      pinnedKeys = readKeys(data?.catalogueKeys)
    } catch {
      setTestEndDate('')
      pinnedKeys = {}
    }
  })()

  return release
}

export const currentConnectNote = () => connectNote
export const currentDisconnectNote = () => disconnectNote

// The one-time notes go when the panel closes.
export function clearOnceNotes() {
  if (connectNote !== 'connecting') {
    connectNote = undefined
  }

  disconnectNote = undefined
}

export function claimNote(campaignId: string, now: number): ClaimNote | undefined {
  const entry = claimNotes.get(campaignId)

  return entry !== undefined && (entry.note === 'getting' || now - entry.at < NOTE_MS) ? entry.note : undefined
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

export async function loadConnection($: EngineInterface): Promise<ConnectionRecord> {
  return readConnection(await $.store.get(CONNECTION_KEY))
}

export async function loadCodes($: EngineInterface, now: number): Promise<StoredCode[]> {
  return isTestOver(now) ? [] : readCodes(await $.store.get(CODES_KEY), now)
}

// Deletes every code past its use-by date from the saved record.
export async function pruneCodes($: EngineInterface, now: number): Promise<StoredCode[]> {
  const raw = await $.store.get(CODES_KEY)
  // When the test is over, its codes go too.
  const codes = isTestOver(now) ? [] : readCodes(raw, now)

  if (raw !== undefined && raw !== null && (!Array.isArray(raw) || raw.length !== codes.length)) {
    if (codes.length === 0) {
      await $.store.delete(CODES_KEY)
    } else {
      await $.store.set(CODES_KEY, codes)
    }
  }

  return codes
}

async function isAccepted($: EngineInterface, now: number): Promise<boolean> {
  return isRunning(viewOf(readConsent(await $.store.get(CONSENT_KEY)), now))
}

// The saved list is checked again before it is believed: the saved record is
// trusted no more than the server.
async function holdSaved($: EngineInterface, now: number) {
  const raw = (await $.store.get(CATALOGUE_KEY)) as { text?: unknown; etag?: unknown } | undefined
  const text = typeof raw?.text === 'string' ? raw.text : undefined

  if (text === heldFrom) {
    return
  }

  heldFrom = text
  held = undefined

  if (text === undefined) {
    return
  }

  const checked = await acceptCatalogue(text, { pinnedKeys, lastSeq: 0, now, addonVersion: ADDON_VERSION })

  if (checked.ok) {
    held = { text, seq: checked.catalogue.seq, etag: isEtag(raw?.etag) ? raw.etag : undefined, catalogue: checked.catalogue, showOffers: checked.showOffers }
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

// True while the last try to fetch the list failed.
export async function isUnreachable($: EngineInterface): Promise<boolean> {
  return readFetchState(await $.store.get(FETCH_KEY)).failures > 0
}

async function forgetServerData($: EngineInterface) {
  await $.store.delete(CATALOGUE_KEY)
  await $.store.delete(FETCH_KEY)
  await $.store.delete(POPUPS_KEY)
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

async function fetchCatalogue($: EngineInterface) {
  const now = await $.clock.now()
  const record = await loadConnection($)

  if (!isConnected(record) || !(await isAccepted($, now)) || isTestOver(now)) {
    return
  }

  // The server has forgotten this install by now: stop, and ask again.
  if (isForgotten(record, now)) {
    await $.store.set(CONNECTION_KEY, forget(record))
    await forgetServerData($)
    $.ui.invalidate('ui.render')

    return
  }

  await holdSaved($, now)
  const state = readFetchState(await $.store.get(FETCH_KEY))

  if (!isDue(state, now)) {
    return
  }

  // Written before the call, so another session does not fetch as well, and a
  // call that never returns still backs off.
  await $.store.set(FETCH_KEY, afterFailure(state, now, Math.random()))
  const reply = await send($, catalogueRequest(held?.etag), MAX_ENVELOPE_BYTES)
  let isGood = reply !== undefined && held !== undefined && (reply.status === 304 || (reply.status === 200 && reply.text === held.text))

  if (!isGood && reply !== undefined && reply.status === 200) {
    const saved = (await $.store.get(CATALOGUE_KEY)) as { seq?: unknown } | undefined
    const lastSeq = Math.max(held?.seq ?? 0, Number.isSafeInteger(saved?.seq) ? (saved!.seq as number) : 0)
    const checked = await acceptCatalogue(reply.text, { pinnedKeys, lastSeq, now: await $.clock.now(), addonVersion: ADDON_VERSION })

    // Still connected? The person may have switched off while this was under way.
    if (checked.ok && isConnected(await loadConnection($))) {
      const etag = isEtag(reply.headers.etag) ? reply.headers.etag : undefined

      await $.store.set(CATALOGUE_KEY, { text: reply.text, seq: checked.catalogue.seq, etag })
      held = { text: reply.text, seq: checked.catalogue.seq, etag, catalogue: checked.catalogue, showOffers: checked.showOffers }
      heldFrom = reply.text
      isGood = true
    }
  }

  if (isGood && isConnected(await loadConnection($))) {
    await $.store.set(FETCH_KEY, afterSuccess(await $.clock.now(), Math.random()))
  }

  $.ui.invalidate('ui.render')
}

// Looks at the schedule and does what is due: a waiting withdrawal first, then
// the offer list. Called at session start, every few minutes, and after a
// Connect or disconnect press. Never from a redraw or a status refresh.
export function networkTick($: EngineInterface, isStart = false): Promise<void> {
  return inTurn(async () => {
    try {
      const now = await $.clock.now()
      let record = await loadConnection($)

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

// The Connect press. This is the first moment anything may be sent.
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

      if (!(await isAccepted($, now)) || isConnected(before) || !canOfferConnect(now)) {
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

  if (!isConnected(record)) {
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

        return undefined
      }

      const updated = addCode(await loadCodes($, after), signed, outcome.claim, after)

      if (updated === undefined) {
        return undefined
      }

      await $.store.set(CODES_KEY, updated)
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
