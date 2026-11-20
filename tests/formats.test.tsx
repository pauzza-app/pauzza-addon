// Format 2 of the signed list: slots and campaigns (events). The same cases as
// the server's own check in server/test/catalogue.test.ts; keep the two in step.

import { expect, test } from 'claude-code/testing'

import { acceptCatalogue, CATEGORIES_V2, EVENT_LOOKS, reviewText, validateCatalogue, webAddress } from '../hooks/catalogue'
import { signCatalogue, testKey } from './signing'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 12, 9, 0)
const iso = (ms: number) => new Date(ms).toISOString()

// 12:00 Tbilisi (UTC+4) is 08:00 UTC, `days` days after NOW's date.
const noon = (days: number) => Date.UTC(2026, 10, 12 + days, 8, 0)

// Written as escapes, so this file holds no character of another script.
const GEORGIAN = '\u10E4\u10E0\u10D0\u10D8\u10D3\u10D4\u10D8'

// Format 2 lists carry no merchant, code type or budget, only the sealed fingerprint of them (the
// server checks it; the add-on checks only its shape).
const DIGEST = 'ab'.repeat(32)
// A format 2 campaign and offer: no merchant, code type or budget.
const campaign = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  opensAt: iso(NOW - HOUR),
  claimBy: iso(NOW + 2 * DAY),
  useBy: iso(NOW + 9 * DAY),
  minInstallAgeSeconds: 0,
  ...fields,
})
const offer = (id: string, fields: Record<string, unknown> = {}, campaignFields: Record<string, unknown> = {}) => ({
  id,
  brand: 'Mock Pizza',
  text: '15% off a mock pizza',
  category: 'food',
  campaign: campaign(`${id}-c1`, campaignFields),
  ...fields,
})
// A format 1 offer, exactly as 0.20.2 reads it: with the merchant, the code type and both budgets.
const offerOne = (id: string, fields: Record<string, unknown> = {}) => ({
  ...offer(id),
  merchantId: 'mock',
  campaign: { ...campaign(`${id}-c1`), codeModel: 'list', hourlyBudget: 5, totalBudget: 5 },
  ...fields,
})
const daily = (id: string, days: number, campaignFields: Record<string, unknown> = {}) =>
  offer(id, { slot: 'daily' }, { opensAt: iso(noon(days)), claimBy: iso(noon(days) + DAY - MINUTE), ...campaignFields })
const event = (id: string, startsAt: number, endsAt: number, fields: Record<string, unknown> = {}) => ({
  id,
  name: 'Black Friday',
  startsAt: iso(startsAt),
  endsAt: iso(endsAt),
  look: 'black-friday',
  ...fields,
})

const formatOne = (fields: Record<string, unknown> = {}): any => ({
  v: 1,
  seq: 1,
  issuedAt: iso(NOW - MINUTE),
  expiresAt: iso(NOW + 10 * DAY),
  minAddonVersion: '0.20.0',
  allowedLinkHosts: ['shop.example'],
  categories: [{ id: 'food', label: 'Food' }],
  offers: [offerOne('mock-pizza')],
  schedule: { timeZone: 'Asia/Tbilisi', dailyOfferOpens: '12:00', firstPresentAfterSeconds: 15 },
  popupRules: [{ id: 'daily', template: 'daily-offer', maxPerDay: 1 }],
  ...fields,
})

const formatTwo = (fields: Record<string, unknown> = {}): any => ({
  ...formatOne(),
  v: 2,
  latestAddonVersion: '0.21.0',
  events: [
    event('black-friday', NOW - HOUR, NOW + 5 * DAY),
    event('new-year', NOW + 5 * DAY, NOW + 20 * DAY, { name: 'New Year', look: 'new-year' }),
  ],
  offers: [
    offer('plain'),
    daily('daily-1', 1),
    daily('daily-2', 2),
    offer('lounge-5h', { slot: 'limit-5h' }),
    offer('lounge-week', { slot: 'limit-week' }),
    offer('present', { slot: 'present' }, { minInstallAgeSeconds: 60 }),
    offer('bf-pizza', { eventId: 'black-friday', link: 'https://shop.example/bf' }),
  ],
  popupRules: [
    { id: 'daily', template: 'daily-offer', maxPerDay: 1 },
    { id: 'limit', template: 'limit-lounge', maxPerDay: 2 },
    { id: 'event', template: 'event-start', maxPerDay: 1 },
  ],
  schedule: { dailyOfferOpens: '12:00' },
  privateDigest: DIGEST,
  ...fields,
})

const errorsOf = (data: unknown): string => {
  const result = validateCatalogue(data)

  return result.ok ? '' : result.errors.join('\n')
}

const accept = async (data: unknown, over: Record<string, unknown> = {}) => {
  const key = await testKey(7)

  return acceptCatalogue(await signCatalogue(key, data), { pinnedKeys: { 'test-1': key.publicKey }, lastSeq: 0, now: NOW, addonVersion: '0.21.0', ...over })
}

test('format 2: a good list with each slot and an event passes, and a signed one is accepted', async () => {
  expect(errorsOf(formatTwo())).toBe('')
  expect(EVENT_LOOKS).toEqual(['sale', 'black-friday', 'new-year', 'valentine', 'summer', 'back-to-school', 'special', 'spotlight', 'fresh'])

  const news = formatTwo()
  news.popupRules.push({ id: 'news', template: 'news', maxPerDay: 1 })

  expect(errorsOf(news)).toBe('')

  for (const look of EVENT_LOOKS) {
    const list = formatTwo()
    list.events[0].look = look

    expect(validateCatalogue(list).ok).toBe(true)
  }

  const result = await accept(formatTwo(), { format: 2 })

  expect(result.ok).toBe(true)
  expect(result.ok && result.catalogue.v).toBe(2)

  if (result.ok && result.catalogue.v === 2) {
    expect(result.catalogue.events.length).toBe(2)
    expect(result.catalogue.offers.map(item => item.slot ?? item.eventId ?? '-')).toEqual(['-', 'daily', 'daily', 'limit-5h', 'limit-week', 'present', 'black-friday'])
  }
})

test('format 2: the add-on asks for format 2 and refuses a format 1 list as "wrong format"', async () => {
  expect(await accept(formatOne(), { format: 2 })).toEqual({ ok: false, reason: 'wrong format' })
  // Any other value of v is not a format at all: the shape check refuses it.
  expect(await accept({ ...formatTwo(), v: 3 }, { format: 2 })).toEqual({ ok: false, reason: 'schema: catalogue: unknown field' })
  expect(await accept(formatOne({ v: '1' }), { format: 1 })).toEqual({ ok: false, reason: 'schema: v must be 1 or 2' })
  expect((await accept(formatTwo(), { format: 2 })).ok).toBe(true)

  // The format must be named (0.21.0): with none, or an unknown one, every list is refused.
  expect(await accept(formatTwo())).toEqual({ ok: false, reason: 'wrong format' })
  expect(await accept(formatOne())).toEqual({ ok: false, reason: 'wrong format' })
  expect(await accept({ ...formatTwo(), v: 3 })).toEqual({ ok: false, reason: 'wrong format' })
  expect(await accept(formatTwo(), { format: 3 })).toEqual({ ok: false, reason: 'wrong format' })
  // Format 1 is still checked exactly when asked for, as the server's check does.
  expect(await accept(formatTwo(), { format: 1 })).toEqual({ ok: false, reason: 'wrong format' })
  expect((await accept(formatOne(), { format: 1 })).ok).toBe(true)

  // The pure check takes either format.
  expect(validateCatalogue(formatOne()).ok).toBe(true)
  expect(validateCatalogue(formatTwo()).ok).toBe(true)
})

const BROKEN: Record<string, [(list: any) => void, RegExp]> = {
  'no latestAddonVersion': [list => { delete list.latestAddonVersion }, /catalogue: missing latestAddonVersion/],
  'latestAddonVersion not x.y.z': [list => { list.latestAddonVersion = '0.21' }, /latestAddonVersion must be x.y.z/],
  'no events': [list => { delete list.events }, /catalogue: missing events/],
  'events not a list': [list => { list.events = {} }, /events must be a list of at most 3/],
  'four events': [list => { list.events = [0, 1, 2, 3].map(i => event(`e${i}`, NOW + i * DAY, NOW + (i + 1) * DAY)) }, /events must be a list of at most 3/],
  'event not an object': [list => { list.events[0] = 'black-friday' }, /events\[0\]: not an object/],
  'event missing a key': [list => { delete list.events[0].look }, /events\[0\]: missing look/],
  'event bad id': [list => { list.events[0].id = 'Black Friday' }, /events\[0\]: bad or repeated id/],
  'event repeated id': [list => { list.events[1].id = 'black-friday' }, /events\[1\]: bad or repeated id/],
  'event name too long': [list => { list.events[0].name = 'x'.repeat(25) }, /events\[0\]: name has characters or length that are not allowed/],
  'event name empty': [list => { list.events[0].name = '' }, /events\[0\]: name has characters/],
  'event name hidden character': [list => { list.events[0].name = 'Black\u200BFriday' }, /events\[0\]: name has characters/],
  'event name with surrounding space': [list => { list.events[0].name = ' Black Friday' }, /events\[0\]: name has characters/],
  'event name mixes scripts': [list => { list.events[0].name = `Black ${GEORGIAN}` }, /events\[0\]: name has characters/],
  'event startsAt not a timestamp': [list => { list.events[0].startsAt = '2026-11-27' }, /events\[0\].startsAt: not a UTC timestamp/],
  'event endsAt not UTC': [list => { list.events[0].endsAt = '2026-11-27T10:00:00+04:00' }, /events\[0\].endsAt: not a UTC timestamp/],
  'event ends when it starts': [list => { list.events[0].endsAt = list.events[0].startsAt }, /events\[0\]: needs startsAt < endsAt/],
  'event ends before it starts': [list => { list.events[0].endsAt = iso(NOW - 2 * HOUR) }, /events\[0\]: needs startsAt < endsAt/],
  'event 62 days and 1 ms': [list => { list.events = [event('long', NOW, NOW + 62 * DAY + 1)]; list.offers.pop() }, /events\[0\]: longer than 62 days/],
  'event unknown look': [list => { list.events[0].look = 'halloween' }, /events\[0\]: unknown look/],
  'event look not a string': [list => { list.events[0].look = ['sale'] }, /events\[0\]: unknown look/],
  'events overlap': [list => { list.events[1].startsAt = iso(Date.parse(list.events[0].endsAt) - 1) }, /events overlap/],
  'events overlap out of order': [list => { list.events.reverse(); list.events[0].startsAt = iso(Date.parse(list.events[1].endsAt) - 1) }, /events overlap/],
  'unknown slot': [list => { list.offers[0].slot = 'weekly' }, /offers\[0\]: unknown slot/],
  'slot not a string': [list => { list.offers[0].slot = 1 }, /offers\[0\]: unknown slot/],
  'eventId naming no event': [list => { list.offers[0].eventId = 'summer' }, /offers\[0\]: eventId names no event/],
  'eventId not a string': [list => { list.offers[0].eventId = 7 }, /offers\[0\]: eventId names no event/],
  'eventId with slot': [list => { list.offers[6].slot = 'limit-5h' }, /offers\[6\]: slot and eventId together/],
  'daily at 12:01': [list => { list.offers[1].campaign.opensAt = iso(noon(1) + MINUTE) }, /offers\[1\]: daily offer must open at dailyOfferOpens/],
  'daily at 11:00 UTC': [list => { list.offers[1].campaign.opensAt = iso(noon(1) + 3 * HOUR) }, /offers\[1\]: daily offer must open at dailyOfferOpens/],
  'daily with seconds': [list => { list.offers[1].campaign.opensAt = iso(noon(1) + 30 * SECOND) }, /offers\[1\]: daily offer must open at dailyOfferOpens/],
  'daily with milliseconds': [list => { list.offers[1].campaign.opensAt = iso(noon(1) + 5) }, /offers\[1\]: daily offer must open at dailyOfferOpens/],
  'daily claimBy over 24 hours': [list => { list.offers[1].campaign.claimBy = iso(noon(1) + DAY + 1) }, /offers\[1\]: daily offer claimBy over 24 hours after opensAt/],
  'daily offers overlap': [list => { list.offers[2] = daily('daily-2', 1, { claimBy: iso(noon(1) + HOUR) }) }, /daily offers overlap/],
  'daily offers overlap by 1 ms': [list => { list.offers[1].campaign.claimBy = iso(noon(2) + 1) }, /daily offers overlap/],
  'present installed under 60 seconds': [list => { list.offers[5].campaign.minInstallAgeSeconds = 59 }, /offers\[5\]: present needs minInstallAgeSeconds of at least 60/],
  'unknown pop-up template': [list => { list.popupRules[2].template = 'sale-start' }, /popupRules\[2\]: unknown template/],
  'daily at 12:00 when the list opens them at 13:30': [list => { list.schedule.dailyOfferOpens = '13:30' }, /offers\[1\]: daily offer must open at dailyOfferOpens/],
  'eventId naming an inherited name': [list => { list.offers[0].eventId = 'constructor' }, /offers\[0\]: eventId names no event/],
}

for (const [name, [mutate, reason]] of Object.entries(BROKEN)) {
  test(`format 2: refused when broken: ${name}`, async () => {
    const list = formatTwo()
    mutate(list)

    expect(errorsOf(list)).toMatch(reason)
    expect((await accept(list, { format: 2 })).ok).toBe(false)
  })
}

test('format 2: the edges that are allowed', () => {
  const list = formatTwo()
  // Exactly 62 days.
  list.events = [event('a', NOW, NOW + 62 * DAY)]
  list.offers[6].eventId = 'a'
  // Exactly 24 hours, ending when the next daily offer opens.
  list.offers[1].campaign.claimBy = iso(noon(2))

  expect(validateCatalogue(list)).toEqual({ ok: true, catalogue: list })

  const none = formatTwo({ events: [] })
  none.offers.pop()

  expect(validateCatalogue(none).ok).toBe(true)

  // The daily time follows the list's own schedule: 13:30 Tbilisi is 09:30 UTC.
  const later = formatTwo({ schedule: { dailyOfferOpens: '13:30' } })
  later.offers[1] = daily('daily-1', 1, { opensAt: iso(noon(1) + 90 * MINUTE), claimBy: iso(noon(1) + 90 * MINUTE + DAY - MINUTE) })
  later.offers[2] = daily('daily-2', 2, { opensAt: iso(noon(2) + 90 * MINUTE), claimBy: iso(noon(2) + 90 * MINUTE + DAY - MINUTE) })

  expect(errorsOf(later)).toBe('')

  // Order does not matter: events reversed and the two daily offers swapped.
  const shuffled = formatTwo()
  shuffled.events.reverse()
  ;[shuffled.offers[1], shuffled.offers[2]] = [shuffled.offers[2], shuffled.offers[1]]

  expect(errorsOf(shuffled)).toBe('')

  // Exactly three events, and an event name of exactly 24 characters.
  const three = formatTwo()
  three.events.push(event('summer-sale', NOW + 20 * DAY, NOW + 30 * DAY, { name: 'Summer Sale', look: 'summer' }))
  three.events[0].name = 'Black Friday Big Weekend'

  expect(three.events[0].name.length).toBe(24)
  expect(errorsOf(three)).toBe('')
})

test('format 2: categories are the 24 ids, each once, at most 24, and an offer sits only in a category the list carries; format 1 keeps the four', async () => {
  expect(CATEGORIES_V2).toEqual([
    'food', 'drinks', 'groceries', 'tickets', 'gadgets', 'fashion', 'beauty', 'health', 'sport', 'travel', 'transport', 'education',
    'software', 'services', 'finance', 'insurance', 'home', 'games', 'kids', 'other', 'custom-1', 'custom-2', 'custom-3', 'custom-4',
  ])

  for (const id of CATEGORIES_V2) {
    const list = formatTwo({ categories: [{ id, label: 'My Category' }] })
    for (const item of list.offers) item.category = id

    expect(errorsOf(list)).toBe('')
  }

  expect(errorsOf(formatTwo({ categories: CATEGORIES_V2.map(id => ({ id, label: 'Name' })) }))).toBe('')
  expect((await accept(formatTwo({ categories: [{ id: 'custom-2', label: 'Wellness' }], offers: [offer('plain', { category: 'custom-2' })] }), { format: 2 })).ok).toBe(true)

  const refusals: [Record<string, unknown>, RegExp][] = [
    [{ categories: [{ id: 'food', label: 'Food' }, { id: 'cars', label: 'Cars' }] }, /categories\[1\]: unknown or repeated category/],
    [{ categories: [{ id: 'food', label: 'Food' }, { id: 'constructor', label: 'X' }] }, /categories\[1\]: unknown or repeated category/],
    [{ categories: [{ id: 'food', label: 'Food' }, { id: 'custom-5', label: 'X' }] }, /categories\[1\]: unknown or repeated category/],
    [{ categories: [{ id: 'food', label: 'Food' }, { id: 'food', label: 'Food again' }] }, /categories\[1\]: unknown or repeated category/],
    [{ categories: [...CATEGORIES_V2.map(id => ({ id, label: 'Name' })), { id: 'food', label: 'Name' }] }, /categories must be a short list/],
    [{ categories: [{ id: 'food', label: 'x'.repeat(25) }] }, /categories\[0\]: label not allowed/],
    [{ offers: [offer('plain', { category: 'drinks' })] }, /offers\[0\]: unknown category/],
    [{ offers: [offer('plain', { category: 'cars' })] }, /offers\[0\]: unknown category/],
  ]

  for (const [fields, reason] of refusals) {
    expect(errorsOf(formatTwo(fields))).toMatch(reason)
    expect((await accept(formatTwo(fields), { format: 2 })).ok).toBe(false)
  }

  // Format 1 is exactly as 0.20.2 checks it: the four only.
  for (const id of CATEGORIES_V2.filter(id => !['food', 'drinks', 'tickets', 'gadgets'].includes(id))) {
    expect(errorsOf(formatOne({ categories: [{ id, label: 'Name' }] }))).toMatch(/categories\[0\]: unknown or repeated category/)
    expect(errorsOf(formatOne({ offers: [offerOne('mock-pizza', { category: id })] }))).toMatch(/offers\[0\]: unknown category/)
  }

  expect(errorsOf(formatOne({ offers: [offerOne('mock-pizza', { category: 'drinks' })] }))).toBe('')
})

test('format 2: unknown fields refuse at top, event and offer level', () => {
  const top = formatTwo({ theme: 'dark' })
  const atEvent = formatTwo()
  atEvent.events[0].colour = '#000'
  const atOffer = formatTwo()
  atOffer.offers[0].badge = 'hot'
  const atCampaign = formatTwo()
  atCampaign.offers[1].campaign.slot = 'daily'

  expect(errorsOf(top)).toMatch(/catalogue: unknown field/)
  expect(errorsOf(atEvent)).toMatch(/events\[0\]: unknown field/)
  expect(errorsOf(atOffer)).toMatch(/offers\[0\]: unknown field/)
  expect(errorsOf(atCampaign)).toMatch(/offers\[1\]\.campaign: unknown field/)
})

const FORMAT_TWO_FIELDS: Record<string, [(list: any) => void, RegExp]> = {
  latestAddonVersion: [list => { list.latestAddonVersion = '0.21.0' }, /catalogue: unknown field/],
  events: [list => { list.events = [] }, /catalogue: unknown field/],
  slot: [list => { list.offers[0].slot = 'limit-5h' }, /offers\[0\]: unknown field/],
  eventId: [list => { list.offers[0].eventId = 'black-friday' }, /offers\[0\]: unknown field/],
  'event-start pop-up': [list => { list.popupRules.push({ id: 'event', template: 'event-start', maxPerDay: 1 }) }, /popupRules\[1\]: unknown template/],
  'news pop-up': [list => { list.popupRules.push({ id: 'news', template: 'news', maxPerDay: 1 }) }, /popupRules\[1\]: unknown template/],
}

test('format 1 with any format 2 field is refused', () => {
  for (const [mutate, reason] of Object.values(FORMAT_TWO_FIELDS)) {
    const list = formatOne()
    mutate(list)

    expect(errorsOf(list)).toMatch(reason)
  }

  // Format 2 without its two keys, and any other format number.
  expect(errorsOf(formatOne({ v: 2 }))).toMatch(/missing latestAddonVersion/)
  expect(errorsOf(formatTwo({ v: 3 }))).toMatch(/v must be 1 or 2/)
})

test('format 2: an event name failing the offer review is refused', async () => {
  const list = formatTwo()
  list.events[0].name = 'Enter your password'

  expect(errorsOf(list)).toMatch(/events\[0\]: name fails the offer review/)
  expect((await accept(list, { format: 2 })).ok).toBe(false)
})

// Finding 9 of the 2026-11-12 review: a web address written without its scheme. The same two lists as
// the server's server/test/catalogue.test.ts, which checks that they are the same.
const ADDRESS_REFUSED = ['pizza.ge', 'www.example.com', 'shop.example.co.uk/deal', 'EXAMPLE.COM', 'Order at Pizza.Ge today', 'deals.example.shop', 'www.example.zip', 'example.zip/deal', 'my-cafe.online!', '(menu.example.net)', 'See pizza.ge.', 'go to cafe.ge.today', 'Get 20% at Example.io', 'example.co', 'sub.example.ru/x']
const ADDRESS_ALLOWED = ['e.g. a large pizza', 'i.e. today only', '2.5 kg of apples', 'No.1 pizza in town', '10.00 GEL off', 'Mon.-Fri. only', '9.30am to 11.00pm', 'a.m. and p.m.', 'U.S. sizes', 'Version 0.21.0', 'v2.0 is out', 'Dr.Oetker pizza', 'St. George', '15% off a large pizza', '1.5L/day', '2.5km/h', 'Mon.-Fri./Sat.', 'Size 5.5in', 'Black Friday']

test('format 2: a web address without a scheme in a brand, offer text, category label or campaign name refuses the list; abbreviations and numbers pass', async () => {
  for (const text of ADDRESS_REFUSED) {
    expect(webAddress(text)).toBeDefined()
    expect(reviewText(text)).toBeDefined()
  }

  for (const text of ADDRESS_ALLOWED) {
    expect(webAddress(text)).toBe(undefined)
  }

  expect(webAddress('Order at Pizza.Ge today')).toBe('Pizza.Ge')
  expect(webAddress('shop.example.co.uk/deal')).toBe('shop.example.co.uk')
  // Georgia's top-level name in Georgian letters (written as escapes here).
  expect(webAddress('\u10DE\u10D8\u10EA\u10D0.\u10D2\u10D4')).toBe('\u10DE\u10D8\u10EA\u10D0.\u10D2\u10D4')

  const places: Record<string, (list: any, value: string) => void> = {
    brand: (list, value) => { list.offers[0].brand = value },
    text: (list, value) => { list.offers[0].text = value },
    label: (list, value) => { list.categories[0].label = value },
    'campaign name': (list, value) => { list.events[0].name = value },
  }

  for (const [place, put] of Object.entries(places)) {
    for (const value of ['deals.example.shop', 'EXAMPLE.COM', 'example.zip/deal']) {
      const list = formatTwo()
      put(list, value)

      const result = await accept(list, { format: 2 })

      expect(errorsOf(list)).not.toBe('')
      expect(result.ok ? 'accepted' : result.reason).toMatch(/^schema: /)
    }

    // Ordinary text in the same place still passes.
    const plain = formatTwo()
    put(plain, 'No.1 for 2.5 Mon.-Fri.')

    expect(errorsOf(plain)).toBe('')
  }
})

test('format 2: hostile values in the new fields are refused without throwing', async () => {
  const lists = [
    formatTwo({ events: [null, 1, [], 'x', {}] }),
    formatTwo({ events: 'black-friday' }),
    formatTwo({ latestAddonVersion: { major: 0 } }),
    formatTwo({ schedule: null }),
    formatTwo({ schedule: { timeZone: 'Asia/Tbilisi', dailyOfferOpens: 1200, firstPresentAfterSeconds: 15 } }),
    formatTwo({ offers: [offer('a', { slot: { toString: 'daily' } }), offer('b', { eventId: ['black-friday'] }), offer('c', { slot: 'daily' }, { opensAt: null, claimBy: 'later' })] }),
    formatTwo({ events: [event('__proto__', NOW, NOW + DAY), event('constructor', NOW + DAY, NOW + 2 * DAY)], offers: [offer('a', { eventId: 'toString' })] }),
  ]

  for (const list of lists) {
    expect(validateCatalogue(list).ok).toBe(false)
    expect((await accept(list, { format: 2 })).ok).toBe(false)
  }
})

const PRIVATE_FIELDS: Record<string, [(list: any) => void, RegExp]> = {
  'an offer with its merchant': [list => { list.offers[0].merchantId = 'mock' }, /offers\[0\]: unknown field/],
  'a campaign with its code type': [list => { list.offers[1].campaign.codeModel = 'list' }, /offers\[1\]\.campaign: unknown field/],
  'a campaign with its hourly budget': [list => { list.offers[2].campaign.hourlyBudget = 5 }, /offers\[2\]\.campaign: unknown field/],
  'a campaign with its total budget': [list => { list.offers[3].campaign.totalBudget = 5 }, /offers\[3\]\.campaign: unknown field/],
  'a schedule with a time zone': [list => { list.schedule.timeZone = 'Asia/Tbilisi' }, /schedule: unknown field/],
  'a schedule with a first-present wait': [list => { list.schedule.firstPresentAfterSeconds = 15 }, /schedule: unknown field/],
  'no privateDigest': [list => { delete list.privateDigest }, /catalogue: missing privateDigest/],
  'privateDigest in capitals': [list => { list.privateDigest = 'AB'.repeat(32) }, /privateDigest must be 64 lower-case hex characters/],
  'privateDigest of 63 characters': [list => { list.privateDigest = 'a'.repeat(63) }, /privateDigest must be 64 lower-case hex characters/],
  'privateDigest as a number': [list => { list.privateDigest = 7 }, /privateDigest must be 64 lower-case hex characters/],
}

for (const [name, [mutate, reason]] of Object.entries(PRIVATE_FIELDS)) {
  test(`format 2: the private fields stay on the server, so the whole list is refused with ${name}`, async () => {
    const list = formatTwo()
    mutate(list)

    expect(errorsOf(list)).toMatch(reason)
    expect((await accept(list, { format: 2 })).ok).toBe(false)
  })
}

test('format 1 keeps the fields 0.20.2 reads, and refuses a privateDigest', () => {
  expect(errorsOf(formatOne({ privateDigest: DIGEST }))).toMatch(/catalogue: unknown field/)
  expect(errorsOf(formatOne({ offers: [{ ...offerOne('mock-pizza'), merchantId: undefined }] }))).toMatch(/bad merchantId/)
  expect(errorsOf(formatOne({ schedule: { dailyOfferOpens: '12:00' } }))).toMatch(/schedule: missing timeZone/)
})
