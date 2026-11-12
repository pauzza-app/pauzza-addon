// The status-line meters and the line itself. Pure: the only inputs are
// usage percentages, reset times, the clock and the saved choice. The meters
// are the five terminal ones of Loadings v2, drawn in loadings.ts.

import { LOADINGS, loadingMoves } from './loadings'
import type { LoadingId } from './loadings'

export type FiveHour = { percent: number; resetMs: number | undefined }
export type MeterId = LoadingId
export type MeterDisplay = 'always' | 'ready' | 'off'
export type Meter = { id: MeterId; name: string; draw: (percent: number, frame?: number) => string }

export const SAMPLE_PERCENT = 52
export const CHOOSE_LINE = '🎁 choose your meter · /pauzza'
const LOUNGE_LINE = '🛋 Limit Lounge · /pauzza'

export const METERS: readonly Meter[] = LOADINGS

export function isMeterDisplay(value: unknown): value is MeterDisplay {
  return value === 'always' || value === 'ready' || value === 'off'
}

export function isMeterId(value: unknown): value is MeterId {
  return METERS.some(meter => meter.id === value)
}

// A saved choice may name a meter this version no longer has, such as one of
// the six food meters retired in 0.18.1. That person keeps a meter: the first
// one. Only a record with no name at all counts as "not chosen yet".
export function savedMeter(value: unknown): MeterId | null {
  if (isMeterId(value)) {
    return value
  }

  return typeof value === 'string' && value !== '' ? METERS[0].id : null
}

export function wholePercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)))
}

export function drawMeter(id: MeterId, percent: number, frame?: number): string {
  return (METERS.find(meter => meter.id === id) ?? METERS[0]).draw(wholePercent(percent), frame)
}

// The types document an ISO 8601 string. Epoch seconds or milliseconds, as a
// number or digits, are accepted as well; anything else means no reset time.
export function parseResetMs(value: unknown): number | undefined {
  const isDigits = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())
  const numeric = typeof value === 'number' ? value : isDigits ? Number(value) : undefined

  if (numeric !== undefined) {
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return undefined
    }

    return numeric < 1e11 ? numeric * 1000 : numeric
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? undefined : parsed
}

type RateLimit = { kind: string; percentUsed: number; resetsAt?: unknown }

function reading(rateLimits: ReadonlyArray<RateLimit>, kind: string): FiveHour | undefined {
  const window = rateLimits.find(item => item.kind === kind)

  return window === undefined || !Number.isFinite(window.percentUsed)
    ? undefined
    : { percent: window.percentUsed, resetMs: parseResetMs(window.resetsAt) }
}

// The 5-hour window alone: the good-pace bonus follows only this one.
export function pickFiveHour(rateLimits: ReadonlyArray<RateLimit>): FiveHour | undefined {
  return reading(rateLimits, 'five_hour')
}

export function pickWeekly(rateLimits: ReadonlyArray<RateLimit>): FiveHour | undefined {
  return reading(rateLimits, 'seven_day')
}

// The window closest to stopping the person, which is what the meter shows.
// Some accounts report only the weekly one. On a tie, the 5-hour window.
export function pickLimit(rateLimits: ReadonlyArray<RateLimit>): FiveHour | undefined {
  const five = reading(rateLimits, 'five_hour')
  const week = reading(rateLimits, 'seven_day')

  if (five === undefined || week === undefined) {
    return five ?? week
  }

  return week.percent > five.percent ? week : five
}

// A reading older than its own reset time says nothing about the new window.
export function currentWindow(five: FiveHour | undefined, now: number): FiveHour | undefined {
  return five !== undefined && five.resetMs !== undefined && now >= five.resetMs ? { percent: 0, resetMs: undefined } : five
}

export function formatReset(resetMs: number | undefined, now: number): string {
  if (resetMs === undefined || resetMs <= now) {
    return ''
  }

  const minutes = Math.ceil((resetMs - now) / 60_000)

  if (minutes >= 24 * 60) {
    return `↻${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`
  }

  return `↻${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

// The panel's note under the meter while a present is still to come.
export function presentNote(leftMs: number): string {
  if (leftMs >= 60 * 60_000) {
    return `Next present in ${Math.ceil(leftMs / (60 * 60_000))} h`
  }

  return leftMs >= 60_000 ? `Next present in ${Math.ceil(leftMs / 60_000)} min` : `Next present in ${Math.ceil(leftMs / 1000)} s`
}

export function isLimited(five: FiveHour | undefined): boolean {
  return five !== undefined && five.percent >= 100
}

export type StatusInput = {
  meter: MeterId | null
  five: FiveHour | undefined
  gifts: number
  isGoodPace: boolean
  waitedMinutes: number
  now: number
  frame?: number
  present?: { percent: number; leftMs: number }
  display?: MeterDisplay
}

function formatPresentLeft(leftMs: number): string {
  if (leftMs >= 60 * 60_000) {
    return `→🎁 ${Math.ceil(leftMs / (60 * 60_000))}h`
  }

  return leftMs >= 60_000 ? `→🎁 ${Math.ceil(leftMs / 60_000)}m` : `→🎁 ${Math.ceil(leftMs / 1000)}s`
}

// The meters move only with room to move in.
export function canAnimate(input: StatusInput): boolean {
  const five = currentWindow(input.five, input.now)

  if ((input.display !== undefined && input.display !== 'always') || isLimited(five) || (five === undefined && input.present === undefined)) {
    return false
  }

  return input.meter !== null && loadingMoves(input.meter, wholePercent(input.present?.percent ?? five?.percent ?? 0))
}

export function statusLine(input: StatusInput): string {
  const { meter, gifts, isGoodPace, waitedMinutes, now, frame, present } = input

  if (meter === null) {
    return CHOOSE_LINE
  }

  const extra = isGoodPace ? '✨ good pace' : gifts > 0 ? `🎁 ${gifts}` : ''
  const five = currentWindow(input.five, now)

  // While presents are still to come, the meter points at the next one. Being
  // stopped by a limit still comes first.
  if (present !== undefined && !isLimited(five)) {
    return [drawMeter(meter, present.percent, frame), formatPresentLeft(present.leftMs), extra].filter(Boolean).join(' ')
  }

  if (five === undefined) {
    return [`no limit data · ⏳ ${Math.floor(waitedMinutes)}m`, extra].filter(Boolean).join(' ')
  }

  const reset = formatReset(five.resetMs, now)

  if (five !== undefined && isLimited(five)) {
    return [drawMeter(meter, 100), LOUNGE_LINE, reset].filter(Boolean).join(' ')
  }

  return [drawMeter(meter, five.percent, frame), reset, extra].filter(Boolean).join(' ')
}

// What the line under the chat box says for the person's setting. Undefined
// removes it. Someone who has not chosen a meter still gets the one nudge.
export function statusFor(input: StatusInput, display: MeterDisplay): string | undefined {
  if (input.meter === null) {
    return CHOOSE_LINE
  }

  if (display === 'off') {
    return undefined
  }

  if (display === 'always') {
    return statusLine(input)
  }

  const five = currentWindow(input.five, input.now)

  if (five !== undefined && isLimited(five)) {
    return [LOUNGE_LINE, formatReset(five.resetMs, input.now)].filter(Boolean).join(' ')
  }

  if (input.gifts > 0) {
    return `🎁 ${input.gifts} · /pauzza`
  }

  return input.isGoodPace ? '✨ good pace · /pauzza' : undefined
}
