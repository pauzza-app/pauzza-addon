// Add-on 0.21.0: the special slots (daily offer, limit prizes, presents), the
// campaigns, the news and update pop-ups, and no practice prizes after Connect.
// Every list is format 2, the only one this version asks for. Nothing here uses
// a real network: every reply comes from a stub.

import { expect, mock, test } from 'claude-code/testing'

import { CATEGORY_EMOJI, categoryEmoji, drawerColour, iconTileSvg, lookColour, lookTileSvg } from '../hooks/art'
import { CATEGORIES_V2, EVENT_LOOKS } from '../hooks/catalogue'
import { CONNECT_PRIVACY_VERSION, CONNECT_TERMS_VERSION, CONNECT_TEXT, CONNECT_WORDING_VERSION, OFFER_POPUP } from '../hooks/connect-text'
import { isAnnounced, newlyOpen, readPopups } from '../hooks/connection'
import { CONSENT_TEXT, TERMS_VERSION, WORDING_VERSION } from '../hooks/consent-text'
import { isBuiltInPopup } from '../hooks/display'
import { ADDON_VERSION, BASE_URL } from '../hooks/server'
import { LOOK_TEXT, lookText, NEWS_POPUP, SLOT_TEXT, UPDATE_POPUP } from '../hooks/slot-text'
import {
  campaignLastDay,
  campaignOffers,
  claimedInPeriod,
  dailyOffer,
  eventToAnnounce,
  firstAvailable,
  isInCategory,
  isNewer,
  isNewsDue,
  isUpdateDue,
  limitPeriodStart,
  limitPopupKey,
  limitPrize,
  limitPrizes,
  noteEvent,
  presentLadder,
  runningEvent,
  tbilisiDate,
} from '../hooks/slots'
import { addWait, BURN_FIVE_POPUP, BURN_WEEK_POPUP, readSaved, takeBurnouts, pickMeter } from '../hooks/waiting-pays'
import { signCatalogue, testKey } from './signing'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// 10:00 in Tbilisi (UTC+4) on 12 November 2026.
const NOW = Date.UTC(2026, 10, 12, 6, 0)
// 12:00 Tbilisi is 08:00 UTC, `days` days after NOW's date.
const noon = (days: number) => Date.UTC(2026, 10, 12 + days, 8, 0)
const iso = (ms: number) => new Date(ms).toISOString()
const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/

const TOKEN = 'tok-_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk0'
const REF = '7KQ2M9XH4D'
const VERSIONS = { wordingVersion: CONNECT_WORDING_VERSION, termsVersion: CONNECT_TERMS_VERSION, privacyVersion: CONNECT_PRIVACY_VERSION }

// Format 2 lists carry no merchant, code type or budget, only the sealed fingerprint of them (the
// server checks it; the add-on checks only its shape).
const DIGEST = 'ab'.repeat(32)
const campaign = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  opensAt: iso(NOW - HOUR),
  claimBy: iso(NOW + 2 * DAY),
  useBy: iso(NOW + 5 * DAY),
  minInstallAgeSeconds: 0,
  ...fields,
})
const offer = (id: string, fields: Record<string, unknown> = {}, campaignFields: Record<string, unknown> = {}) => ({
  id,
  brand: `Mock ${id}`,
  text: '15% off a mock pizza',
  category: 'food',
  campaign: campaign(`${id}-c1`, campaignFields),
  ...fields,
})
const daily = (id: string, days: number) => offer(id, { slot: 'daily' }, { opensAt: iso(noon(days)), claimBy: iso(noon(days) + DAY - MINUTE) })
const limit = (id: string, slot: 'limit-5h' | 'limit-week', opensAgo = HOUR) => offer(id, { slot }, { opensAt: iso(NOW - opensAgo) })
const present = (id: string, seconds: number) => offer(id, { slot: 'present' }, { minInstallAgeSeconds: seconds, opensAt: iso(NOW - 2 * DAY) })
const event = (id: string, startsAt: number, endsAt: number, fields: Record<string, unknown> = {}) => ({ id, name: 'Black Friday', startsAt: iso(startsAt), endsAt: iso(endsAt), look: 'black-friday', ...fields })
const RULES = {
  daily: { id: 'daily', template: 'daily-offer', maxPerDay: 4 },
  limit: { id: 'limit', template: 'limit-lounge', maxPerDay: 2 },
  event: { id: 'event', template: 'event-start', maxPerDay: 1 },
  news: { id: 'news', template: 'news', maxPerDay: 2 },
}
const list = (fields: Record<string, unknown> = {}): any => ({
  v: 2,
  latestAddonVersion: '0.21.0',
  events: [],
  seq: 1,
  issuedAt: iso(NOW - MINUTE),
  expiresAt: iso(NOW + 10 * DAY),
  minAddonVersion: '0.21.0',
  allowedLinkHosts: [],
  categories: [{ id: 'food', label: 'Food' }, { id: 'drinks', label: 'Drinks' }],
  offers: [offer('pizza')],
  schedule: { dailyOfferOpens: '12:00' },
  popupRules: [RULES.daily],
  privateDigest: DIGEST,
  ...fields,
})

// ---------------------------------------------------------------- pure: where each offer shows

test('daily offer: today from 12:00 Tbilisi time, the earlier one while open, "later" before 12:00, none when there is none', () => {
  const both = list({ offers: [daily('yesterday', -1), daily('today', 0)] })

  // 10:00 Tbilisi: yesterday's is still open until 11:59.
  expect(dailyOffer(both, NOW)).toEqual({ kind: 'offer', offer: both.offers[0] })
  // 11:59 exactly: yesterday's has closed; today's opens at 12:00.
  expect(dailyOffer(both, noon(0) - MINUTE)).toEqual({ kind: 'later' })
  expect(dailyOffer(both, noon(0))).toEqual({ kind: 'offer', offer: both.offers[1] })
  expect(dailyOffer(both, noon(1) - 2 * MINUTE)).toEqual({ kind: 'offer', offer: both.offers[1] })
  // Tomorrow, with no daily offer for that day: no drawer at all.
  expect(dailyOffer(both, noon(1) + HOUR)).toBe(undefined)
  // Only today's, before it opens.
  expect(dailyOffer(list({ offers: [daily('today', 0)] }), NOW)).toEqual({ kind: 'later' })
  // Only tomorrow's: nothing today.
  expect(dailyOffer(list({ offers: [daily('tomorrow', 1)] }), NOW)).toBe(undefined)
  expect(dailyOffer(list(), NOW)).toBe(undefined)
  // Tbilisi is UTC+4 all year: 20:00 UTC is already the next day there.
  expect(tbilisiDate(Date.UTC(2026, 10, 30, 20, 0))).toBe('1 Dec')
  expect(tbilisiDate(Date.UTC(2026, 10, 30, 19, 59))).toBe('30 Nov')
})

test('limit prizes: the first available, by earliest opening then id; one that ran out gives way; one per period', () => {
  const data = list({ offers: [limit('b-later', 'limit-5h', HOUR), limit('b', 'limit-5h', 2 * HOUR), limit('a', 'limit-5h', 2 * HOUR), limit('week', 'limit-week'), offer('plain')] })
  const ids = (offers: any[]) => offers.map(item => item.id)

  expect(ids(limitPrizes(data, 'limit-5h', [], NOW - DAY, NOW))).toEqual(['a', 'b', 'b-later'])
  expect(ids(limitPrizes(data, 'limit-week', [], NOW - DAY, NOW))).toEqual(['week'])
  expect(firstAvailable(limitPrizes(data, 'limit-5h', [], NOW - DAY, NOW), () => false)?.id).toBe('a')
  expect(firstAvailable(limitPrizes(data, 'limit-5h', [], NOW - DAY, NOW), id => id === 'a-c1')?.id).toBe('b')
  // Every one has run out: none, so nothing appears (slots design §3).
  expect(firstAvailable(limitPrizes(data, 'limit-5h', [], NOW - DAY, NOW), () => true)).toBe(undefined)
  const state = { isEarned: true, burnWeekUntil: null, firstSeenAt: NOW - DAY, isNoneLeft: () => false }
  expect(limitPrize(data, 'limit-5h', [], state, NOW)?.id).toBe('a')
  expect(limitPrize(data, 'limit-5h', [], { ...state, isEarned: false }, NOW)).toBe(undefined)
  expect(limitPrize(data, 'limit-5h', [], { ...state, isNoneLeft: () => true }, NOW)).toBe(undefined)
  // Ended offers are not available either.
  expect(limitPrize(list({ offers: [limit('old', 'limit-5h', 3 * DAY)].map(item => ({ ...item, campaign: { ...item.campaign, claimBy: iso(NOW - HOUR) } })) }), 'limit-5h', [], state, NOW)).toBe(undefined)
  expect(limitPopupKey('limit-5h', '2026-11-12', null)).toBe('limit-5h:2026-11-12')
  expect(limitPopupKey('limit-week', '2026-11-12', NOW)).toBe(`limit-week:${NOW}`)
  expect(firstAvailable([], () => false)).toBe(undefined)

  // A claimed one is no longer available, and it ends the period's prize.
  const code = { claimId: '11111111-2222-4333-8444-555555555555', campaignId: 'a-c1', brand: 'Mock a', text: 'x', code: 'PAUZZA-0042', useBy: NOW + DAY, claimedAt: NOW - HOUR }
  expect(ids(limitPrizes(data, 'limit-5h', [code], NOW - DAY, NOW))).toEqual(['b', 'b-later'])
  expect(claimedInPeriod(data, 'limit-5h', [code], limitPeriodStart('limit-5h', NOW, null))).toBe(true)
  expect(claimedInPeriod(data, 'limit-5h', [{ ...code, claimedAt: NOW - 2 * DAY }], limitPeriodStart('limit-5h', NOW, null))).toBe(false)
  expect(claimedInPeriod(data, 'limit-week', [code], limitPeriodStart('limit-week', NOW, NOW + DAY))).toBe(false)
  // The weekly prize's period is its weekly window, ending at the reset.
  expect(limitPeriodStart('limit-week', NOW, NOW + DAY)).toBe(NOW - 6 * DAY)
})

test('presents: a ladder by time since connecting, the bar counting to the next step', () => {
  const data = list({ offers: [present('p-3h', 3 * 3600), present('p-10m', 600), present('p-1h', 3600), offer('plain')] })
  const seen = NOW - 30 * MINUTE
  const ladder = presentLadder(data, [], seen, NOW)

  expect(ladder.ready.map(item => item.id)).toEqual(['p-10m'])
  // From the 10-minute step to the 1-hour step: 20 of 50 minutes gone.
  expect(ladder.progress).toEqual({ percent: 40, leftMs: 30 * MINUTE })
  expect(presentLadder(data, [], seen, seen + 2 * HOUR).ready.map(item => item.id)).toEqual(['p-10m', 'p-1h'])
  // Every step reached: no bar.
  expect(presentLadder(data, [], seen, seen + 4 * HOUR).progress).toBe(undefined)
  // No presents, or no connection time: no bar.
  expect(presentLadder(list(), [], seen, NOW)).toEqual({ ready: [], progress: undefined })
  expect(presentLadder(data, [], null, NOW)).toEqual({ ready: [], progress: undefined })
  // Before the first step, the bar counts from connecting.
  expect(presentLadder(data, [], NOW - 5 * MINUTE, NOW).progress).toEqual({ percent: 50, leftMs: 5 * MINUTE })
})

test('campaigns: running between start and end, its offers leave their category, and its start is announced once', () => {
  const running = event('bf', NOW - HOUR, NOW + 5 * DAY)
  const data = list({ events: [running], offers: [offer('plain'), offer('bf-pizza', { eventId: 'bf' }), daily('day', 0)] })
  const record = readPopups(undefined, NOW)

  expect(runningEvent(data, NOW)).toEqual(running)
  expect(runningEvent(data, NOW - 2 * HOUR)).toBe(undefined)
  expect(runningEvent(data, NOW + 5 * DAY)).toBe(undefined)
  expect(campaignOffers(data, running).map(item => item.id)).toEqual(['bf-pizza'])
  expect(data.offers.filter((item: any) => isInCategory(item, running)).map((item: any) => item.id)).toEqual(['plain'])
  expect(data.offers.filter((item: any) => isInCategory(item, undefined)).map((item: any) => item.id)).toEqual(['plain', 'bf-pizza'])
  // "until 17 Nov": the last day, Tbilisi time.
  expect(campaignLastDay(running)).toBe('17 Nov')
  expect(campaignLastDay(event('x', NOW, Date.UTC(2026, 11, 1, 20, 0)))).toBe('1 Dec')

  expect(eventToAnnounce(record, data, [], NOW - DAY, NOW)).toEqual(running)
  expect(eventToAnnounce(noteEvent(record, running), data, [], NOW - DAY, NOW)).toBe(undefined)
  // Only with at least one offer open.
  const closed = list({ events: [running], offers: [offer('bf-pizza', { eventId: 'bf' }, { opensAt: iso(NOW + HOUR) })] })
  expect(eventToAnnounce(record, closed, [], NOW - DAY, NOW)).toBe(undefined)
  // An id named like a built-in is just an id.
  const odd = list({ events: [event('constructor', NOW - HOUR, NOW + DAY)], offers: [offer('c', { eventId: 'constructor' })] })
  expect(eventToAnnounce(record, odd, [], NOW - DAY, NOW)?.id).toBe('constructor')
})

test('the "new offer" pop-up counts normal, daily and campaign offers, never limit prizes or presents', () => {
  const data = list({
    events: [event('bf', NOW - HOUR, NOW + DAY)],
    offers: [offer('plain'), daily('day', -1), offer('bf-pizza', { eventId: 'bf' }), limit('lounge', 'limit-5h'), limit('week', 'limit-week'), present('gift', 60)],
  })
  const opened = newlyOpen(readPopups(undefined, NOW), data, [], NOW - DAY, NOW)

  expect(opened.count).toBe(3)
  expect(opened.record.seen).toEqual(['plain-c1', 'day-c1', 'bf-pizza-c1'])
  expect(data.offers.map((item: any) => isAnnounced(item))).toEqual([true, true, true, false, false, false])
})

test('news and updates: once per list number, once per newer version, never after the update', () => {
  const record = readPopups(undefined, NOW)

  expect(isNewsDue(record, list({ popupRules: [RULES.news] }))).toBe(true)
  expect(isNewsDue({ ...record, newsSeq: 1 }, list({ popupRules: [RULES.news] }))).toBe(false)
  expect(isNewsDue({ ...record, newsSeq: 1 }, list({ seq: 2, popupRules: [RULES.news] }))).toBe(true)
  expect(isNewsDue(record, list())).toBe(false)

  expect(isNewer('0.22.0', '0.21.0')).toBe(true)
  expect(isNewer('0.21.10', '0.21.9')).toBe(true)
  expect(isNewer('0.21.0', '0.21.0')).toBe(false)
  expect(isNewer('0.20.9', '0.21.0')).toBe(false)
  expect(isNewer('1.0', '0.21.0')).toBe(false)
  expect(isNewer(undefined, '0.21.0')).toBe(false)
  expect(isUpdateDue('0.22.0', ADDON_VERSION, null)).toBe(true)
  expect(isUpdateDue('0.22.0', ADDON_VERSION, '0.22.0')).toBe(false)
  expect(isUpdateDue('0.23.0', ADDON_VERSION, '0.22.0')).toBe(true)
  expect(isUpdateDue('0.22.0', ADDON_VERSION, '0.23.0')).toBe(false)
  // After updating, the same number is this version: never again.
  expect(isUpdateDue('0.22.0', '0.22.0', null)).toBe(false)
  expect(isUpdateDue(undefined, ADDON_VERSION, null)).toBe(false)
})

test('saved records: the new fields are read as untrusted', () => {
  expect(readSaved({ updateAnnounced: '0.22.0' }, NOW).updateAnnounced).toBe('0.22.0')

  for (const junk of [undefined, 22, '0.22', '<b>', '0.22.0\n', ['0.22.0'], { v: 1 }]) {
    expect(readSaved({ updateAnnounced: junk }, NOW).updateAnnounced).toBe(null)
  }

  // Lasting: a new day keeps it.
  expect(readSaved({ date: '2000-01-01', updateAnnounced: '0.22.0' }, NOW).updateAnnounced).toBe('0.22.0')

  const popups = readPopups({ events: ['bf', '__proto__', 'Bad Id', 7, 'a'.repeat(41)], newsSeq: 3 }, NOW)
  expect(popups.events).toEqual(['bf'])
  expect(popups.newsSeq).toBe(3)

  for (const junk of [0, -1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
    expect(readPopups({ newsSeq: junk }, NOW).newsSeq).toBe(null)
  }

  const limits = readPopups({ limits: ['limit-5h:2026-11-12', 'limit-week:1794373200000', 'limit-5h:today', 'other', 7] }, NOW)
  expect(limits.limits).toEqual(['limit-5h:2026-11-12', 'limit-week:1794373200000'])
  // A "new offer" pop-up is owed for today only.
  const today = readPopups(undefined, NOW).date
  expect(readPopups({ date: today, offerDue: true }, NOW).offerDue).toBe(true)
  expect(readPopups({ date: '2000-01-01', offerDue: true }, NOW).offerDue).toBe(false)
  expect(readPopups({ date: today, offerDue: 'yes' }, NOW).offerDue).toBe(false)

  expect(readPopups(undefined, NOW)).toEqual({ date: today, shown: {}, seen: [], events: [], newsSeq: null, limits: [], offerDue: false })
})

test('after Connect: reaching a limit with no prize waiting gives no mark and no pop-up; waiting earns nothing', () => {
  const chosen = pickMeter(readSaved(undefined, NOW), 'line42')
  const full = { percent: 100, resetMs: NOW + DAY }
  const none = takeBurnouts(chosen, full, full, NOW, { five: false, week: false })

  expect(none.popups).toEqual([])
  expect(none.saved.marksPending).toBe(chosen.marksPending)
  // The limit is still noted, so a prize arriving later in the period can show.
  expect(none.saved.burnFiveEarned).toBe(true)
  expect(none.saved.burnWeekUntil).toBe(NOW + DAY)
  expect(takeBurnouts(chosen, full, full, NOW, { five: true, week: false }).popups).toEqual([BURN_FIVE_POPUP])
  expect(takeBurnouts(chosen, full, full, NOW).popups).toEqual([BURN_FIVE_POPUP, BURN_WEEK_POPUP])

  const waited = addWait(chosen, 3 * MINUTE, [], false)
  expect(waited.minutes).toBe(3)
  expect(waited.finishEarned).toBe(false)
  expect(waited.marksPending).toBe(chosen.marksPending)
})

// ---------------------------------------------------------------- the looks and the words

const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)

  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)

  return (high + 0.05) / (low + 0.05)
}

test('looks: nine built in, each with its own colour, icon, emoji and pop-up line, readable on light and dark', () => {
  expect(Object.keys(LOOK_TEXT).sort()).toEqual([...EVENT_LOOKS].sort())

  const colours = EVENT_LOOKS.map(lookColour)
  const tiles = EVENT_LOOKS.map(lookTileSvg)

  expect(new Set(colours).size).toBe(9)
  expect(new Set(EVENT_LOOKS.map(look => LOOK_TEXT[look as keyof typeof LOOK_TEXT].emoji)).size).toBe(9)
  expect(new Set(EVENT_LOOKS.map(look => LOOK_TEXT[look as keyof typeof LOOK_TEXT].popup)).size).toBe(9)

  for (const [index, look] of EVENT_LOOKS.entries()) {
    const words = lookText(look)!

    // Text in the look's colour reads at 3:1 or better on a light and a dark panel.
    expect(contrast(colours[index], '#FFFFFF')).toBeGreaterThanOrEqual(3)
    expect(contrast(colours[index], '#1E1E1E')).toBeGreaterThanOrEqual(3)
    expect(tiles[index]).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="28" height="28" viewBox="0 0 28 28">/)
    expect(tiles[index]).toMatch(/<path|<circle/)
    expect(new Set(tiles).size).toBeGreaterThanOrEqual(8)
    expect(words.popup.startsWith(`${words.emoji} `)).toBe(true)
    expect(words.popup.endsWith(' · /pauzza')).toBe(true)
    expect(isBuiltInPopup(words.popup)).toBe(true)
  }

  // The fixed lines from the campaigns design.
  expect(LOOK_TEXT['black-friday'].popup).toBe('🖤 Black Friday deals are on · /pauzza')
  expect(LOOK_TEXT.sale.popup).toBe('🏷 Sale is on · /pauzza')
  // Unknown or inherited names are nothing.
  expect(lookText('constructor')).toBe(undefined)
  expect(lookText('__proto__')).toBe(undefined)
  expect(lookColour('toString')).toBe('#888888')
  expect(lookTileSvg('halloween')).not.toMatch(/<path/)
})

test('categories: each of the 24 has its own tile and colour; an unknown id gets the plain grey tile', () => {
  const colours = CATEGORIES_V2.map(drawerColour)
  const tiles = CATEGORIES_V2.map(iconTileSvg)
  const plain = iconTileSvg('unknown')

  expect(new Set(colours).size).toBe(24)
  expect(colours).not.toContain('#888888')
  expect(new Set(tiles).size).toBe(24)

  for (const tile of tiles) {
    expect(tile.length).toBeGreaterThan(plain.length)
  }

  expect(drawerColour('constructor')).toBe('#888888')
  // One emoji each, from the table the admin panel shows too.
  expect(Object.keys(CATEGORY_EMOJI)).toEqual([...CATEGORIES_V2])
  expect(new Set(Object.values(CATEGORY_EMOJI)).size).toBe(24)
  expect(categoryEmoji('constructor')).toBe('🏷')

  // The white icon reads at 3:1 or better on each tile's bottom colour. Food keeps its colour from
  // 0.20.2 (2.8:1), the one exception.
  expect(CATEGORIES_V2.filter(id => id !== 'food' && contrast('#FFFFFF', drawerColour(id)) < 3)).toEqual([])
})

test('words: every new line is built in, English only, and the pop-ups are on the built-in list', () => {
  const all = [...Object.values(SLOT_TEXT).map((item: any) => (typeof item === 'string' ? item : item('Black Friday', '1 Dec'))), NEWS_POPUP, UPDATE_POPUP, ...Object.values(LOOK_TEXT).flatMap(look => [look.name, look.popup])]

  expect(all.filter(item => GEORGIAN.test(item))).toEqual([])
  expect([NEWS_POPUP, UPDATE_POPUP, BURN_FIVE_POPUP, BURN_WEEK_POPUP, OFFER_POPUP].every(isBuiltInPopup)).toBe(true)
  expect(isBuiltInPopup(`${NEWS_POPUP} `)).toBe(false)
  expect(isBuiltInPopup('Black Friday deals are on · /pauzza')).toBe(false)
  // The limit-prize note says what pressing tells Pauzza, for each period.
  expect(SLOT_TEXT.fiveNote).toBe('Getting this code tells Pauzza you reached a usage limit today.')
  expect(SLOT_TEXT.weekNote).toBe('Getting this code tells Pauzza you reached a usage limit this week.')
  // The update words cover an update already downloaded and one that is not.
  expect(SLOT_TEXT.updateHint).toMatch(/\/reload-plugins/)
  expect(SLOT_TEXT.updateHint).toBe('A newer Pauzza is out. Type /reload-plugins. If nothing changes, update it in /plugin first.')
  expect(UPDATE_POPUP).toMatch(/\/reload-plugins/)
  expect(UPDATE_POPUP).toMatch(/\/plugin/)
  expect(SLOT_TEXT.autoUpdateHow).toBe('To switch them on: /plugin → Marketplaces → pauzza → Enable auto-update.')
  expect(Array.from(UPDATE_POPUP).length).toBeLessThanOrEqual(80)
})

// ---------------------------------------------------------------- the add-on, running

const PANE = {
  plugin: 'pauzza',
  component: 'Pane',
  requestId: 'pauzza-offers',
  props: { title: 'Pauzza', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const GIVEN = { status: 'given', termsVersion: TERMS_VERSION, wordingVersion: WORDING_VERSION, at: 0 }
const SAVED = { meter: 'hexdump', meterDisplay: 'always', welcomeEarned: true, installedAt: NOW - 30 * DAY }
// The practice list in offers.json: none of it may show after Connect.
const BUILT_IN = JSON.stringify({
  categories: [{ id: 'food', label: 'Food' }, { id: 'gadgets', label: 'Gadgets' }],
  offers: [{ id: 'test-pizza', brand: 'Test Pizza', text: '15% off a test pizza', code: 'TEST-0001', category: 'food', addedAt: '2026-11-01' }],
  rewards: [{ id: 'r1', minutes: 1, brand: 'Test Reward', text: 'A test reward', code: 'TEST-0002' }],
  milestones: [{ id: 'm1', minutes: 0.25, brand: 'Test Present', text: 'A test present', code: 'TEST-0003' }],
  dailyPresent: true,
  welcomeReward: { id: 'w', brand: 'Test Welcome', text: 'A test welcome', code: 'TEST-0004' },
  burnFive: { id: 'b5', brand: 'Test Lounge', text: 'A test lounge prize', code: 'TEST-0005' },
  burnWeek: { id: 'bw', brand: 'Test Week', text: 'A test week prize', code: 'TEST-0006' },
  goodPaceReward: { id: 'gp', brand: 'Test Pace', text: 'A test pace prize', code: 'TEST-0007' },
  finishReward: { id: 'f', brand: 'Test Finish', text: 'A test finish prize', code: 'TEST-0008' },
  drops: [{ id: 'd', brand: 'Test Drop', text: 'A test drop', code: 'TEST-0009', quantity: 5 }],
})
const CONNECTED = { status: 'connected', token: TOKEN, publicRef: REF, firstSeenAt: NOW - DAY, lastContactAt: NOW - DAY, versions: VERSIONS, at: NOW - DAY, withdrawal: null, history: [] }
// A list already received, so it is in hand from the first moment; the next fetch is hours away.
const WAIT = { lastAttemptAt: NOW - MINUTE, failures: 0, nextAt: NOW + 4 * HOUR }

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, text: typeof body === 'string' ? body : JSON.stringify(body), headers })
type Sent = { url: string; method: string; headers: Record<string, string>; body: string | undefined }

let lastClock: { settle: () => Promise<void> } | undefined
let claims = 0

async function engine(on: any, options: { now?: number; saved?: unknown; store?: Record<string, unknown>; data?: unknown; firstSeenAt?: number; connected?: boolean; docs?: Record<string, string> } = {}) {
  const key = await testKey(7)
  const clock = mock.clock(on, { now: options.now ?? NOW })
  const signed = options.data === undefined ? undefined : await signCatalogue(key, options.data)
  const store = new Map<string, unknown>([['saved', options.saved ?? SAVED], ['consent', GIVEN]])

  if (options.connected !== false) {
    store.set('connection', { ...CONNECTED, firstSeenAt: options.firstSeenAt ?? CONNECTED.firstSeenAt })
  }

  if (signed !== undefined) {
    store.set('catalogue', { text: signed, seq: (options.data as any).seq, format: 2 })
    store.set('fetch', WAIT)
  }

  for (const [name, value] of Object.entries(options.store ?? {})) {
    store.set(name, value)
  }

  const sent: Sent[] = []
  const toasts: string[] = []
  const lines: unknown[] = []
  let rateLimits: unknown[] = []
  const routes: Record<string, (request: Sent) => unknown> = {
    catalogue2: () => (signed === undefined ? reply(500, '') : reply(200, signed)),
    claim: () => {
      claims += 1
      const n = String(claims).padStart(4, '0')

      return reply(200, { claimId: `11111111-2222-4333-8444-55555555${n}`, code: `PAUZZA-${n}`, useBy: iso(NOW + 5 * DAY) })
    },
    withdraw: () => reply(200, { ok: true }),
  }

  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const name = e.path.split(/[\\/]/).at(-1) ?? ''

    if (name === 'release.json') {
      return { value: JSON.stringify({ testEndDate: '2026-12-31', catalogueKeys: { 'test-1': key.publicKey } }) }
    }

    if (options.docs !== undefined && Object.hasOwn(options.docs, name)) {
      return { value: options.docs[name] }
    }

    return { value: name.endsWith('.md') ? `DOC ${name}` : BUILT_IN }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits } }))
  on('session.measure', () => ({ changed: ['rateLimits'] }))
  on('ui.status', (_: unknown, e: any) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'pauzza' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('http.fetch', async (_: unknown, e: { url: string; init?: any }) => {
    const request = { url: e.url, method: e.init?.method ?? 'GET', headers: e.init?.headers ?? {}, body: e.init?.body }
    sent.push(request)
    const route = routes[e.url.slice(BASE_URL.length)]

    return { value: route === undefined ? reply(404, { error: 'unavailable' }) : await route(request) }
  })

  lastClock = clock
  const setLimits = (value: unknown[]) => {
    rateLimits = value
  }
  const sign = (data: unknown) => signCatalogue(key, data)

  return { clock, store, sent, toasts, lines, routes, setLimits, sign }
}

// The first look at the schedule is started, not awaited: let it finish.
const start = async ($: any) => {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (let i = 0; i < 3; i += 1) {
    await lastClock?.settle()
    await new Promise(resolve => setTimeout(resolve, 15))
  }

  await lastClock?.settle()
}
const measure = ($: any) => $.session.measure({ context: {}, rateLimits: [], changed: ['rateLimits'] })
const mount = ($: any, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ ...PANE, surface })
const closePane = ($: any) => $.command.run({ command: 'pauzza', args: '' })

async function press($: any, key: string, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await mount($, surface)
  const found = await ui.find({ key })

  if (found !== undefined) {
    await ui.press({ key })
  }

  await ui.unmount()

  return found !== undefined
}

async function has($: any, text: RegExp | string, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await mount($, surface)
  const found = await ui.find({ type: 'Text', text: typeof text === 'string' ? new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : text })
  await ui.unmount()

  return found !== undefined
}

async function texts($: any, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await mount($, surface)
  const found = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return found.map((item: any) => item.text)
}

async function hasKey($: any, key: string, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await mount($, surface)
  const found = await ui.find({ key })
  await ui.unmount()

  return found
}

const stage = (name: string, body: ($: any, on: any) => Promise<void>) => test(name, { timeoutMs: 180_000 }, body)
const PRACTICE = /^Test (?!codes · not real offers$)|Daily Drop|Limit Lounge/

stage('after Connect: no practice prizes anywhere, only the signed offers', async ($, on) => {
  const { toasts, setLimits, store } = await engine(on, { data: list() })
  setLimits([{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(NOW + 2 * HOUR) }, { kind: 'seven_day', percentUsed: 100, resetsAt: iso(NOW + 3 * DAY) }])

  await start($)
  await measure($)

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const key of ['drawer-mine', 'drawer-food', 'drawer-day', 'drawer-gadgets']) {
      await press($, key, surface)
      expect((await texts($, surface)).filter(item => PRACTICE.test(item))).toEqual([])
    }
  }

  // No Daily Drop, no practice categories: the signed list's food drawer only.
  expect(await hasKey($, 'drawer-day')).toBe(undefined)
  expect(await hasKey($, 'drawer-gadgets')).toBe(undefined)
  expect(await hasKey($, 'drawer-food')).toBeDefined()
  expect(await has($, CONNECT_TEXT.offersLabel)).toBe(true)
  expect(await has($, CONSENT_TEXT.samples)).toBe(false)
  // 100% on both limits with no prize offer: no prize, no pop-up, no mark for it.
  expect(toasts.filter(text => text === BURN_FIVE_POPUP || text === BURN_WEEK_POPUP)).toEqual([])
  expect(toasts).toEqual([OFFER_POPUP])
  expect((store.get('saved') as any).burnFiveEarned).toBe(true)
  expect(await has($, SLOT_TEXT.fivePrize)).toBe(false)
})

stage('after Connect with no list in hand: the calm "No offers right now", never the samples', async ($, on) => {
  const { routes } = await engine(on)
  routes.catalogue2 = () => reply(500, '')

  await start($)
  expect(await has($, CONNECT_TEXT.noOffers)).toBe(true)
  expect(await has($, CONSENT_TEXT.samples)).toBe(false)
  expect(await has($, SLOT_TEXT.offlineNoList)).toBe(true)
  expect(await hasKey($, 'drawer-food')).toBe(undefined)
  expect(await hasKey($, 'drawer-day')).toBe(undefined)
  expect((await texts($)).filter(item => PRACTICE.test(item))).toEqual([])
})

stage('a format 1 list saved by 0.20.2 is refused: no offers until the next list, whose own number counts', async ($, on) => {
  const key = await testKey(7)
  const old = await signCatalogue(key, { ...list({ seq: 40 }), v: 1, latestAddonVersion: undefined, events: undefined })
  const fresh = list({ seq: 2, offers: [offer('fresh-pizza')] })
  const { routes, sent, sign, clock, store } = await engine(on, { store: { catalogue: { text: old, seq: 40, etag: `"${'ab'.repeat(32)}"` }, fetch: WAIT } })
  routes.catalogue2 = () => reply(500, '')

  await start($)
  // Held, signed and in date, but format 1: refused, and nothing shows.
  expect(sent).toEqual([])
  expect(await has($, CONNECT_TEXT.noOffers)).toBe(true)
  expect(await hasKey($, 'drawer-food')).toBe(undefined)
  expect(await has($, /^Mock pizza$/)).toBe(false)

  // The next fetch: format 2, from the new address, with no tag from the old list.
  const text = await sign(fresh)
  routes.catalogue2 = () => reply(200, text)
  await clock.advance(5 * HOUR)
  expect(sent.map(item => item.url)).toEqual([`${BASE_URL}catalogue2`])
  expect(sent[0].headers).toEqual({})
  // Its number, 2, is below the old format 1 number, 40, and still counts.
  expect((store.get('catalogue') as any).text).toBe(text)
  expect((store.get('catalogue') as any).seq).toBe(2)
  expect((store.get('catalogue') as any).format).toBe(2)
  await press($, 'drawer-food')
  expect(await hasKey($, 'claim-fresh-pizza')).toBeDefined()
})

stage('the daily offer drawer: yesterday\'s until it closes, "Opens at 12:00", then today\'s with one pop-up', async ($, on) => {
  const { toasts, clock } = await engine(on, { data: list({ offers: [daily('yesterday', -1), daily('today', 0)] }) })

  await start($)
  expect((await hasKey($, 'drawer-day')).props.label).toBe('⭐ Daily offer')
  await press($, 'drawer-day')
  expect(await hasKey($, 'claim-yesterday')).toBeDefined()
  expect(await hasKey($, 'claim-today')).toBe(undefined)
  expect(await has($, SLOT_TEXT.dailyNote('12:00'))).toBe(true)
  expect(toasts).toEqual([OFFER_POPUP])

  // 11:59 Tbilisi: yesterday's has closed; today's opens at 12:00.
  await clock.advance(noon(0) - MINUTE - NOW)
  expect(await has($, SLOT_TEXT.dailyOpensAt('12:00'))).toBe(true)
  expect(await hasKey($, 'claim-yesterday')).toBe(undefined)

  await clock.advance(2 * MINUTE)
  await measure($)
  expect(await hasKey($, 'claim-today')).toBeDefined()
  expect(toasts).toEqual([OFFER_POPUP, OFFER_POPUP])
  expect(toasts.every(isBuiltInPopup)).toBe(true)

  // Claimed: the code shows in the drawer until the offer closes.
  await press($, 'claim-today')
  expect(await has($, /^PAUZZA-\d{4}$/)).toBe(true)
})

stage('the daily offer drawer is hidden on a day with no daily offer', async ($, on) => {
  await engine(on, { data: list({ offers: [offer('pizza'), daily('tomorrow', 1)] }) })

  await start($)
  expect(await hasKey($, 'drawer-day')).toBe(undefined)
  expect(await hasKey($, 'drawer-food')).toBeDefined()
  expect((await texts($)).filter(item => /Daily/.test(item))).toEqual([])
})

const LIMITS = list({ offers: [limit('lounge-late', 'limit-5h', HOUR), limit('lounge-early', 'limit-5h', 3 * HOUR), limit('lounge-a', 'limit-5h', HOUR), limit('week', 'limit-week')], popupRules: [RULES.daily, RULES.limit] })
const FULL_FIVE = [{ kind: 'five_hour', percentUsed: 100, resetsAt: iso(NOW + 2 * HOUR) }]

stage('limit prizes: under Mine only once the limit is reached, the first one, with its note and one pop-up', async ($, on) => {
  const { toasts, setLimits, sent } = await engine(on, { data: LIMITS })

  setLimits([{ kind: 'five_hour', percentUsed: 80, resetsAt: iso(NOW + 2 * HOUR) }])
  await start($)
  expect(await hasKey($, 'claim-lounge-early')).toBe(undefined)
  expect(await has($, SLOT_TEXT.fivePrize)).toBe(false)
  // Limit prizes are never announced as a "new offer".
  expect(toasts).toEqual([])

  setLimits(FULL_FIVE)
  await measure($)
  expect(toasts).toEqual([BURN_FIVE_POPUP])
  expect(await hasKey($, 'claim-lounge-early')).toBeDefined()
  expect(await hasKey($, 'claim-lounge-a')).toBe(undefined)
  expect(await hasKey($, 'claim-week')).toBe(undefined)
  expect(await has($, SLOT_TEXT.fivePrize)).toBe(true)
  expect(await has($, SLOT_TEXT.fiveNote)).toBe(true)
  expect(sent).toEqual([])

  // Claimed: the code goes under Mine, and no second prize appears today.
  await press($, 'claim-lounge-early')
  expect(sent.map(item => item.url)).toEqual([`${BASE_URL}claim`])
  expect(JSON.parse(sent[0].body!).campaignId).toBe('lounge-early-c1')
  expect(await has($, /^PAUZZA-\d{4}$/)).toBe(true)
  expect(await hasKey($, 'claim-lounge-a')).toBe(undefined)
  expect(await has($, SLOT_TEXT.fivePrize)).toBe(false)
  await measure($)
  expect(toasts).toEqual([BURN_FIVE_POPUP])
})

stage('limit prizes: one with no codes left gives its place to the next', async ($, on) => {
  const { setLimits, routes } = await engine(on, { data: LIMITS })
  setLimits(FULL_FIVE)
  routes.claim = () => reply(404, { error: 'unavailable' })

  await start($)
  await press($, 'claim-lounge-early')
  expect(await hasKey($, 'claim-lounge-early')).toBe(undefined)
  expect(await hasKey($, 'claim-lounge-a')).toBeDefined()
  expect(await has($, SLOT_TEXT.fiveNote)).toBe(true)
})

stage('limit prizes: when every prize has run out, nothing appears: no dimmed row, no mark, no pop-up', async ($, on) => {
  const { setLimits, routes, toasts, store } = await engine(on, { data: { ...LIMITS, offers: [limit('only', 'limit-5h', 3 * HOUR)] } })
  routes.claim = () => reply(404, { error: 'unavailable' })
  setLimits([{ kind: 'five_hour', percentUsed: 80, resetsAt: iso(NOW + 2 * HOUR) }])

  await start($)
  setLimits(FULL_FIVE)
  await measure($)
  expect(toasts).toEqual([BURN_FIVE_POPUP])
  const marks = (store.get('saved') as any).marksPending
  await press($, 'claim-only')
  expect(await hasKey($, 'claim-only')).toBe(undefined)
  expect(await has($, CONNECT_TEXT.noneLeft)).toBe(false)
  expect(await has($, SLOT_TEXT.fivePrize)).toBe(false)
  expect(await has($, SLOT_TEXT.fiveNote)).toBe(false)
  await measure($)
  expect(toasts).toEqual([BURN_FIVE_POPUP])
  expect((store.get('saved') as any).marksPending).toBe(marks)
})

stage('limit prizes: a limit reached again with none left gives no mark and no pop-up', async ($, on) => {
  const { setLimits, routes, toasts, store } = await engine(on, { data: { ...LIMITS, offers: [limit('only', 'limit-week', 3 * HOUR)] } })
  routes.claim = () => reply(404, { error: 'unavailable' })
  setLimits([{ kind: 'seven_day', percentUsed: 100, resetsAt: iso(NOW + 3 * DAY) }])

  await start($)
  await press($, 'claim-only')
  // A new weekly window, reached again at once: the slot has none left.
  store.set('saved', { ...(store.get('saved') as any), burnWeekUntil: NOW - MINUTE })
  const marks = (store.get('saved') as any).marksPending
  await measure($)
  expect(toasts).toEqual([BURN_WEEK_POPUP])
  expect((store.get('saved') as any).marksPending).toBe(marks)
  expect(await hasKey($, 'claim-only')).toBe(undefined)
})

stage('limit prizes: the weekly one says "this week", with its own pop-up', async ($, on) => {
  const { toasts, setLimits } = await engine(on, { data: LIMITS })
  setLimits([{ kind: 'seven_day', percentUsed: 100, resetsAt: iso(NOW + 3 * DAY) }])

  await start($)
  expect(await hasKey($, 'claim-week')).toBeDefined()
  expect(await has($, SLOT_TEXT.weekPrize)).toBe(true)
  expect(await has($, SLOT_TEXT.weekNote)).toBe(true)
  expect(await hasKey($, 'claim-lounge-early')).toBe(undefined)
  expect(toasts).toEqual([BURN_WEEK_POPUP])
})

stage('limit prizes: without the signed limit rule the prize waits and no pop-up shows', async ($, on) => {
  const { toasts, setLimits } = await engine(on, { data: { ...LIMITS, popupRules: [RULES.daily] } })
  setLimits(FULL_FIVE)

  await start($)
  expect(await hasKey($, 'claim-lounge-early')).toBeDefined()
  expect(toasts).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) {
  stage(`limit prizes (${surface}): never a shop link, which would tell the shop a limit was reached; other offers keep theirs, opening the signed address`, async ($, on) => {
    const shop = { link: 'https://shop.example/deal' }
    const data = { ...LIMITS, allowedLinkHosts: ['shop.example'], offers: [{ ...limit('lounge', 'limit-5h'), ...shop }, { ...offer('pizza'), ...shop }] }
    const { setLimits } = await engine(on, { data })
    setLimits(FULL_FIVE)

    const links = async () => {
      const ui = await mount($, surface)
      const hrefs = (await ui.findAll({ type: 'Link' })).map((item: any) => item.props.href)
      const drawn = JSON.stringify((await ui.findAll({})).map((item: any) => [item.text, item.props]))
      await ui.unmount()

      return { hrefs, drawn }
    }

    await start($)
    expect(await hasKey($, 'claim-lounge', surface)).toBeDefined()
    // Mine is open with the prize in it: no link, and no shop name.
    const mine = await links()
    expect(mine.hrefs).toEqual([])
    expect(mine.drawn).not.toMatch(/\/o\/lounge|shop\.example/)

    if (surface === 'desktop') {
      await press($, 'drawer-food', surface)
      expect((await links()).hrefs).toEqual(['https://shop.example/deal'])
    }
  })
}

stage('limit prizes: no pop-up for someone who turned pop-ups off, but the prize still waits', async ($, on) => {
  const { toasts, setLimits } = await engine(on, { data: LIMITS, saved: { ...SAVED, popupsOn: false } })
  setLimits(FULL_FIVE)

  await start($)
  expect(toasts).toEqual([])
  expect(await hasKey($, 'claim-lounge-early')).toBeDefined()
})

stage('presents: a ladder by time since connecting; the bar counts to the next; no "new offer" pop-up', async ($, on) => {
  const { toasts, clock, lines } = await engine(on, { firstSeenAt: NOW - 30 * MINUTE, data: list({ offers: [present('p-10m', 600), present('p-1h', 3600), present('p-3h', 3 * 3600)] }) })

  await start($)
  expect(await hasKey($, 'claim-p-10m')).toBeDefined()
  expect(await hasKey($, 'claim-p-1h')).toBe(undefined)
  expect(await has($, SLOT_TEXT.present)).toBe(true)
  expect(await has($, /^Next present in 30 min$/)).toBe(true)
  expect(lines.at(-1)).toMatch(/→🎁 30m/)
  expect(toasts).toEqual([])

  await clock.advance(31 * MINUTE)
  expect(await hasKey($, 'claim-p-1h')).toBeDefined()
  // The next step, 3 hours after connecting, is 1 h 59 min away.
  expect(await has($, /^Next present in 2 h$/)).toBe(true)
  expect(toasts).toEqual([])
})

stage('presents: with none in the list there is no present bar', async ($, on) => {
  await engine(on, { firstSeenAt: NOW - 30 * MINUTE, data: list() })

  await start($)
  expect((await texts($)).filter(item => /Next present/.test(item))).toEqual([])
})

const MANY = list({
  categories: [{ id: 'food', label: 'Food' }, { id: 'beauty', label: 'Beauty' }, { id: 'custom-1', label: 'Wellness' }, { id: 'travel', label: 'Travel' }],
  offers: [offer('pizza'), offer('lipstick', { category: 'beauty' }), offer('yoga', { category: 'custom-1' })],
})

for (const surface of ['terminal', 'desktop'] as const) {
  stage(`categories (${surface}): a new and an owner-named one each get a drawer with its own tile or emoji and the signed name; an empty one never shows`, async ($, on) => {
    await engine(on, { data: MANY })

    await start($)
    const ui = await mount($, surface)

    expect((await ui.find({ key: 'drawer-beauty' })).props.label).toBe(surface === 'terminal' ? '💄 Beauty' : 'Beauty')
    expect((await ui.find({ key: 'drawer-custom-1' })).props.label).toBe(surface === 'terminal' ? '⚪ Wellness' : 'Wellness')
    expect(await ui.find({ key: 'drawer-travel' })).toBe(undefined)

    if (surface === 'desktop') {
      const sources = (await ui.findAll({ type: 'Svg' })).map((svg: any) => svg.props.source)

      expect(sources).toContain(iconTileSvg('beauty'))
      expect(sources).toContain(iconTileSvg('custom-1'))
    }

    await ui.unmount()
    await press($, 'drawer-custom-1', surface)
    expect(await hasKey($, 'claim-yoga', surface)).toBeDefined()
    expect(await hasKey($, 'claim-lipstick', surface)).toBe(undefined)
  })
}

const BF = event('bf', NOW - HOUR, NOW + 5 * DAY)
const CAMPAIGN = list({ events: [BF], offers: [offer('pizza'), offer('bf-pizza', { eventId: 'bf' }), offer('bf-juice', { eventId: 'bf', category: 'drinks' })], popupRules: [RULES.daily, RULES.event] })

for (const surface of ['terminal', 'desktop'] as const) {
  stage(`a running campaign (${surface}): its own drawer at the top, open, with its look; its offers leave their category`, async ($, on) => {
    const { toasts } = await engine(on, { data: CAMPAIGN })

    await start($)
    const ui = await mount($, surface)
    const drawer = await ui.find({ key: 'drawer-campaign' })

    expect(drawer.props.label).toBe(surface === 'terminal' ? '🖤 Black Friday · until 17 Nov' : 'Black Friday · until 17 Nov')
    // Open by default: its offers are in view without a press.
    expect(await ui.find({ key: 'claim-bf-pizza' })).toBeDefined()
    expect(await ui.find({ key: 'claim-bf-juice' })).toBeDefined()

    if (surface === 'desktop') {
      const sources = (await ui.findAll({ type: 'Svg' })).map((svg: any) => svg.props.source)
      expect(sources).toContain(lookTileSvg('black-friday'))
    }

    await ui.unmount()
    // The campaign's offers are not in their categories while it runs.
    await press($, 'drawer-food', surface)
    expect(await hasKey($, 'claim-pizza', surface)).toBeDefined()
    expect(await hasKey($, 'claim-bf-pizza', surface)).toBe(undefined)
    expect(await hasKey($, 'drawer-drinks', surface)).toBe(undefined)
    // One pop-up, the look's own line, and not the "new offer" line beside it.
    expect(toasts).toEqual([LOOK_TEXT['black-friday'].popup])
    // Opening the panel again refreshes: the "new offer" line had to wait its turn, and comes now.
    await closePane($)
    expect(await hasKey($, 'claim-bf-pizza', surface)).toBeDefined()
    expect(toasts).toEqual([LOOK_TEXT['black-friday'].popup, OFFER_POPUP])
  })
}

stage('a campaign: before it starts its offers are in their category; at its start, one pop-up; after its end, back again', async ($, on) => {
  const later = { ...CAMPAIGN, events: [event('bf', NOW + HOUR, NOW + 3 * HOUR)] }
  const { toasts, clock } = await engine(on, { data: later })

  await start($)
  expect(await hasKey($, 'drawer-campaign')).toBe(undefined)
  await press($, 'drawer-food')
  expect(await hasKey($, 'claim-bf-pizza')).toBeDefined()
  expect(toasts).toEqual([OFFER_POPUP])

  await clock.advance(HOUR + 2 * MINUTE)
  expect(await hasKey($, 'drawer-campaign')).toBeDefined()
  expect(toasts).toEqual([OFFER_POPUP, LOOK_TEXT['black-friday'].popup])
  await press($, 'drawer-food')
  expect(await hasKey($, 'claim-bf-pizza')).toBe(undefined)

  await clock.advance(2 * HOUR)
  expect(await hasKey($, 'drawer-campaign')).toBe(undefined)
  // Food is still the open drawer, and the offer is back in it.
  expect(await hasKey($, 'claim-bf-pizza')).toBeDefined()
  expect(toasts).toEqual([OFFER_POPUP, LOOK_TEXT['black-friday'].popup])
})

stage('a campaign with every offer claimed: "You have seen all Black Friday offers"; codes stay under Mine', async ($, on) => {
  const one = { ...CAMPAIGN, offers: [offer('bf-pizza', { eventId: 'bf' })] }
  await engine(on, { data: one })

  await start($)
  await press($, 'claim-bf-pizza')
  expect(await hasKey($, 'claim-bf-pizza')).toBe(undefined)
  expect(await has($, SLOT_TEXT.campaignSeenAll('Black Friday'))).toBe(true)
  expect(await hasKey($, 'drawer-campaign')).toBeDefined()
  await press($, 'drawer-mine')
  expect(await has($, /^Mock bf-pizza$/)).toBe(true)
})

stage('a campaign start pop-up: none for someone who turned pop-ups off', async ($, on) => {
  const { toasts } = await engine(on, { data: CAMPAIGN, saved: { ...SAVED, popupsOn: false } })

  await start($)
  expect(toasts).toEqual([])
  expect(await hasKey($, 'drawer-campaign')).toBeDefined()
})

stage('a campaign start pop-up: none without the signed event rule', async ($, on) => {
  const { toasts } = await engine(on, { data: { ...CAMPAIGN, popupRules: [RULES.daily] } })

  await start($)
  // The "new offer" line takes its turn instead.
  expect(toasts).toEqual([OFFER_POPUP])
  expect(await hasKey($, 'drawer-campaign')).toBeDefined()
})

stage('a campaign with no open offer yet: its drawer shows, and no start pop-up', async ($, on) => {
  const closed = { ...CAMPAIGN, offers: [offer('bf-pizza', { eventId: 'bf' }, { opensAt: iso(NOW + 3 * HOUR) })] }
  const { toasts } = await engine(on, { data: closed })

  await start($)
  expect(toasts).toEqual([])
  expect(await hasKey($, 'drawer-campaign')).toBeDefined()
  expect(await hasKey($, 'claim-bf-pizza')).toBe(undefined)
})

stage('the news pop-up: once for a list number with a news rule, again for a new one, never with pop-ups off', async ($, on) => {
  const { toasts, routes, sign, clock } = await engine(on, { data: list({ offers: [], categories: [], popupRules: [RULES.news] }) })

  await start($)
  expect(toasts).toEqual([NEWS_POPUP])
  await closePane($)
  await clock.advance(HOUR)
  expect(toasts).toEqual([NEWS_POPUP])

  const second = await sign(list({ seq: 2, offers: [], categories: [], popupRules: [RULES.news] }))
  routes.catalogue2 = () => reply(200, second)
  await clock.advance(5 * HOUR)
  await measure($)
  expect(toasts).toEqual([NEWS_POPUP, NEWS_POPUP])
})

stage('the news pop-up: none for someone who turned pop-ups off', async ($, on) => {
  const { toasts } = await engine(on, { data: list({ popupRules: [RULES.news] }), saved: { ...SAVED, popupsOn: false } })

  await start($)
  expect(toasts).toEqual([])
})

stage('the news pop-up: none without a news rule', async ($, on) => {
  const { toasts, clock } = await engine(on, { data: list({ offers: [], categories: [], popupRules: [RULES.daily] }) })

  await start($)
  await clock.advance(10 * MINUTE)
  expect(toasts).toEqual([])
})

stage('the update hint and pop-up: a newer signed version shows one line and one pop-up, remembered', async ($, on) => {
  const { toasts, store, routes, sign, clock } = await engine(on, { data: list({ latestAddonVersion: '0.22.0', offers: [], categories: [] }) })

  await start($)
  expect(await has($, SLOT_TEXT.updateHint)).toBe(true)
  expect(toasts).toEqual([UPDATE_POPUP])
  expect((store.get('saved') as any).updateAnnounced).toBe('0.22.0')
  await closePane($)
  await clock.advance(2 * HOUR)
  expect(toasts).toEqual([UPDATE_POPUP])

  // A later version is announced once more.
  const next = await sign(list({ seq: 2, latestAddonVersion: '0.23.0', offers: [], categories: [] }))
  routes.catalogue2 = () => reply(200, next)
  await clock.advance(5 * HOUR)
  await measure($)
  expect(toasts).toEqual([UPDATE_POPUP, UPDATE_POPUP])
  expect((store.get('saved') as any).updateAnnounced).toBe('0.23.0')
  expect(toasts.every(isBuiltInPopup)).toBe(true)
})

stage('the update: the saved record remembers it across sessions', async ($, on) => {
  const { toasts } = await engine(on, { data: list({ latestAddonVersion: '0.22.0' }), saved: { ...SAVED, updateAnnounced: '0.22.0' } })

  await start($)
  expect(toasts).toEqual([OFFER_POPUP])
  expect(await has($, SLOT_TEXT.updateHint)).toBe(true)
})

stage('the update: with pop-ups off the hint shows and no pop-up', async ($, on) => {
  const { toasts } = await engine(on, { data: list({ latestAddonVersion: '0.22.0' }), saved: { ...SAVED, popupsOn: false } })

  await start($)
  expect(toasts).toEqual([])
  expect(await has($, SLOT_TEXT.updateHint)).toBe(true)
})

stage('the update: none for this version or an older one; shown too when the offers are paused', async ($, on) => {
  const { toasts, routes, sign, clock } = await engine(on, { data: list({ latestAddonVersion: ADDON_VERSION }) })

  await start($)
  expect(await has($, SLOT_TEXT.updateHint)).toBe(false)
  expect(toasts).toEqual([OFFER_POPUP])

  // A minimum above this version hides the offers; the hint says how to update.
  const paused = await sign(list({ seq: 2, minAddonVersion: '0.22.0', latestAddonVersion: '0.22.0' }))
  routes.catalogue2 = () => reply(200, paused)
  await clock.advance(5 * HOUR)
  await measure($)
  expect(await has($, CONNECT_TEXT.noOffers)).toBe(true)
  expect(await has($, SLOT_TEXT.updateHint)).toBe(true)
  expect(toasts).toEqual([OFFER_POPUP, UPDATE_POPUP])
})

for (const connected of [true, false]) {
  stage(`settings: "Automatic updates" says how to switch it on and that Pauzza cannot (${connected ? 'connected' : 'before Connect'})`, async ($, on) => {
    const { sent, store } = await engine(on, { connected, data: connected ? list() : undefined })

    await start($)
    sent.length = 0
    const before = JSON.stringify([...store.entries()])
    await press($, 'settings-toggle')
    const shown = await texts($)

    expect(shown).toContain(SLOT_TEXT.autoUpdateTitle)
    expect(shown).toContain(SLOT_TEXT.autoUpdateHow)
    expect(shown).toContain(SLOT_TEXT.autoUpdateOnlyYou)
    // Words only: no switch, and nothing is written or sent.
    const ui = await mount($)
    const buttons = (await ui.findAll({})).filter((item: any) => typeof item.props?.label === 'string' && /update/i.test(item.props.label))
    await ui.unmount()
    expect(buttons).toEqual([])
    expect(JSON.stringify([...store.entries()])).toBe(before)
    expect(sent).toEqual([])
  })
}

stage('before Connect nothing changes: the practice Daily Drop and samples, no campaign, no slot', async ($, on) => {
  const { sent } = await engine(on, { connected: false })

  await start($)
  expect(await has($, CONSENT_TEXT.samples)).toBe(true)
  expect((await hasKey($, 'drawer-day')).props.label).toBe('⭐ Daily Drop')
  expect(await hasKey($, 'drawer-campaign')).toBe(undefined)
  expect(sent).toEqual([])
})

const EVERYTHING = list({
  latestAddonVersion: '0.22.0',
  events: [BF],
  offers: [offer('pizza'), offer('bf-pizza', { eventId: 'bf' }), limit('lounge', 'limit-5h')],
  popupRules: [RULES.daily, RULES.limit, RULES.event, RULES.news],
})

stage('pop-ups: at most one at a time, by priority: limit prize, campaign, new offer, news, update; none is lost', async ($, on) => {
  const { toasts, setLimits } = await engine(on, { data: EVERYTHING })
  setLimits(FULL_FIVE)

  await start($)
  expect(toasts).toEqual([BURN_FIVE_POPUP])

  for (const next of [LOOK_TEXT['black-friday'].popup, OFFER_POPUP, NEWS_POPUP, UPDATE_POPUP]) {
    const before = toasts.length
    await measure($)
    expect(toasts.length).toBe(before + 1)
    expect(toasts.at(-1)).toBe(next)
  }

  // All shown: nothing more.
  await measure($)
  await measure($)
  expect(toasts).toEqual([BURN_FIVE_POPUP, LOOK_TEXT['black-friday'].popup, OFFER_POPUP, NEWS_POPUP, UPDATE_POPUP])
  expect(toasts.every(isBuiltInPopup)).toBe(true)
})

stage('pop-ups: owed ones wait while pop-ups are off, and come one at a time once they are on again', async ($, on) => {
  const { toasts, store } = await engine(on, { data: list({ latestAddonVersion: '0.22.0', popupRules: [RULES.daily, RULES.news] }), saved: { ...SAVED, popupsOn: false } })

  await start($)
  await measure($)
  expect(toasts).toEqual([])

  store.set('saved', { ...(store.get('saved') as any), popupsOn: true })
  await measure($)
  await measure($)
  await measure($)
  await measure($)
  expect(toasts).toEqual([OFFER_POPUP, NEWS_POPUP, UPDATE_POPUP])
})

stage('pop-ups: none at all before a meter is chosen', async ($, on) => {
  const { toasts, setLimits } = await engine(on, { data: EVERYTHING, saved: { meterDisplay: 'always', installedAt: NOW - 30 * DAY } })
  setLimits(FULL_FIVE)

  await start($)
  await measure($)
  await measure($)
  expect(toasts).toEqual([])
})

stage('documents: the release check\'s markers never reach the reader', async ($, on) => {
  await engine(on, { connected: false, docs: { 'TERMS.md': '# Terms\n\n- This is a free test version. <!-- REHEARSAL-WORDING -->\n- More.' } })

  await start($)
  await press($, 'settings-toggle')
  await press($, 'open-terms')
  const ui = await mount($)
  const text = (await ui.find({ key: 'document-text' }))?.props.text
  await ui.unmount()
  expect(text).toBe('# Terms\n\n- This is a free test version.\n- More.')
})
