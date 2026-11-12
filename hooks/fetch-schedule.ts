// When a future server version may fetch offers. Pure, and not used yet: this
// offline version never connects.
//
// It is kept apart on purpose. The status line refreshes every second during
// the first wait, every minute in every session and on every usage update, and
// the daily offer opens at 12:00 for everyone. A fetch placed in any of those
// would flood the server. Fetching follows this schedule instead: at most every
// few hours, spread at random, with growing waits after a failure, and one
// record shared by every session on the computer.

export const MIN_GAP_MS = 4 * 60 * 60_000
export const SPREAD_MS = 60 * 60_000
export const FIRST_RETRY_MS = 15 * 60_000
export const MAX_RETRY_MS = 24 * 60 * 60_000
const MAX_FAILURES = 20

export type FetchState = { lastAttemptAt: number | null; failures: number; nextAt: number | null }

const FIRST: FetchState = { lastAttemptAt: null, failures: 0, nextAt: null }

const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e15 ? value : null)
// A broken random source must not line everyone up on the same second.
const unit = (random: number) => (Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999) : 0.5)

// Reads the shared record; anything unreadable means "never fetched".
export function readFetchState(raw: unknown): FetchState {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<FetchState>
  const failures = typeof data.failures === 'number' && Number.isInteger(data.failures) ? Math.min(Math.max(data.failures, 0), MAX_FAILURES) : 0

  return { lastAttemptAt: time(data.lastAttemptAt), failures, nextAt: time(data.nextAt) }
}

export function isDue(state: FetchState, now: number): boolean {
  if (state.nextAt === null) {
    return true
  }

  // A clock set far back would otherwise silence fetching for good.
  if (state.lastAttemptAt !== null && now < state.lastAttemptAt - MAX_RETRY_MS) {
    return true
  }

  // A next time absurdly far ahead is treated as the longest wait.
  return now >= Math.min(state.nextAt, (state.lastAttemptAt ?? now) + MAX_RETRY_MS + SPREAD_MS)
}

export function afterSuccess(now: number, random: number): FetchState {
  return { lastAttemptAt: now, failures: 0, nextAt: now + MIN_GAP_MS + Math.floor(unit(random) * SPREAD_MS) }
}

export function afterFailure(state: FetchState, now: number, random: number): FetchState {
  const failures = Math.min(state.failures + 1, MAX_FAILURES)
  const wait = Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS)

  return { lastAttemptAt: now, failures, nextAt: now + wait + Math.floor(unit(random) * Math.min(SPREAD_MS, wait)) }
}

export { FIRST as NEVER_FETCHED }
