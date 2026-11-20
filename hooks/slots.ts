// Where the offers of a signed format 2 list show after Connect: the daily
// offer, the two limit prizes, the presents ladder and the running campaign
// (an "event" in the list). Pure: every input is the checked list, the codes
// held, the connection's first-seen time, the clock or the saved record.
//
// Display only, as everywhere: the server decides, on its own clock, whether a
// code is really given.

import type { Catalogue, CatalogueEvent, ServerOffer, ServerOfferV2, Slot } from './catalogue'
import { compareVersions, TBILISI_OFFSET_MS, VERSION_FORMAT } from './catalogue'
import { offerState, slotOf } from './connection'
import type { PopupRecord, StoredCode } from './connection'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type LimitSlot = Extract<Slot, 'limit-5h' | 'limit-week'>

const eventIdOf = (offer: ServerOffer) => (offer as ServerOfferV2).eventId
const eventsOf = (catalogue: Catalogue): readonly CatalogueEvent[] => (catalogue.v === 2 ? catalogue.events : [])
const opensAt = (offer: ServerOffer) => Date.parse(offer.campaign.opensAt)
const claimBy = (offer: ServerOffer) => Date.parse(offer.campaign.claimBy)
const byId = (a: ServerOffer, b: ServerOffer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
// "First" in a slot: the earliest opening time, then the offer's id.
const byOpening = (a: ServerOffer, b: ServerOffer) => opensAt(a) - opensAt(b) || byId(a, b)
const tbilisiDay = (ms: number) => Math.floor((ms + TBILISI_OFFSET_MS) / DAY_MS)

// A short day, such as "1 Dec", in Tbilisi time.
export function tbilisiDate(ms: number): string {
  const date = new Date(ms + TBILISI_OFFSET_MS)

  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`
}

// ---------------------------------------------------------------- the daily offer

export type DailyView = { kind: 'offer'; offer: ServerOffer } | { kind: 'later' }

// Today's daily offer from its opening (12:00 Tbilisi time), or the earlier one
// while it is still open (before 12:00); "later" when today's has not opened
// yet and no earlier one is open; undefined, and the drawer is hidden, when
// there is no daily offer for today.
export function dailyOffer(catalogue: Catalogue, now: number): DailyView | undefined {
  const daily = catalogue.offers.filter(offer => slotOf(offer) === 'daily').sort(byOpening)
  const current = daily.find(offer => opensAt(offer) <= now && now < claimBy(offer))

  if (current !== undefined) {
    return { kind: 'offer', offer: current }
  }

  return daily.some(offer => opensAt(offer) > now && tbilisiDay(opensAt(offer)) === tbilisiDay(now)) ? { kind: 'later' } : undefined
}

// ---------------------------------------------------------------- the limit prizes

// The slot's offers this device could claim now, first first.
export function limitPrizes(catalogue: Catalogue, slot: LimitSlot, codes: readonly StoredCode[], firstSeenAt: number | null, now: number): ServerOffer[] {
  return catalogue.offers.filter(offer => slotOf(offer) === slot && offerState(offer, codes, firstSeenAt, now) === 'open').sort(byOpening)
}

// The first offer still available. One that this device was just told has no
// codes left gives its place to the next. When every one has, there is none:
// "With no prize offer, or none left, nothing appears" (slots design §3), so
// no dimmed row, no gift mark and no pop-up.
export function firstAvailable(offers: readonly ServerOffer[], isNoneLeft: (campaignId: string) => boolean): ServerOffer | undefined {
  return offers.find(offer => !isNoneLeft(offer.campaign.id))
}

// When the period of an earned limit prize began: the 5-hour prize lasts for
// the rest of the local day, the weekly one for its weekly window (it ends at
// `burnWeekUntil`). One prize per period: a code already claimed from that
// slot in the period ends it.
export function limitPeriodStart(slot: LimitSlot, now: number, burnWeekUntil: number | null): number {
  if (slot === 'limit-week') {
    return (burnWeekUntil ?? now) - WEEK_MS
  }

  const date = new Date(now)

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function claimedInPeriod(catalogue: Catalogue, slot: LimitSlot, codes: readonly StoredCode[], since: number): boolean {
  const inSlot = new Set(catalogue.offers.filter(offer => slotOf(offer) === slot).map(offer => offer.campaign.id))

  return codes.some(item => item.claimedAt >= since && inSlot.has(item.campaignId))
}

export type LimitState = { isEarned: boolean; burnWeekUntil: number | null; firstSeenAt: number | null; isNoneLeft: (campaignId: string) => boolean }

// The limit prize waiting now, if any: the limit reached in this period, no
// code from that slot claimed in it yet, and an offer still available.
export function limitPrize(catalogue: Catalogue, slot: LimitSlot, codes: readonly StoredCode[], state: LimitState, now: number): ServerOffer | undefined {
  if (!state.isEarned || claimedInPeriod(catalogue, slot, codes, limitPeriodStart(slot, now, state.burnWeekUntil))) {
    return undefined
  }

  return firstAvailable(limitPrizes(catalogue, slot, codes, state.firstSeenAt, now), state.isNoneLeft)
}

// The key under which a limit prize's pop-up is remembered: once per period.
export const limitPopupKey = (slot: LimitSlot, day: string, burnWeekUntil: number | null) => (slot === 'limit-5h' ? `limit-5h:${day}` : `limit-week:${burnWeekUntil ?? 0}`)

// ---------------------------------------------------------------- the presents ladder

export type Ladder = { ready: ServerOffer[]; progress: { percent: number; leftMs: number } | undefined }

// When a present is ready: its opening, and its time since connecting.
export const readyAt = (offer: ServerOffer, firstSeenAt: number) => Math.max(opensAt(offer), firstSeenAt + offer.campaign.minInstallAgeSeconds * 1000)

// Presents are steps by time since connecting. Ready ones show under Mine; the
// present bar counts from the last step reached to the next. With no step
// left to reach, or no present at all, there is no bar.
export function presentLadder(catalogue: Catalogue, codes: readonly StoredCode[], firstSeenAt: number | null, now: number): Ladder {
  if (firstSeenAt === null) {
    return { ready: [], progress: undefined }
  }

  const steps = catalogue.offers
    .filter(offer => slotOf(offer) === 'present' && now < claimBy(offer))
    .sort((a, b) => readyAt(a, firstSeenAt) - readyAt(b, firstSeenAt) || byId(a, b))
  const ready = steps.filter(offer => offerState(offer, codes, firstSeenAt, now) === 'open')
  const next = steps.find(offer => readyAt(offer, firstSeenAt) > now)

  if (next === undefined) {
    return { ready, progress: undefined }
  }

  const end = readyAt(next, firstSeenAt)
  const start = Math.min(now, Math.max(firstSeenAt, ...steps.map(offer => readyAt(offer, firstSeenAt)).filter(time => time <= now)))
  const percent = end > start ? Math.min(99, Math.max(0, Math.floor(((now - start) / (end - start)) * 100))) : 0

  return { ready, progress: { percent, leftMs: end - now } }
}

// Which offers are presents: a newly ready one raises a gift mark, and no pop-up.
export const isPresent = (offer: ServerOffer) => slotOf(offer) === 'present'

// ---------------------------------------------------------------- the campaign

// The campaign running now on this device's clock. Events never overlap.
export function runningEvent(catalogue: Catalogue, now: number): CatalogueEvent | undefined {
  return eventsOf(catalogue).find(event => Date.parse(event.startsAt) <= now && now < Date.parse(event.endsAt))
}

// A campaign's offers. Only normal offers may join one.
export function campaignOffers(catalogue: Catalogue, event: CatalogueEvent): ServerOffer[] {
  return catalogue.offers.filter(offer => slotOf(offer) === undefined && eventIdOf(offer) === event.id)
}

// An offer shows in its category unless it has a slot, or its campaign is
// running (then it shows in the campaign drawer only).
export function isInCategory(offer: ServerOffer, running: CatalogueEvent | undefined): boolean {
  return slotOf(offer) === undefined && (running === undefined || eventIdOf(offer) !== running.id)
}

// The last day of a campaign, for "until 1 Dec": the day of its last moment.
export const campaignLastDay = (event: CatalogueEvent) => tbilisiDate(Date.parse(event.endsAt) - 1)

// The campaign whose start pop-up is due: running, not announced before, and
// with at least one offer open now.
export function eventToAnnounce(record: PopupRecord, catalogue: Catalogue, codes: readonly StoredCode[], firstSeenAt: number | null, now: number): CatalogueEvent | undefined {
  const running = runningEvent(catalogue, now)

  if (running === undefined || record.events.includes(running.id)) {
    return undefined
  }

  return campaignOffers(catalogue, running).some(offer => offerState(offer, codes, firstSeenAt, now) === 'open') ? running : undefined
}

export const noteEvent = (record: PopupRecord, event: CatalogueEvent): PopupRecord => ({ ...record, events: [...record.events, event.id].slice(-20) })

// ---------------------------------------------------------------- news and updates

// The news pop-up is due once for each list number that carries a `news` rule.
export const isNewsDue = (record: PopupRecord, catalogue: Catalogue) => catalogue.popupRules.some(rule => rule.template === 'news') && record.newsSeq !== catalogue.seq

// True when `latest` is a newer x.y.z than `current`.
export function isNewer(latest: unknown, current: unknown): boolean {
  return typeof latest === 'string' && typeof current === 'string' && VERSION_FORMAT.test(latest) && VERSION_FORMAT.test(current) && compareVersions(latest, current) > 0
}

// The update pop-up is due once for each newer version: never for this
// version or an older one, so never after the update.
export function isUpdateDue(latest: string | undefined, current: string, announced: string | null): boolean {
  return isNewer(latest, current) && (announced === null || isNewer(latest, announced))
}
