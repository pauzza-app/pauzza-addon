// Waiting Pays, the gift mark and the Daily Drop. Pure: every input
// is the clock, the working state, or a press in the panel.

import type { Drop, Reward } from './offers'
import { isMeterDisplay, savedMeter } from './meters'
import type { FiveHour, MeterDisplay, MeterId } from './meters'

export const DAILY_CAP_MINUTES = 60
export const FINISH_WAIT_MS = 2 * 60_000
export const MAX_MARKS_PER_DAY = 3
export const DROP_UNLOCK = { hour: 12, minute: 0 }
const MAX_RECENT = 8
export const GOOD_PACE_PEAK = 80
// A reset time moving this far later means a new window, not a corrected reading.
const NEW_WINDOW_AFTER_MS = 30 * 60_000

// Exactly what is saved. Listed in the README; keep the two in step.
export type Saved = {
  date: string
  minutes: number
  claimedRewards: string[]
  finishEarned: boolean
  marksRaised: number
  marksPending: number
  dropClaimed: boolean
  goodPaceEarned: boolean
  goodPaceNotice: boolean
  recent: string[]
  meter: MeterId | null
  welcomeEarned: boolean
  windowResetAt: number | null
  windowPeak: number
  installedAt: number | null
  milestonesSeen: string[]
  meterDisplay: MeterDisplay
  popupsOn: boolean
  dropPopupShown: boolean
  burnFiveEarned: boolean
  burnWeekUntil: number | null
}

type Lasting = Pick<Saved, 'recent' | 'meter' | 'welcomeEarned' | 'windowResetAt' | 'windowPeak' | 'installedAt' | 'milestonesSeen' | 'meterDisplay' | 'popupsOn' | 'burnWeekUntil'>

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function dayKey(nowMs: number): string {
  const date = new Date(nowMs)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayNumber(nowMs: number): number {
  const date = new Date(nowMs)

  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function newDay(date: string, lasting: Lasting): Saved {
  return {
    date,
    minutes: 0,
    claimedRewards: [],
    finishEarned: false,
    marksRaised: 0,
    marksPending: 0,
    dropClaimed: false,
    goodPaceEarned: false,
    goodPaceNotice: false,
    dropPopupShown: false,
    burnFiveEarned: false,
    ...lasting,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// Reads what the store holds, starting a fresh day when the date has moved.
// Categories and recently copied offers carry over; all else is per day.
export function readSaved(raw: unknown, nowMs: number): Saved {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Saved>
  const today = dayKey(nowMs)
  const lasting: Lasting = {
    recent: stringList(data.recent),
    meter: savedMeter(data.meter),
    welcomeEarned: data.welcomeEarned === true,
    windowResetAt: typeof data.windowResetAt === 'number' ? data.windowResetAt : null,
    windowPeak: count(data.windowPeak),
    installedAt: typeof data.installedAt === 'number' ? data.installedAt : null,
    milestonesSeen: stringList(data.milestonesSeen),
    meterDisplay: isMeterDisplay(data.meterDisplay) ? data.meterDisplay : 'ready',
    popupsOn: data.popupsOn !== false,
    burnWeekUntil: typeof data.burnWeekUntil === 'number' ? data.burnWeekUntil : null,
  }

  if (data.date !== today) {
    return newDay(today, lasting)
  }

  return {
    date: today,
    minutes: Math.min(count(data.minutes), DAILY_CAP_MINUTES),
    claimedRewards: stringList(data.claimedRewards),
    finishEarned: data.finishEarned === true,
    marksRaised: count(data.marksRaised),
    marksPending: count(data.marksPending),
    dropClaimed: data.dropClaimed === true,
    goodPaceEarned: data.goodPaceEarned === true,
    goodPaceNotice: data.goodPaceNotice === true,
    dropPopupShown: data.dropPopupShown === true,
    burnFiveEarned: data.burnFiveEarned === true,
    ...lasting,
  }
}

// Adds a finished wait. The mark is raised at most once for a wait, a few times
// a day: only when a wait of 2+ minutes first ends that day or a reward is ready.
export function addWait(saved: Saved, waitMs: number, rewards: readonly Reward[]): Saved {
  const minutes = Math.min(saved.minutes + waitMs / 60_000, DAILY_CAP_MINUTES)
  const newlyReady = rewards.filter(reward => saved.minutes < reward.minutes && reward.minutes <= minutes).length
  const isFinish = waitMs >= FINISH_WAIT_MS && !saved.finishEarned
  const gifts = newlyReady + (isFinish ? 1 : 0)
  const isMarked = gifts > 0 && saved.marksRaised < MAX_MARKS_PER_DAY

  return {
    ...saved,
    minutes,
    finishEarned: saved.finishEarned || isFinish,
    marksRaised: saved.marksRaised + (isMarked ? 1 : 0),
    marksPending: saved.marksPending + (isMarked ? gifts : 0),
  }
}

export function clearMark(saved: Saved): Saved {
  return { ...saved, marksPending: 0, goodPaceNotice: false }
}

// Saves the choice. The welcome reward is a single flag, so it comes only once.
export function pickMeter(saved: Saved, meter: MeterId): Saved {
  return { ...saved, meter, welcomeEarned: true }
}

// A new person starts on a meter picked for them, half and half, so they see it
// move at once. The welcome reward and its gift mark come with it, once.
export function assignFirstMeter(saved: Saved, choices: readonly MeterId[], now: number): Saved {
  if (saved.meter !== null || choices.length === 0) {
    return saved
  }

  return { ...pickMeter(saved, choices[now % choices.length]), marksPending: saved.marksPending + 1 }
}

// Follows the 5-hour window from its numbers. When a window ends with a peak
// under 80%, the bonus is earned, once a day.
export function trackWindow(saved: Saved, five: FiveHour | undefined): Saved {
  if (five === undefined) {
    return saved
  }

  const old = saved.windowResetAt

  if (five.resetMs === undefined || old === null) {
    return {
      ...saved,
      windowResetAt: five.resetMs ?? old,
      windowPeak: Math.max(saved.windowPeak, five.percent),
    }
  }

  if (five.resetMs - old <= NEW_WINDOW_AFTER_MS) {
    return { ...saved, windowPeak: Math.max(saved.windowPeak, five.percent) }
  }

  const isBonus = saved.windowPeak > 0 && saved.windowPeak < GOOD_PACE_PEAK && !saved.goodPaceEarned

  return {
    ...saved,
    windowResetAt: five.resetMs,
    windowPeak: five.percent,
    goodPaceEarned: saved.goodPaceEarned || isBonus,
    goodPaceNotice: saved.goodPaceNotice || isBonus,
  }
}

const minutesSince = (saved: Saved, now: number) => (saved.installedAt === null ? 0 : (now - saved.installedAt) / 60_000)

export function reachedMilestones(saved: Saved, now: number, milestones: readonly Reward[]): Reward[] {
  return milestones.filter(item => item.minutes <= minutesSince(saved, now))
}

export function nextMilestone(saved: Saved, now: number, milestones: readonly Reward[]): { minutes: number; left: number } | undefined {
  const elapsed = minutesSince(saved, now)
  const next = milestones.find(item => item.minutes > elapsed)

  return next === undefined ? undefined : { minutes: next.minutes, left: Math.ceil(next.minutes - elapsed) }
}

export const DROP_POPUP = 'Daily Drop is open · /pauzza'
export const BURN_FIVE_POPUP = '🎁 5-hour limit prize · /pauzza'
export const BURN_WEEK_POPUP = '🎁 Weekly limit prize · /pauzza'
const WEEK_MS = 7 * 24 * 60 * 60_000

export const canPopUp = (saved: Saved) => saved.meterDisplay !== 'off' && saved.popupsOn

// One deal pop-up a day, and none for someone who turned them off.
export function takePopups(saved: Saved, isDropOpen: boolean): { saved: Saved; popups: string[] } {
  if (saved.meter === null || !isDropOpen || saved.dropPopupShown) {
    return { saved, popups: [] }
  }

  return { saved: { ...saved, dropPopupShown: true, marksPending: saved.marksPending + 1 }, popups: canPopUp(saved) ? [DROP_POPUP] : [] }
}

export function hasBurnWeek(saved: Saved, now: number): boolean {
  return saved.burnWeekUntil !== null && now < saved.burnWeekUntil
}

// A prize for reaching 100%: the 5-hour limit at most once a day, the weekly
// limit at most once per weekly window. Earned even with pop-ups turned off.
export function takeBurnouts(saved: Saved, five: FiveHour | undefined, week: FiveHour | undefined, now: number): { saved: Saved; popups: string[] } {
  if (saved.meter === null) {
    return { saved, popups: [] }
  }

  const earnsFive = five !== undefined && five.percent >= 100 && !saved.burnFiveEarned
  const earnsWeek = week !== undefined && week.percent >= 100 && !hasBurnWeek(saved, now)
  const gifts = Number(earnsFive) + Number(earnsWeek)

  return {
    saved: {
      ...saved,
      burnFiveEarned: saved.burnFiveEarned || earnsFive,
      burnWeekUntil: earnsWeek ? (week.resetMs !== undefined && week.resetMs > now ? week.resetMs : now + WEEK_MS) : saved.burnWeekUntil,
      marksPending: saved.marksPending + gifts,
    },
    popups: canPopUp(saved) ? [...(earnsFive ? [BURN_FIVE_POPUP] : []), ...(earnsWeek ? [BURN_WEEK_POPUP] : [])] : [],
  }
}

// How far along the way to the next present, restarting after each one.
export function presentProgress(saved: Saved, now: number, milestones: readonly Reward[], isDaily = false): { percent: number; leftMs: number } | undefined {
  const elapsed = minutesSince(saved, now)
  const index = milestones.findIndex(item => item.minutes > elapsed)

  if (saved.installedAt === null) {
    return undefined
  }

  if (index === -1) {
    return isDaily ? dailyProgress(now) : undefined
  }

  const start = index === 0 ? 0 : milestones[index - 1].minutes
  const end = milestones[index].minutes

  return { percent: Math.floor(((elapsed - start) / (end - start)) * 100), leftMs: (end - elapsed) * 60_000 }
}

// Progress through the day toward the next daily offer, local time.
export function dailyProgress(now: number): { percent: number; leftMs: number } {
  const date = new Date(now)
  const last = new Date(date.getFullYear(), date.getMonth(), date.getDate(), DROP_UNLOCK.hour, DROP_UNLOCK.minute)

  if (last.getTime() > now) {
    last.setDate(last.getDate() - 1)
  }

  const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1, DROP_UNLOCK.hour, DROP_UNLOCK.minute)
  const span = next.getTime() - last.getTime()

  return { percent: Math.floor(((now - last.getTime()) / span) * 100), leftMs: next.getTime() - now }
}

// Starts the local timer on first sight, and raises the gift mark once for each
// present whose time has come. A test-only timer: this record can be edited.
export function noteMilestones(saved: Saved, now: number, milestones: readonly Reward[]): Saved {
  const timed = saved.installedAt === null ? { ...saved, installedAt: now } : saved
  const fresh = reachedMilestones(timed, now, milestones).filter(item => !timed.milestonesSeen.includes(item.id))

  return fresh.length === 0
    ? timed
    : { ...timed, marksPending: timed.marksPending + fresh.length, milestonesSeen: [...timed.milestonesSeen, ...fresh.map(item => item.id)] }
}

export function nextReward(minutes: number, rewards: readonly Reward[]): Reward | undefined {
  return rewards.find(reward => reward.minutes > minutes)
}

export function readyRewards(minutes: number, rewards: readonly Reward[]): Reward[] {
  return rewards.filter(reward => reward.minutes <= minutes)
}

export function claimReward(saved: Saved, id: string): Saved {
  return saved.claimedRewards.includes(id) ? saved : { ...saved, claimedRewards: [...saved.claimedRewards, id] }
}

export function noteCopied(saved: Saved, offerId: string): Saved {
  return { ...saved, recent: [offerId, ...saved.recent.filter(id => id !== offerId)].slice(0, MAX_RECENT) }
}

export function isDropUnlocked(nowMs: number): boolean {
  const date = new Date(nowMs)
  const minuteOfDay = date.getHours() * 60 + date.getMinutes()

  return minuteOfDay >= DROP_UNLOCK.hour * 60 + DROP_UNLOCK.minute
}

export function dropOfDay(drops: readonly Drop[], nowMs: number): Drop | undefined {
  return drops[dayNumber(nowMs) % drops.length]
}

// Measures one wait from the working state alone. Returns its length when work
// stops. No timer is involved.
export function createWaitTimer(): { update: (isWorking: boolean, now: number) => number | undefined; runningMs: (now: number) => number } {
  let startedAt: number | undefined

  return {
    update: (isWorking, now) => {
      if (isWorking) {
        startedAt ??= now

        return undefined
      }

      const finished = startedAt === undefined ? undefined : now - startedAt
      startedAt = undefined

      return finished
    },
    runningMs: now => (startedAt === undefined ? 0 : now - startedAt),
  }
}
