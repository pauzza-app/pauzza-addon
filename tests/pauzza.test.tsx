import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'


import { dotsSvg, dotsWidth, drawerColour, fadedSvg, iconTileSvg, logoTileSvg } from '../hooks/art'
import { bytesAt, DUMP_TEXT, lineAt, LOADINGS, loadingSvg, loadingTileSvg, packagesAt, stageAt } from '../hooks/loadings'
import { canAnimate, statusFor, drawMeter, formatReset, isMeterId, METERS, parseResetMs, pickFiveHour, pickLimit, savedMeter, statusLine } from '../hooks/meters'
import { accept, consentLine, decline, dismissUpdate, finishDelete, isRunning, readConsent, shouldDelete, UNDO_MS, undoWithdraw, viewOf, withdraw } from '../hooks/consent'
import { CONSENT_TEXT, documentUrl, TERMS_EFFECTIVE, TERMS_VERSION, WORDING_VERSION } from '../hooks/consent-text'
import { CONNECT_TEXT } from '../hooks/connect-text'
import { checkText, parseCatalog, sortOffers } from '../hooks/offers'
import {
  addWait,
  clearMark,
  createWaitTimer,
  dayKey,
  dropOfDay,
  isDropUnlocked,
  nextMilestone,
  nextReward,
  noteMilestones,
  assignFirstMeter,
  dailyProgress,
  presentProgress,
  takeBurnouts,
  takePopups,
  reachedMilestones,
  pickMeter,
  readSaved,
  trackWindow,
} from '../hooks/waiting-pays'

const SECOND = 1000
const MINUTE = 60 * SECOND
const NINE_AM = new Date(2026, 10, 9, 9, 0).getTime()

const offer = (id: string, category: string, addedAt: string, sponsored = false) => ({
  id,
  brand: `Test ${id}`,
  text: 'x',
  code: `TEST-${id.toUpperCase().padEnd(4, '0').slice(0, 4)}`,
  category,
  addedAt,
  sponsored,
})

const REWARDS = [15, 30, 60].map(minutes => ({ id: `m${minutes}`, minutes, brand: 'Test R', text: 'x', code: 'TEST-R000' }))
const CATALOG = JSON.stringify({
  categories: [{ id: 'food', label: 'Food' }, { id: 'gadgets', label: 'Gadgets' }],
  offers: [offer('aaaa', 'gadgets', '2026-11-01'), offer('bbbb', 'food', '2026-11-02', true)],
  rewards: REWARDS,
  welcomeReward: { id: 'welcome', brand: 'Test W', text: 'x', code: 'TEST-W001' },
  goodPaceReward: { id: 'good-pace', brand: 'Test P', text: 'x', code: 'TEST-P001' },
  finishReward: { id: 'finish', brand: 'Test F', text: 'x', code: 'TEST-F001' },
  drops: [{ id: 'drop-a', brand: 'Test D', text: 'drop', code: 'TEST-D001', quantity: 50 }],
})

let catalogNow = CATALOG
const TIMED = [1, 5, 10].map(minutes => ({ id: `after-${minutes}`, minutes, brand: 'Test T', text: 'x', code: `TEST-T${String(minutes).padStart(3, '0')}` }))
const fresh = (now = NINE_AM) => readSaved(undefined, now)

test('offer text with control or direction characters is refused, not cleaned', () => {
  expect(checkText('a\u0007b\u0000c\u007fd\u009be')).toBe(undefined)
  expect(checkText('\u001b[31mred\u001b[0m')).toBe(undefined)
  expect(checkText('a‮b⁦c')).toBe(undefined)
  expect(checkText('🍕 pizza')).toBe('🍕 pizza')
  expect(checkText('a‍b')).toBe(undefined)
})

test('the catalogue accepts only fictional items', () => {
  const parsed = parseCatalog(CATALOG)
  expect(parsed.offers.length).toBe(2)
  expect(parsed.rewards.map(reward => reward.minutes)).toEqual([15, 30, 60])
  expect(parseCatalog(JSON.stringify({ offers: [{ ...offer('aaaa', 'x', '2026-11-01'), code: 'REAL-1' }] })).offers).toEqual([])
  expect(parseCatalog(JSON.stringify({ offers: [{ ...offer('aaaa', 'x', '2026-11-01'), brand: 'Real' }] })).offers).toEqual([])
  expect(parseCatalog('not json').offers).toEqual([])
})

test('ordering: chosen categories, then recently copied, then newest; all kept', () => {
  const list = [offer('old', 'food', '2026-01-01'), offer('new', 'gadgets', '2026-11-01'), offer('mid', 'food', '2026-06-01'), offer('copy', 'gadgets', '2026-02-01')]
  const ids = (categories: string[], recent: string[]) => sortOffers(list, categories, recent).map(item => item.id)

  expect(ids([], [])).toEqual(['new', 'mid', 'copy', 'old'])
  expect(ids([], ['copy'])).toEqual(['copy', 'new', 'mid', 'old'])
  expect(ids(['food'], [])).toEqual(['mid', 'old', 'new', 'copy'])
  expect(ids(['food'], ['copy'])).toEqual(['mid', 'old', 'copy', 'new'])
})

test('a wait is timed only between isWorking true and false', () => {
  const timer = createWaitTimer()

  expect(timer.update(false, 0)).toBe(undefined)
  expect(timer.update(true, 10 * SECOND)).toBe(undefined)
  expect(timer.update(true, 40 * SECOND)).toBe(undefined)
  expect(timer.runningMs(40 * SECOND)).toBe(30 * SECOND)
  expect(timer.update(false, 70 * SECOND)).toBe(60 * SECOND)
  expect(timer.update(false, 900 * SECOND)).toBe(undefined)
  expect(timer.runningMs(900 * SECOND)).toBe(0)
})

test('the daily cap holds and thresholds become ready once', () => {
  let saved = addWait(fresh(), 14 * MINUTE, REWARDS)
  expect(saved.minutes).toBe(14)
  expect(nextReward(saved.minutes, REWARDS)?.minutes).toBe(15)
  expect(saved.marksPending).toBe(1) // the finish reward only

  saved = addWait({ ...saved, marksPending: 0 }, 1 * MINUTE, REWARDS)
  expect(saved.marksPending).toBe(1)

  saved = addWait(saved, 500 * MINUTE, REWARDS)
  expect(saved.minutes).toBe(60)
  expect(nextReward(saved.minutes, REWARDS)).toBe(undefined)
})

test('the mark never rises on ordinary waits and at most 3 times a day', () => {
  let saved = addWait(fresh(), 30 * SECOND, REWARDS)
  expect(saved.marksPending).toBe(0)

  saved = addWait(saved, 3 * MINUTE, REWARDS)
  expect(saved.marksRaised).toBe(1)
  saved = addWait(saved, 3 * MINUTE, REWARDS)
  expect(saved.marksRaised).toBe(1)

  for (let i = 0; i < 12; i += 1) {
    saved = addWait(saved, 5 * MINUTE, REWARDS)
  }

  expect(saved.marksRaised).toBe(3)
})

test('a new local day starts fresh and keeps preferences', () => {
  const saved = { ...addWait(fresh(), 20 * MINUTE, REWARDS), recent: ['aaaa'], claimedRewards: ['m15'] }
  const sameDay = readSaved(saved, NINE_AM + 3 * 60 * MINUTE)
  const nextDay = readSaved(saved, NINE_AM + 24 * 60 * MINUTE)

  expect(sameDay.minutes).toBe(20)
  expect(sameDay.claimedRewards).toEqual(['m15'])
  expect(nextDay.minutes).toBe(0)
  expect(nextDay.claimedRewards).toEqual([])
  expect(nextDay.marksPending).toBe(0)
  expect(nextDay.recent).toEqual(['aaaa'])
  expect(nextDay.date).toBe(dayKey(NINE_AM + 24 * 60 * MINUTE))
})

test('the drop unlocks at 12:00 local and stays the same all day', () => {
  const at = (hour: number, minute: number) => new Date(2026, 10, 9, hour, minute).getTime()
  const drops = parseCatalog(CATALOG).drops

  expect(isDropUnlocked(at(11, 59))).toBe(false)
  expect(isDropUnlocked(at(12, 0))).toBe(true)
  expect(dropOfDay(drops, at(13, 0))).toEqual(dropOfDay(drops, at(23, 59)))
  expect(dropOfDay(drops, at(13, 0))?.quantity).toBe(50)
})

const BAND = {
  plugin: 'pauzza',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const GIVEN = { status: 'given', termsVersion: TERMS_VERSION, wordingVersion: WORDING_VERSION, at: 0 }
let consentSeed: unknown = GIVEN
let savedSeed: unknown = { meterDisplay: 'always' }

// Engine tests walk the clock through many timer ticks, which can take several
// seconds on a busy machine. Each starts from the shared seeds as they were and
// leaves them so, even when it fails, so one test cannot change the next one.
const ENGINE_TEST_MS = 30_000
const resetSeeds = () => {
  catalogNow = CATALOG
  consentSeed = GIVEN
  savedSeed = { meterDisplay: 'always' }
}
const engineTest = (name: string, body: TestBody) =>
  test(name, { timeoutMs: ENGINE_TEST_MS }, async ($, on) => {
    resetSeeds()

    try {
      await body($, on)
    } finally {
      resetSeeds()
    }
  })

const PANE = {
  plugin: 'pauzza',
  component: 'Pane',
  requestId: 'pauzza-offers',
  props: { title: 'Pauzza', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

function fakeEngine(on: any, nowMs = NINE_AM, rateLimits: () => unknown[] = () => []) {
  const lines: unknown[] = []
  const opened: string[] = []
  const seen: { drewEngine: number } = { drewEngine: 0 }
  const clock = mock.clock(on, { now: nowMs })
  const store = new Map<string, unknown>([['saved', savedSeed], ...(consentSeed === undefined ? [] : [['consent', consentSeed] as [string, unknown]])])
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    store.delete(e.key)

    return { value: undefined }
  })
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  const reads: string[] = []
  on('fs.read', (_: unknown, e: { path: string }) => {
    reads.push(e.path.split(/[\\/]/).at(-1) ?? '')

    return { value: /(TERMS|PRIVACY)\.md$/.test(e.path) ? `DOC ${e.path.split('/').at(-1)}\r\n` : catalogNow }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: rateLimits() } }))
  on('ui.status', (_: unknown, e: any) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('ui.render', ($: any, e: any) => {
    seen.drewEngine += 1
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  // No real network here: the Connect press is the acceptance too, and its
  // connection, tested in stage2.test.tsx, fails calmly against this stub.
  const sent: string[] = []
  on('http.fetch', (_: unknown, e: { url: string }) => {
    sent.push(e.url)

    return { value: { status: 503, text: '', headers: {} } }
  })

  return { clock, seen, lines, opened, toasts, store, reads, sent }
}

async function setWorking($: any, isWorking: boolean) {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking } })
  const drew = await ui.find({ type: 'Text', text: /engine/ })
  await ui.unmount()

  return drew
}

async function wait($: any, clock: any, ms: number) {
  await setWorking($, true)
  await clock.advance(ms)
  await setWorking($, false)
}

async function chooseMeter(ui: any, id: string, from = 0) {
  const steps = METERS.findIndex(meter => meter.id === id) - from

  for (let i = 0; i < steps; i += 1) {
    await ui.press({ key: 'carousel-next' })
  }

  await ui.press({ key: 'carousel-choose' })
}

async function openSettings($: any) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'settings-toggle' })
  await ui.unmount()
}

async function panelHas($: any, text: RegExp) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()

  return found !== undefined
}

async function panelCount($: any, text: RegExp) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const found = await ui.findAll({ type: 'Text', text })
  await ui.unmount()

  return found.length
}

engineTest('minutes count only while working, and the band draws nothing of its own', async ($, on) => {
  const { clock, lines } = fakeEngine(on)
  const picking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(picking, 'line42')
  await picking.unmount()

  await clock.advance(10 * MINUTE)
  expect(await setWorking($, true)).toBeDefined()
  await clock.advance(5 * MINUTE)
  await setWorking($, false)
  await clock.advance(10 * MINUTE)

  expect(lines.at(-1)).toContain('⏳ 5m')
})

engineTest('the panel: my drawer, drop before and after 12:00, codes always visible', async ($, on) => {
  const { clock } = fakeEngine(on)
  await wait($, clock, 16 * MINUTE)

  const morning = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await morning.find({ type: 'Text', text: /^Test R$/ })).toBeDefined()
  expect(await morning.find({ type: 'Text', text: /TEST-R000/ })).toBeDefined()
  await morning.press({ key: 'drawer-day' })
  await morning.unmount()

  const open = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await open.find({ type: 'Text', text: /12:00/ })).toBeDefined()
  expect(await open.find({ type: 'Text', text: /^Test D$/ })).toBe(undefined)
  expect(await open.find({ type: 'Text', text: /^Test R$/ })).toBe(undefined)
  await open.unmount()

  await clock.advance(4 * 60 * MINUTE)
  const afternoon = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await afternoon.find({ type: 'Text', text: /^Test D$/ })).toBeDefined()
  await afternoon.unmount()
})

engineTest('copying shows a tick, and the code is always visible', async ($, on) => {
  fakeEngine(on)
  const texts: string[] = []
  on('ui.copy', (_: unknown, e: { text: string }) => {
    texts.push(e.text)

    return { value: { isCopied: true } }
  })

  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'drawer-gadgets' })
  await first.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TEST-AAAA/ })).toBeDefined()
  expect((await ui.find({ key: 'copy-aaaa' }))?.text).toBe('⧉')
  await ui.press({ key: 'copy-aaaa' })
  await ui.unmount()
  expect(texts).toEqual(['TEST-AAAA'])

  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await after.find({ key: 'copy-aaaa' }))?.text).toBe('✓')
  await after.unmount()
})

engineTest('reset needs a confirmation, then deletes the saved data', async ($, on) => {
  const { clock, lines } = fakeEngine(on)
  const picking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(picking, 'line42')
  await picking.unmount()
  await wait($, clock, 5 * MINUTE)

  await openSettings($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'reset' })
  await ui.unmount()
  expect(lines.at(-1)).toContain('⏳ 5m')

  const confirm = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirm.press({ key: 'reset-confirm' })
  await confirm.unmount()
  expect(lines.at(-1)).toBe('🎁 choose your meter · /pauzza')
})

const EXPECTED: Record<string, string[]> = {
  line42: ['ln 1 >┄┄┄┄┄┄┄┄┄● 0%', 'ln 11 ──>┄┄┄┄┄┄┄● 25%', 'ln 21 ─────>┄┄┄┄● 50%', 'ln 31 ───────>┄┄● 75%', 'ln 42 ─────────● 100%'],
  pipeline: ['[~]build [ ]test [ ]ship [ ]treat 0%', '[~]build [ ]test [ ]ship [ ]treat 25%', '[x]build [~]test [ ]ship [ ]treat 50%', '[x]build [x]test [~]ship [ ]treat 75%', '[x]build [x]test [x]ship [x]treat 100%'],
  install: ['+ [··········] 0/42 0%', '+ [██▌·······] 10/42 25%', '+ [█████·····] 21/42 50%', '+ [███████▌··] 31/42 75%', '+ [██████████] 42/42 100%'],
  rain: ['rain ▁▁▁▁▁▁▁▁ 0%', 'rain ▂▃▂▄▃▃▄▄ 25%', 'rain ▄▅▄▆▅▅▆▆ 50%', 'rain ▅▆▅▇▆▆▇▇ 75%', 'rain ████████ 100%'],
  hexdump: ['2a: __ .. .. .. .. .. .. .. |........| 0%', '2b: 61 6b 65 20 61 20 62 __ |ake a b.| 25%', '33: 65 61 6b 3b 20 70 61 __ |eak; pa.| 50%', '3b: 73 65 64 20 6f 6e 20 __ |sed on .| 75%', '42: 6c 69 6e 65 20 34 32 2e |line 42.| 100%'],
}

test('each meter at 0, 25, 50, 75 and 100', () => {
  expect(METERS.length).toBe(5)
  METERS.forEach(meter => {
    expect([0, 25, 50, 75, 100].map(p => drawMeter(meter.id, p))).toEqual(EXPECTED[meter.id])
  })
})

test('every status line stays far inside the 200-character panel limit', () => {
  const now = 1_000_000
  const resetMs = now + 4 * 60 * MINUTE + 59 * MINUTE
  const lengths = METERS.flatMap(meter =>
    [{ percent: 99, isGoodPace: true, gifts: 9 }, { percent: 100, isGoodPace: false, gifts: 9 }].map(item =>
      statusLine({ meter: meter.id, five: { percent: item.percent, resetMs }, gifts: item.gifts, isGoodPace: item.isGoodPace, waitedMinutes: 60, now }).length,
    ),
  )

  expect(Math.max(...lengths)).toBeLessThanOrEqual(80)
})

test('time formats: ISO, epoch seconds, epoch milliseconds, junk', () => {
  const iso = '2026-11-09T12:00:00.000Z'
  const ms = Date.parse(iso)

  expect(parseResetMs(iso)).toBe(ms)
  expect(parseResetMs(ms)).toBe(ms)
  expect(parseResetMs(ms / 1000)).toBe(ms)
  expect(parseResetMs(String(ms / 1000))).toBe(ms)
  expect(parseResetMs('soon')).toBe(undefined)
  expect(parseResetMs(undefined)).toBe(undefined)
  expect(formatReset(ms, ms - 80 * MINUTE)).toBe('↻1h 20m')
  expect(formatReset(ms, ms - 5 * MINUTE)).toBe('↻0h 05m')
  expect(formatReset(ms, ms + 1)).toBe('')
})

test('only the 5-hour window drives the meter', () => {
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 90 }])).toBe(undefined)
  expect(pickFiveHour([{ kind: 'seven_day', percentUsed: 90 }, { kind: 'five_hour', percentUsed: 12.5 }])?.percent).toBe(12.5)
})

test('status line states', () => {
  const now = 1_000_000
  const five = { percent: 50, resetMs: now + 80 * MINUTE }
  const base = { meter: 'line42' as const, five, gifts: 0, isGoodPace: false, waitedMinutes: 12, now }

  expect(statusLine({ ...base, meter: null })).toBe('🎁 choose your meter · /pauzza')
  expect(statusLine(base)).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m')
  expect(statusLine({ ...base, gifts: 1 })).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m 🎁 1')
  expect(statusLine({ ...base, isGoodPace: true })).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m ✨ good pace')
  expect(statusLine({ ...base, five: { ...five, percent: 100 } })).toBe('ln 42 ─────────● 100% 🛋 Limit Lounge · /pauzza ↻1h 20m')
  expect(statusLine({ ...base, five: undefined })).toBe('no limit data · ⏳ 12m')
  expect(statusLine({ ...base, five: { percent: 100, resetMs: now - 1 } })).toBe('ln 1 >┄┄┄┄┄┄┄┄┄● 0%')
})

test('good pace is earned once a day, only under an 80% peak', () => {
  const window = (percent: number, resetMs: number) => ({ percent, resetMs })
  const H5 = 5 * 60 * MINUTE
  const R = NINE_AM + H5

  let saved = trackWindow(fresh(), window(40, R))
  saved = trackWindow(saved, window(79, R))
  expect(saved.goodPaceEarned).toBe(false)
  saved = trackWindow(saved, window(79, R + 60 * SECOND)) // the same window, a corrected time
  expect(saved.goodPaceEarned).toBe(false)

  saved = trackWindow(saved, window(5, R + H5))
  expect(saved.goodPaceEarned).toBe(true)
  expect(saved.goodPaceNotice).toBe(true)

  saved = clearMark(saved)
  saved = trackWindow(saved, window(5, R + 2 * H5))
  expect(saved.goodPaceNotice).toBe(false)

  let high = trackWindow(fresh(), window(80, R))
  high = trackWindow(high, window(5, R + H5))
  expect(high.goodPaceEarned).toBe(false)
})

test('choosing a meter gives one welcome reward; a new day keeps the choice', () => {
  const once = pickMeter(fresh(), 'pipeline')
  const twice = pickMeter(once, 'hexdump')

  expect(once.welcomeEarned).toBe(true)
  expect(twice.meter).toBe('hexdump')
  const nextDay = readSaved(twice, NINE_AM + 24 * 60 * MINUTE)
  expect(nextDay.meter).toBe('hexdump')
  expect(nextDay.welcomeEarned).toBe(true)
  expect(readSaved({}, NINE_AM).meter).toBe(null)
})

test('the lounge puts the best offers first and keeps them all', () => {
  const list = [{ ...offer('low', 'food', '2026-11-09'), score: 1 }, { ...offer('top', 'gadgets', '2026-01-01'), score: 9 }]

  expect(sortOffers(list, ['food'], []).map(item => item.id)).toEqual(['low', 'top'])
  expect(sortOffers(list, ['food'], [], true).map(item => item.id)).toEqual(['top', 'low'])
})

function usageEngine(on: any, rateLimits: () => unknown[], nowMs = NINE_AM) {
  on('command.register', () => ({ value: { command: 'pauzza' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.measure', () => ({ changed: ['rateLimits'] }))

  return fakeEngine(on, nowMs, rateLimits)
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const IN_80 = () => new Date(NINE_AM + 80 * MINUTE).toISOString()

engineTest('first run: asks on the status line, never opens the pane, then one welcome', async ($, on) => {
  const { lines, opened } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])

  await start($)
  expect(lines.at(-1)).toBe('🎁 choose your meter · /pauzza')
  expect(opened).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ln 21 ─────>┄┄┄┄● 50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Test W$/ })).toBe(undefined)
  await chooseMeter(ui, 'pipeline')
  await ui.unmount()

  expect(lines.at(-1)).toBe('[x]build [~]test [ ]ship [ ]treat 50% ↻1h 20m')
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.findAll({ type: 'Text', text: /^Test W$/ })).toHaveLength(1)
  expect(await after.find({ key: 'carousel-choose' })).toBe(undefined)
  await after.press({ key: 'meter-change' })
  await after.unmount()

  const changing = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(changing, 'hexdump', METERS.findIndex(meter => meter.id === 'pipeline'))
  await changing.unmount()
  expect(lines.at(-1)).toBe('33: 65 61 6b 3b 20 70 61 __ |eak; pa.| 50% ↻1h 20m')
  expect(await panelCount($, /^Test W$/)).toBe(1)
})

engineTest('session.measure moves the meter; 100% shows the lounge and best offers', async ($, on) => {
  let percent = 25
  const { lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: percent, resetsAt: IN_80() }])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(ui, 'line42')
  await ui.unmount()
  expect(lines.at(-1)).toBe('ln 11 ──>┄┄┄┄┄┄┄● 25% ↻1h 20m')

  percent = 100
  await $.session.measure({ context: {}, rateLimits: [], changed: ['rateLimits'] })
  expect(lines.at(-1)).toBe('ln 42 ─────────● 100% 🛋 Limit Lounge · /pauzza ↻1h 20m')
  expect(await panelHas($, /Limit Lounge/)).toBe(true)
})

engineTest('empty rate limits: says so and shows waiting minutes', async ($, on) => {
  const { clock, lines } = usageEngine(on, () => [])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Sample: no limit data yet$/ })).toBeDefined()
  await chooseMeter(ui, 'line42')
  await ui.unmount()
  await wait($, clock, 5 * MINUTE)

  expect(lines.at(-1)).toBe('no limit data · ⏳ 5m 🎁 1')
})

engineTest('a ready reward shows on the status line and clears when /pauzza opens', async ($, on) => {
  const { clock, lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 10, resetsAt: new Date(NINE_AM + 4 * 60 * MINUTE).toISOString() }])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(ui, 'line42')
  await ui.unmount()

  await wait($, clock, 3 * MINUTE)
  expect(lines.at(-1)).toContain('🎁 1')
  await $.command.run({ command: 'pauzza', args: '' })
  expect(lines.at(-1)).not.toContain('🎁')
})

engineTest('good pace through the hooks: once, with its reward', async ($, on) => {
  let resetsAt = new Date(NINE_AM + 60 * MINUTE).toISOString()
  const { lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 30, resetsAt }])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(ui, 'line42')
  await ui.unmount()

  resetsAt = new Date(NINE_AM + 6 * 60 * MINUTE).toISOString()
  await $.session.measure({ context: {}, rateLimits: [], changed: ['rateLimits'] })
  expect(lines.at(-1)).toContain('✨ good pace')
  expect(await panelCount($, /^Test P$/)).toBe(1)
})

engineTest('the status line moves only while working', async ($, on) => {
  const { clock, lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(ui, 'line42')
  await ui.unmount()
  const still = lines.length

  await clock.advance(5 * SECOND)
  expect(lines.length).toBe(still)

  await setWorking($, true)
  await clock.advance(2 * SECOND)
  expect(lines.length).toBeGreaterThan(still)
  const moved = lines.slice(still) as string[]
  moved.forEach(line => expect(line).toMatch(/^ln 21 ─────[>·]┄┄┄┄● 50% ↻1h 20m$/))
  expect(moved.some(line => line.includes('·'))).toBe(true)

  await setWorking($, false)
  expect(lines.at(-1)).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m')
  const stopped = lines.length
  await clock.advance(5 * SECOND)
  expect(lines.length).toBe(stopped)
})

engineTest('Desktop draws picture tiles; the terminal keeps text', async ($, on) => {
  fakeEngine(on)
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Svg' })).length).toBe(14)
  expect(await desktop.find({ key: 'carousel-choose' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  await terminal.unmount()
})

test('the meter follows the limit closest to stopping the person', () => {
  const five = { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-11-09T12:00:00.000Z' }
  const week = { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-11-14T11:00:00.000Z' }

  expect(pickLimit([five, week])?.percent).toBe(95)
  expect(pickLimit([{ ...five, percentUsed: 80 }, { ...week, percentUsed: 20 }])?.percent).toBe(80)
  expect(pickLimit([week])?.percent).toBe(95)
  expect(pickFiveHour([week])).toBe(undefined)
  expect(pickLimit([{ kind: 'spend_limit', percentUsed: 50 }])).toBe(undefined)
  expect(pickLimit([])).toBe(undefined)
  expect(formatReset(NINE_AM + 134 * 60 * MINUTE, NINE_AM)).toBe('↻5d 14h')
})

test('timed presents: the clock starts once and each mark rises once', () => {
  const started = noteMilestones(fresh(), NINE_AM, TIMED)
  expect(started.installedAt).toBe(NINE_AM)
  expect(started.marksPending).toBe(0)
  expect(nextMilestone(started, NINE_AM, TIMED)).toEqual({ minutes: 1, left: 1 })

  const after = noteMilestones(started, NINE_AM + 5 * MINUTE, TIMED)
  expect(after.installedAt).toBe(NINE_AM)
  expect(after.marksPending).toBe(2)
  expect(noteMilestones(after, NINE_AM + 5 * MINUTE, TIMED).marksPending).toBe(2)
  expect(reachedMilestones(after, NINE_AM + 5 * MINUTE, TIMED).map(item => item.minutes)).toEqual([1, 5])
  expect(nextMilestone(after, NINE_AM + 11 * MINUTE, TIMED)).toBe(undefined)

  const nextDay = readSaved(after, NINE_AM + 24 * 60 * MINUTE)
  expect(nextDay.installedAt).toBe(NINE_AM)
  expect(nextDay.milestonesSeen).toEqual(['after-1', 'after-5'])
})

engineTest('a present arrives by the clock, with no work going on', async ($, on) => {
  catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), milestones: TIMED })
  const { clock, lines } = usageEngine(on, () => [{ kind: 'seven_day', percentUsed: 16, resetsAt: new Date(NINE_AM + 134 * 60 * MINUTE).toISOString() }])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Test T$/ })).toBe(undefined)
  await chooseMeter(ui, 'pipeline')
  await ui.unmount()
  expect(lines.at(-1)).toBe('[~]build [ ]test [ ]ship [ ]treat 0% →🎁 1m')

  await clock.advance(61 * SECOND)
  expect(lines.at(-1)).toContain('🎁 1')
  expect(await panelCount($, /^Test T$/)).toBe(1)
  expect(await panelHas($, /^Next present in 4 min$/)).toBe(true)
  expect(lines.at(-1)).toContain('→🎁 4m')

  await clock.advance(10 * MINUTE)
  expect(lines.at(-1)).toContain('[~]build [ ]test [ ]ship [ ]treat 16% ↻5d 13h')
  const finished = lines.length
  await clock.advance(30 * SECOND)
  expect(lines.length).toBe(finished)
  catalogNow = CATALOG
})

test('the meter restarts toward each present, and a limit stop comes first', () => {
  const started = noteMilestones(fresh(), NINE_AM, TIMED)

  expect(presentProgress(started, NINE_AM + 30 * SECOND, TIMED)).toEqual({ percent: 50, leftMs: 30 * SECOND })
  expect(presentProgress(started, NINE_AM + 3 * MINUTE, TIMED)).toEqual({ percent: 50, leftMs: 2 * MINUTE })
  expect(presentProgress(started, NINE_AM + 7.5 * MINUTE, TIMED)?.percent).toBe(50)
  expect(presentProgress(started, NINE_AM + 10 * MINUTE, TIMED)).toBe(undefined)
  expect(presentProgress(fresh(), NINE_AM, TIMED)).toBe(undefined)

  const base = { meter: 'line42' as const, gifts: 0, isGoodPace: false, waitedMinutes: 0, now: NINE_AM }
  const present = { percent: 50, leftMs: 30 * SECOND }
  expect(statusLine({ ...base, five: undefined, present })).toBe('ln 21 ─────>┄┄┄┄● 50% →🎁 30s')
  expect(statusLine({ ...base, five: { percent: 100, resetMs: undefined }, present })).toContain('Limit Lounge')
  expect(canAnimate({ ...base, five: undefined, present })).toBe(true)
})

engineTest('the chosen meter is pictured at the top of the panel, following the same number', async ($, on) => {
  catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), milestones: TIMED })
  const { clock } = usageEngine(on, () => [{ kind: 'seven_day', percentUsed: 17, resetsAt: new Date(NINE_AM + 134 * 60 * MINUTE).toISOString() }])
  await start($)
  const picking = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await chooseMeter(picking, 'rain')
  await picking.unmount()

  await clock.advance(30 * SECOND)
  const during = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await during.findAll({ type: 'Svg' })).map((svg: any) => svg.props.source)).toContain(loadingSvg('rain', 50))
  expect((await during.findAll({ type: 'Svg' })).length).toBe(12)
  expect(await during.find({ type: 'Text', text: /^50%$/ })).toBeDefined()
  await during.unmount()

  await clock.advance(10 * MINUTE)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await after.findAll({ type: 'Svg' })).map((svg: any) => svg.props.source)).toContain(loadingSvg('rain', 17))
  expect(await after.find({ type: 'Text', text: /^17%$/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /^↻5d / })).toBeDefined()
  await after.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /^rain [▁▂▃▄▅▆▇█]{8} 17%$/ })).toBeDefined()
  await terminal.unmount()
  catalogNow = CATALOG
})

test('icon tiles, logo tiles and faded neighbours are drawn as designed', () => {
  expect(iconTileSvg('food')).toContain('#FFA94D')
  expect(logoTileSvg('Test Pizza')).toContain('>TP<')
  expect(logoTileSvg('Test <b>')).not.toContain('<b')
  expect(fadedSvg('<svg a="b"><x/></svg>')).toBe('<svg a="b"><g opacity="0.4"><x/></g></svg>')
  expect(fadedSvg(loadingTileSvg('line42', 50))).toContain('<g opacity="0.4">')
})

engineTest('the carousel only previews until chosen, and can be cancelled', async ($, on) => {
  const { lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
  await start($)
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await first.find({ key: 'carousel-cancel' })).toBe(undefined)
  await first.press({ key: 'carousel-next' })
  await first.unmount()
  expect(lines.at(-1)).toBe('🎁 choose your meter · /pauzza')

  const picking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await picking.press({ key: 'carousel-choose' })
  await picking.unmount()
  expect(lines.at(-1)).toBe('[x]build [~]test [ ]ship [ ]treat 50% ↻1h 20m')

  const changing = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await changing.press({ key: 'meter-change' })
  await changing.unmount()
  const open = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await open.press({ key: 'carousel-next' })
  await open.press({ key: 'carousel-cancel' })
  await open.unmount()
  expect(lines.at(-1)).toBe('[x]build [~]test [ ]ship [ ]treat 50% ↻1h 20m')
  expect(await panelHas($, /^pipeline$/)).toBe(true)
})

test('every drawer has its own colour', () => {
  const colours = ['mine', 'day', 'food', 'drinks', 'tickets', 'gadgets'].map(drawerColour)

  expect(new Set(colours).size).toBe(6)
})

test('the line follows the setting; only a first-time nudge overrides it', () => {
  const base = { meter: 'line42' as const, five: { percent: 50, resetMs: undefined }, gifts: 0, isGoodPace: false, waitedMinutes: 0, now: 1 }

  expect(statusFor(base, 'always')).toBe('ln 21 ─────>┄┄┄┄● 50%')
  expect(statusFor(base, 'ready')).toBe(undefined)
  expect(statusFor({ ...base, gifts: 2 }, 'ready')).toBe('🎁 2 · /pauzza')
  expect(statusFor({ ...base, five: { percent: 100, resetMs: undefined } }, 'ready')).toContain('Limit Lounge')
  expect(statusFor({ ...base, gifts: 2 }, 'off')).toBe(undefined)
  expect(statusFor({ ...base, meter: null }, 'off')).toBe('🎁 choose your meter · /pauzza')
  expect(readSaved(undefined, NINE_AM).meterDisplay).toBe('ready')
  expect(canAnimate({ ...base, display: 'ready' })).toBe(false)
})

test('the deal pop-up is once a day, and never when turned off', () => {
  const chosen = pickMeter(fresh(), 'line42')
  const first = takePopups(chosen, true)

  expect(first.popups.length).toBe(1)
  expect(takePopups(first.saved, true).popups).toEqual([])
  expect(takePopups({ ...chosen, popupsOn: false }, true).popups).toEqual([])
  expect(takePopups({ ...chosen, meterDisplay: 'off' }, true).popups).toEqual([])
  expect(takePopups(fresh(), true).popups).toEqual([])
  expect(readSaved(first.saved, NINE_AM + 24 * 60 * MINUTE).dropPopupShown).toBe(false)
})

test('limit prizes: the 5-hour one daily, the weekly one once per weekly window', () => {
  const chosen = pickMeter(fresh(), 'line42')
  const full = { percent: 100, resetMs: NINE_AM + 3 * 24 * 60 * MINUTE }
  const both = takeBurnouts(chosen, full, full, NINE_AM)

  expect(both.popups.length).toBe(2)
  expect(both.saved.marksPending).toBe(2)
  expect(both.saved.burnWeekUntil).toBe(full.resetMs)
  expect(takeBurnouts(both.saved, full, full, NINE_AM + MINUTE).popups).toEqual([])

  const nextDay = readSaved(both.saved, NINE_AM + 24 * 60 * MINUTE)
  const later = takeBurnouts(nextDay, full, full, NINE_AM + 24 * 60 * MINUTE)
  expect(later.popups.length).toBe(1)
  expect(later.saved.marksPending).toBe(1)

  const pastReset = takeBurnouts(later.saved, undefined, full, full.resetMs + 1)
  expect(pastReset.popups.length).toBe(1)
  expect(pastReset.saved.burnWeekUntil).toBe(full.resetMs + 1 + 7 * 24 * 60 * MINUTE)

  const silent = takeBurnouts({ ...chosen, popupsOn: false }, full, undefined, NINE_AM)
  expect(silent.popups).toEqual([])
  expect(silent.saved.burnFiveEarned).toBe(true)
  expect(takeBurnouts(fresh(), full, full, NINE_AM).saved.burnFiveEarned).toBe(false)
})

engineTest('turning the line off removes it at once, and the deal pop-up appears at 12:00', async ($, on) => {
  const { clock, lines, toasts } = fakeEngine(on)
  const picking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(picking, 'line42')
  await picking.unmount()
  expect(toasts).toEqual([])
  await clock.advance(4 * 60 * MINUTE)
  await $.command.run({ command: 'pauzza', args: '' })
  expect(toasts.length).toBe(1)

  await openSettings($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'display-off' })
  await ui.unmount()
  expect(lines.at(-1)).toBe(undefined)
})

engineTest('the gift mark goes when prizes are in view, and stays while another drawer is open', async ($, on) => {
  catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), milestones: TIMED })
  const { clock, lines } = usageEngine(on, () => [])
  await start($)
  const picking = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await chooseMeter(picking, 'line42')
  await picking.unmount()
  await $.command.run({ command: 'pauzza', args: '' })

  await clock.advance(61 * SECOND)
  expect(lines.at(-1)).not.toMatch(/ 🎁 [0-9]+$/)

  const away = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await away.press({ key: 'drawer-day' })
  await away.unmount()
  await clock.advance(4 * MINUTE)
  expect(lines.at(-1)).toMatch(/ 🎁 1$/)

  const back = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await back.press({ key: 'drawer-mine' })
  await back.unmount()
  expect(lines.at(-1)).not.toMatch(/ 🎁 [0-9]+$/)
  catalogNow = CATALOG
})

engineTest('settings replace the panel until back is pressed, and follow the line setting', async ($, on) => {
  fakeEngine(on)
  const picking = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await chooseMeter(picking, 'line42')
  await picking.unmount()
  const open = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await open.press({ key: 'settings-toggle' })
  await open.unmount()

  const view = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await view.find({ key: 'meter-change' })).toBe(undefined)
  expect(await view.find({ key: 'drawer-mine' })).toBe(undefined)
  expect(await view.find({ key: 'popups-on' })).toBeDefined()
  await view.press({ key: 'display-off' })
  await view.unmount()

  const off = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await off.find({ key: 'popups-on' })).toBe(undefined)
  expect(await off.find({ type: 'Text', text: /^Off with the line$/ })).toBeDefined()
  await off.press({ key: 'reset' })
  await off.unmount()

  const armed = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await armed.find({ key: 'reset-confirm' })).toBeDefined()
  await armed.press({ key: 'settings-back' })
  await armed.unmount()

  const back = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await back.find({ key: 'meter-change' })).toBeDefined()
  await back.press({ key: 'settings-toggle' })
  await back.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await again.find({ key: 'reset-confirm' })).toBe(undefined)
  await again.unmount()
})

test('after the first present the meter counts toward the next noon', () => {
  const started = noteMilestones(fresh(), NINE_AM, TIMED.slice(0, 1))
  const noon = new Date(2026, 10, 9, 12, 0).getTime()

  expect(dailyProgress(noon).percent).toBe(0)
  expect(dailyProgress(noon).leftMs).toBe(24 * 60 * MINUTE)
  expect(dailyProgress(noon - MINUTE).leftMs).toBe(MINUTE)
  expect(presentProgress(started, NINE_AM + 2 * MINUTE, TIMED.slice(0, 1))).toBe(undefined)
  expect(presentProgress(started, NINE_AM + 2 * MINUTE, TIMED.slice(0, 1), true)?.leftMs).toBe(noon - (NINE_AM + 2 * MINUTE))
  expect(takePopups(pickMeter(fresh(), 'line42'), true).saved.marksPending).toBe(1)
})

test('the catalogue reads the 15-second present and the daily setting', () => {
  const parsed = parseCatalog(JSON.stringify({ dailyPresent: true, milestones: [{ id: 'first', minutes: 0.25, brand: 'Test A', text: 'x', code: 'TEST-T001' }] }))

  expect(parsed.dailyPresent).toBe(true)
  expect(parsed.milestones[0].minutes).toBe(0.25)
})

engineTest('a new person starts on one of the two default meters, with the welcome once', async ($, on) => {
  const choices = ['rain', 'hexdump'] as const

  expect(assignFirstMeter(fresh(), choices, 2).meter).toBe('rain')
  expect(assignFirstMeter(fresh(), choices, 3).meter).toBe('hexdump')
  expect(assignFirstMeter(fresh(), choices, 3).marksPending).toBe(1)
  expect(assignFirstMeter(pickMeter(fresh(), 'pipeline'), choices, 3).meter).toBe('pipeline')
  expect(assignFirstMeter(fresh(), [], 3).meter).toBe(null)

  catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), defaultMeters: choices })
  const { lines } = usageEngine(on, () => [])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'carousel-choose' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^Test W$/ })).toBeDefined()
  await ui.unmount()
  expect(lines.length).toBeGreaterThan(0)
  catalogNow = CATALOG
})

// ---- The acceptance step ----

const TERMS = { version: 'v2', effective: '2026-12-01' }
const never = () => readConsent(undefined)
const BEFORE_EFFECT = new Date(2026, 10, 20).getTime()
const AFTER_EFFECT = new Date(2026, 11, 2).getTime()

async function withConsent(seed: unknown, run: () => Promise<void>) {
  consentSeed = seed

  try {
    await run()
  } finally {
    consentSeed = GIVEN
    catalogNow = CATALOG
    savedSeed = { meterDisplay: 'always' }
  }
}

async function remount($: any, ui: any, surface: 'terminal' | 'desktop') {
  await ui.unmount()

  return $.ui.mount({ ...PANE, surface })
}

// The test's redraw does nothing, so a new drawing shows the result of a press.
async function pressAndRedraw($: any, ui: any, key: string, surface: 'terminal' | 'desktop' = 'terminal') {
  await ui.press({ key })

  return remount($, ui, surface)
}

const WITH_METER = { meter: 'hexdump', meterDisplay: 'always' }

function countingEngine(on: any, nowMs = NINE_AM) {
  const calls = { usage: 0 }

  return {
    calls,
    ...usageEngine(on, () => {
      calls.usage += 1

      return []
    }, nowMs),
  }
}

test('consent: nothing readable means never asked', () => {
  expect(viewOf(readConsent(undefined), NINE_AM)).toBe('ask')
  expect(viewOf(readConsent('junk'), NINE_AM)).toBe('ask')
  expect(viewOf(readConsent({ status: 'yes' }), NINE_AM)).toBe('ask')
  expect(isRunning('ask')).toBe(false)
})

test('consent: every state maps to the right view and line', () => {
  const given = accept(never(), NINE_AM, TERMS)
  const old = { ...given, termsVersion: 'v1' }

  expect(viewOf(given, NINE_AM, TERMS)).toBe('active')
  expect(given.wordingVersion).toBe(WORDING_VERSION)
  expect(given.history.map(item => item.event)).toEqual(['given'])
  expect(viewOf(decline(never(), NINE_AM, TERMS), NINE_AM, TERMS)).toBe('declined')
  expect(viewOf(withdraw(given, NINE_AM, TERMS), NINE_AM, TERMS)).toBe('withdrawn')
  expect(viewOf(old, BEFORE_EFFECT, TERMS)).toBe('update-notice')
  expect(viewOf(old, AFTER_EFFECT, TERMS)).toBe('update-required')
  expect(isRunning('update-notice')).toBe(true)
  expect(isRunning('update-required')).toBe(false)
  expect(consentLine('active', given, NINE_AM, TERMS)).toBe(null)
  expect(consentLine('declined', given, NINE_AM, TERMS)).toEqual({ line: undefined })
  expect(consentLine('update-required', old, AFTER_EFFECT, TERMS)).toEqual({ line: CONSENT_TEXT.updateLine })
  expect(consentLine('update-notice', dismissUpdate(old, TERMS), BEFORE_EFFECT, TERMS)).toBe(null)
  expect(consentLine('update-required', dismissUpdate(old, TERMS), AFTER_EFFECT, TERMS)).toEqual({ line: undefined })
})

test('consent: the invitation goes quiet after 7 days and proofreading asks nobody again', () => {
  const seen = { ...never(), inviteFirstSeen: NINE_AM }

  expect(consentLine('ask', never(), NINE_AM)).toEqual({ line: CONSENT_TEXT.invite })
  expect(consentLine('ask', seen, NINE_AM + 6 * 24 * 60 * MINUTE)).toEqual({ line: CONSENT_TEXT.invite })
  expect(consentLine('ask', seen, NINE_AM + 7 * 24 * 60 * MINUTE)).toEqual({ line: undefined })
  expect(viewOf({ ...accept(never(), NINE_AM, TERMS), wordingVersion: 'older' }, NINE_AM, TERMS)).toBe('active')
})

test('consent: the Undo of "Pauzza is on" brings back exactly the acceptance switched off, never the current texts', () => {
  const old = { ...accept(never(), NINE_AM, { version: 'local-1', effective: '2026-11-09' }), wordingVersion: 'stage-1.4-en' }
  const off = withdraw(old, NINE_AM + MINUTE, TERMS)
  const back = undoWithdraw(off, NINE_AM + MINUTE + 5 * SECOND)

  expect(off.wordingVersion).toBe('stage-1.4-en')
  expect(back.status).toBe('given')
  expect(back.termsVersion).toBe('local-1')
  expect(back.wordingVersion).toBe('stage-1.4-en')
  expect(back.deletePending).toBe(false)
  expect(back.history.at(-1)).toEqual({ event: 'given', termsVersion: 'local-1', wordingVersion: 'stage-1.4-en', at: NINE_AM + MINUTE + 5 * SECOND })
  // Still the earlier Terms: asked again, and paused once the new ones apply.
  expect(viewOf(back, AFTER_EFFECT, TERMS)).toBe('update-required')
  // Too late, already deleted, or nothing switched off: nothing changes.
  expect(undoWithdraw(off, NINE_AM + MINUTE + UNDO_MS)).toBe(off)
  const deleted = finishDelete(off)
  expect(undoWithdraw(deleted, NINE_AM + MINUTE + SECOND)).toBe(deleted)
  expect(undoWithdraw(old, NINE_AM + MINUTE)).toBe(old)
  const declined = decline(never(), NINE_AM, TERMS)
  expect(undoWithdraw(declined, NINE_AM + SECOND)).toBe(declined)
})

test('consent: deletion waits exactly for the undo time', () => {
  const gone = withdraw(accept(never(), NINE_AM, TERMS), NINE_AM, TERMS)

  expect(shouldDelete(gone, NINE_AM + UNDO_MS - 1)).toBe(false)
  expect(shouldDelete(gone, NINE_AM + UNDO_MS)).toBe(true)
  expect(shouldDelete(finishDelete(gone), NINE_AM + UNDO_MS)).toBe(false)
})

test('consent: the wording around the one press never says consent, and points to the Connect button', () => {
  // The separate tick and its own lines are gone: the Connect card's words are the acceptance (connect-text.ts).
  for (const gone of ['what', 'tick', 'age', 'cancelIn', 'updateTick']) {
    expect(Object.hasOwn(CONSENT_TEXT, gone)).toBe(false)
  }

  expect(CONSENT_TEXT.later).toBe('Not now')
  expect(CONSENT_TEXT.settingOn).toBe('☑ Pauzza is on')
  expect(CONSENT_TEXT.settingWarn).toBe('If you switch Pauzza off, it stops and saved data is deleted.')
  expect(CONSENT_TEXT.updated).toBe('Terms updated')
  expect(CONSENT_TEXT.declined).toBe('OK. Pauzza will show nothing and count nothing. If you change your mind, press "Connect".')
  expect(CONSENT_TEXT.stopped).toBe('Pauzza is stopped. If you change your mind, press "Connect".')
  // Everyone who accepted the earlier tick (local-1) is asked again, from the Stage B start.
  expect(TERMS_VERSION).not.toBe('local-1')
  expect(TERMS_EFFECTIVE).toBe('2026-11-20')
  expect(Object.values(CONSENT_TEXT).filter(item => typeof item === 'string' && /\bBy ticking\b|\btick it\b|sends nothing|I accept the/i.test(item))).toEqual([])
  expect(documentUrl('TERMS.md', 'https://github.com/owner/pauzza-addon')).toBe('https://github.com/owner/pauzza-addon/blob/main/TERMS.md')
  expect(documentUrl('PRIVACY.md', 'https://github.com/owner/pauzza-addon')).toBe('https://github.com/owner/pauzza-addon/blob/main/PRIVACY.md')
  expect(CONSENT_TEXT.samples).toBe('Samples · not real offers')
  expect(Object.values(CONSENT_TEXT).filter(item => /consent|processing/i.test(typeof item === 'string' ? item : item(10)))).toEqual([])
})

engineTest('first run: nothing before the one press, then the present after 15 seconds', async ($, on) => {
  await withConsent(undefined, async () => {
    catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), defaultMeters: ['rain'], milestones: [{ id: 'first', minutes: 0.25, brand: 'Test Q', text: 'x', code: 'TEST-Q001' }] })
    const { clock, lines, toasts, calls, sent } = countingEngine(on, new Date(2026, 10, 9, 13, 0).getTime())
    await start($)

    expect(lines.at(-1)).toBe(CONSENT_TEXT.invite)
    await clock.advance(5 * MINUTE)
    await setWorking($, true)
    await clock.advance(5 * MINUTE)
    await setWorking($, false)
    expect(calls.usage).toBe(0)
    expect(toasts).toEqual([])

    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const press = await ui.find({ key: 'connect-press' })
    expect(press.props.label).toBe(CONNECT_TEXT.connect)
    expect(press.props.autoFocus).toBe(undefined)
    expect(press.props.hotkey).toBe(undefined)
    expect(press.props.variant).toBe('primary')
    expect((await ui.find({ key: 'consent-later' })).props.dimColor).toBe(undefined)
    expect(await ui.find({ key: 'consent-later' })).toBeDefined()
    expect(await ui.find({ key: 'consent-tick' })).toBe(undefined)
    expect(await ui.find({ key: 'settings-toggle' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /Test/ })).toBe(undefined)
    expect(calls.usage).toBe(0)
    expect(sent).toEqual([])

    // The one press accepts and connects; here the connection fails calmly, and Pauzza runs on this computer.
    ui = await pressAndRedraw($, ui, 'connect-press', 'desktop')
    expect(sent).toHaveLength(1)
    expect(lines.at(-1)).not.toBe(CONSENT_TEXT.invite)
    expect(await ui.find({ type: 'Text', text: /accepted/i })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^Samples · not real offers$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Test W$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Test Q$/ })).toBe(undefined)
    await clock.advance(16 * 1000)
    ui = await remount($, ui, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^Test Q$/ })).toBeDefined()
    expect(calls.usage).toBeGreaterThan(0)
    await ui.unmount()
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  engineTest(`declining (${surface}): offers stay off, the line empties, the one button stays`, async ($, on) => {
    await withConsent(undefined, async () => {
      const { lines, toasts, clock, calls, sent } = countingEngine(on)
      await start($)
      let ui = await $.ui.mount({ ...PANE, surface })
      ui = await pressAndRedraw($, ui, 'consent-later', surface)

      expect(lines.at(-1)).toBe(undefined)
      expect(await ui.find({ key: 'consent-later' })).toBe(undefined)
      expect(await ui.find({ key: 'connect-press' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /count nothing/ })).toBeDefined()
      await clock.advance(10 * MINUTE)
      expect(calls.usage).toBe(0)
      expect(toasts).toEqual([])
      expect(sent).toEqual([])
      await ui.unmount()
    })
  })
}

engineTest('ignoring: the line goes quiet, nothing opens, and the one button stays available', async ($, on) => {
  await withConsent({ status: 'none', inviteFirstSeen: NINE_AM - 8 * 24 * 60 * MINUTE }, async () => {
    const { lines, opened } = usageEngine(on, () => [])
    await start($)
    expect(lines.at(-1)).toBe(undefined)
    expect(opened).toEqual([])
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'connect-press' })).toBeDefined()
    await ui.unmount()
  })
})

engineTest('the documents the press accepts open inside the panel before it', async ($, on) => {
  await withConsent(undefined, async () => {
    const { sent } = fakeEngine(on)
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    ui = await pressAndRedraw($, ui, 'connect-terms', 'desktop')
    expect((await ui.find({ key: 'document-text' })).props.text).toMatch(/TERMS\.md\n$/)
    expect(await ui.find({ key: 'document-online' })).toBe(undefined)
    ui = await pressAndRedraw($, ui, 'document-back', 'desktop')
    ui = await pressAndRedraw($, ui, 'connect-privacy', 'desktop')
    expect((await ui.find({ key: 'document-text' })).props.text).toMatch(/PRIVACY\.md\n$/)
    ui = await pressAndRedraw($, ui, 'document-back', 'desktop')
    expect(await ui.find({ key: 'connect-press' })).toBeDefined()
    expect(sent).toEqual([])
    await ui.unmount()
  })
})

engineTest('withdrawing is one press: stops at once, undo restores, otherwise data goes', async ($, on) => {
  savedSeed = WITH_METER
  const { clock, lines, store } = usageEngine(on, () => [])
  await start($)
  await openSettings($)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /saved data is deleted\./ })).toBeDefined()
  ui = await pressAndRedraw($, ui, 'consent-untick')

  expect(lines.at(-1)).toBe(undefined)
  expect(await ui.find({ key: 'consent-undo' })).toBeDefined()
  expect(store.get('saved')).toBeDefined()
  ui = await pressAndRedraw($, ui, 'consent-undo')
  expect(await ui.find({ key: 'consent-untick' })).toBeDefined()
  const presses = readConsent(store.get('consent')).history
  expect(presses.map(item => item.event)).toEqual(['withdrawn', 'given'])
  // Every press, the undo included, is saved with its time and both versions.
  for (const item of presses) {
    expect(typeof item.at).toBe('number')
    expect(item.termsVersion).toBe(TERMS_VERSION)
    expect(item.wordingVersion).toBe(WORDING_VERSION)
  }

  ui = await pressAndRedraw($, ui, 'consent-untick')
  await clock.advance(11 * 1000)
  ui = await remount($, ui, 'terminal')
  expect(store.get('saved')).toBe(undefined)
  const record = readConsent(store.get('consent'))
  expect(record.status).toBe('withdrawn')
  expect(record.deletePending).toBe(false)
  // Coming back is the same one press, with no Not now.
  expect(await ui.find({ key: 'connect-press' })).toBeDefined()
  expect(await ui.find({ key: 'consent-later' })).toBe(undefined)
  await ui.unmount()
  savedSeed = { meterDisplay: 'always' }
})

engineTest('a deletion interrupted by closing the session finishes at the next start', async ($, on) => {
  await withConsent({ ...GIVEN, status: 'withdrawn', at: NINE_AM - MINUTE, deletePending: true }, async () => {
    const { store } = usageEngine(on, () => [])
    await start($)
    expect(store.get('saved')).toBe(undefined)
  })
})

engineTest('deleting saved data keeps the acceptance', async ($, on) => {
  savedSeed = WITH_METER
  const { store } = usageEngine(on, () => [])
  await start($)
  await openSettings($)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  ui = await pressAndRedraw($, ui, 'reset')
  ui = await pressAndRedraw($, ui, 'reset-confirm')
  await ui.unmount()

  expect(readConsent(store.get('consent')).status).toBe('given')
  savedSeed = { meterDisplay: 'always' }
})

// The day TERMS_EFFECTIVE names, at the given hour on this computer's clock.
const onEffectiveDay = (hour: number, days = 0) => {
  const [year, month, day] = TERMS_EFFECTIVE.split('-').map(Number)

  return new Date(year, month - 1, day + days, hour, 0).getTime()
}

for (const surface of ['terminal', 'desktop'] as const) {
  engineTest(`changed terms before they apply (${surface}): keeps running and asks again with the one press`, async ($, on) => {
    await withConsent({ ...GIVEN, termsVersion: 'older' }, async () => {
      savedSeed = WITH_METER
      const { lines, store } = usageEngine(on, () => [], onEffectiveDay(9, -1))
      await start($)

      expect(lines.at(-1)).toBe(CONSENT_TEXT.updateLine)
      let ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /^Terms updated$/ })).toBeDefined()
      expect((await ui.find({ key: 'connect-press' })).props.label).toBe(CONNECT_TEXT.connect)
      // One button only: the update notice holds it, and no second Connect card shows.
      expect(await ui.findAll({ key: 'connect-press' })).toHaveLength(1)
      expect(await ui.find({ key: 'meter-change' })).toBeDefined()
      ui = await pressAndRedraw($, ui, 'connect-press', surface)
      expect(await ui.find({ type: 'Text', text: /^Terms updated$/ })).toBe(undefined)
      expect(readConsent(store.get('consent')).termsVersion).toBe(TERMS_VERSION)
      await ui.unmount()
    })
  })
}

engineTest('changed terms after they apply: pauses, keeps prizes, can still withdraw', async ($, on) => {
  await withConsent({ ...GIVEN, termsVersion: 'older' }, async () => {
    savedSeed = WITH_METER
    const { lines, store, calls } = countingEngine(on, onEffectiveDay(9))
    await start($)

    expect(lines.at(-1)).toBe(CONSENT_TEXT.updateLine)
    expect(calls.usage).toBe(0)
    let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'meter-change' })).toBe(undefined)
    ui = await pressAndRedraw($, ui, 'consent-later')
    expect(lines.at(-1)).toBe(undefined)
    expect((store.get('saved')).meter).toBe('hexdump')
    ui = await pressAndRedraw($, ui, 'settings-toggle')
    expect(await ui.find({ key: 'consent-untick' })).toBeDefined()
    await ui.unmount()
  })
})

// F8 and F9 through the whole add-on: a hostile catalogue never stops it.
const HOSTILE_CATALOGUES: Record<string, () => string> = {
  'one 150,000-character field': () => JSON.stringify({ ...JSON.parse(CATALOG), offers: [{ ...offer('aaaa', 'food', '2026-11-01'), text: 'x'.repeat(150_000) }] }),
  'a catalogue over the size limit': () => 'x'.repeat(300_000),
  'an unfinished catalogue': () => '{"offers":',
  'categories named like built-in objects': () => JSON.stringify({ ...JSON.parse(CATALOG), categories: ['constructor', '__proto__', 'toString'].map(id => ({ id, label: 'x' })), offers: [offer('aaaa', 'constructor', '2026-11-01')] }),
}

for (const [name, make] of Object.entries(HOSTILE_CATALOGUES)) {
  engineTest(`hostile catalogue, ${name}: the add-on still starts, draws and opens`, async ($, on) => {
    catalogNow = make()
    const { lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
    await start($)

    for (const surface of ['terminal', 'desktop']) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text' })).toBeDefined()
      await ui.unmount()
    }

    expect(lines.length > 0).toBe(true)
  })
}

// ---- Loadings v2: the terminal meters ----

const V2 = ['line42', 'pipeline', 'install', 'rain', 'hexdump'] as const
// The six food meters of Loadings v1, retired in 0.18.1, and the clay jar before them.
const RETIRED = ['wine', 'khinkali', 'churchkhela', 'marshrutka', 'khachapuri', 'normal', 'qvevri'] as const
const BRAND = { yellow: '#FFC800', ink: '#141015', red: '#F2453D', green: '#5BFF8F', terminal: '#0B0F0C', band: '#352A12' }
const count = (text: string, piece: string) => text.split(piece).length - 1
const sources = async (ui: any) => (await ui.findAll({ type: 'Svg' })).map((svg: any) => svg.props.source as string)

test('v2: the picker holds the five terminal meters and nothing else', () => {
  expect(METERS.map(meter => meter.id)).toEqual([...V2])
  expect(LOADINGS.map(loading => loading.id)).toEqual([...V2])
  expect(new Set(METERS.map(meter => meter.name)).size).toBe(5)
  V2.forEach(id => {
    expect(isMeterId(id)).toBe(true)
    expect(readSaved({ meter: id }, NINE_AM).meter).toBe(id)
    expect(pickMeter(fresh(), id).meter).toBe(id)
  })
  ;[...RETIRED, 'matrix'].forEach(id => expect(isMeterId(id)).toBe(false))
})

test('v2: a saved retired or unknown meter lands on line 42; no choice stays no choice', () => {
  ;[...RETIRED, 'matrix', 'LINE42', ' line42', '__proto__', 'constructor', '"/><script>'].forEach(name => {
    expect(savedMeter(name)).toBe('line42')
    expect(readSaved({ meter: name }, NINE_AM).meter).toBe('line42')
  })
  ;[undefined, null, '', 0, 7, true, {}, [], ['wine'], { id: 'wine' }].forEach(nothing => {
    expect(savedMeter(nothing)).toBe(null)
    expect(readSaved({ meter: nothing }, NINE_AM).meter).toBe(null)
  })
  V2.forEach(id => expect(savedMeter(id)).toBe(id))
})

test('v2: moving off a retired meter loses nothing else that was saved', () => {
  const before = {
    date: dayKey(NINE_AM),
    minutes: 42,
    claimedRewards: ['m15', 'm30'],
    finishEarned: true,
    marksRaised: 2,
    marksPending: 3,
    dropClaimed: true,
    goodPaceEarned: true,
    goodPaceNotice: true,
    recent: ['aaaa', 'bbbb'],
    meter: 'khinkali',
    welcomeEarned: true,
    windowResetAt: NINE_AM + 80 * MINUTE,
    windowPeak: 61,
    installedAt: NINE_AM - 3 * 24 * 60 * MINUTE,
    milestonesSeen: ['first-present'],
    meterDisplay: 'off',
    popupsOn: false,
    dropPopupShown: true,
    burnFiveEarned: true,
    burnWeekUntil: NINE_AM + 2 * 24 * 60 * MINUTE,
    updateAnnounced: '0.22.0',
  }

  RETIRED.forEach(meter => {
    const after = readSaved({ ...before, meter }, NINE_AM)

    expect(after).toEqual({ ...before, meter: 'line42' })
    // Reading it again changes nothing, and it is not treated as a new person.
    expect(readSaved(after, NINE_AM)).toEqual(after)
    expect(assignFirstMeter(after, ['rain'], NINE_AM)).toEqual(after)
  })

  // On a later day the per-day counts start again as always; the lasting part is kept.
  const nextDay = readSaved({ ...before, meter: 'marshrutka' }, NINE_AM + 24 * 60 * MINUTE)
  expect(nextDay.meter).toBe('line42')
  expect(nextDay.welcomeEarned).toBe(true)
  expect(nextDay.recent).toEqual(before.recent)
  expect(nextDay.installedAt).toBe(before.installedAt)
  expect(nextDay.milestonesSeen).toEqual(before.milestonesSeen)
  expect(nextDay.meterDisplay).toBe('off')
  expect(nextDay.popupsOn).toBe(false)
  expect(nextDay.burnWeekUntil).toBe(before.burnWeekUntil)
  expect(nextDay.updateAnnounced).toBe(before.updateAnnounced)
})

engineTest('v2: someone who had a retired meter opens on line 42 with their prizes, settings and acceptance kept', async ($, on) => {
  savedSeed = { date: dayKey(NINE_AM), meter: 'khinkali', meterDisplay: 'always', welcomeEarned: true, minutes: 20, claimedRewards: ['m15'], popupsOn: false, recent: ['aaaa'] }
  const { lines, store, toasts, reads } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
  await start($)

  expect(lines.at(-1)).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m')
  expect(lines).not.toContain('🎁 choose your meter · /pauzza')
  expect(lines).not.toContain(CONSENT_TEXT.invite)
  expect(toasts).toEqual([])
  expect(store.get('consent')).toEqual(GIVEN)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'carousel-choose' })).toBe(undefined)
  // Not asked again: no Not now and no "Terms updated".
  expect(await ui.find({ key: 'consent-later' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /^Terms updated$/ })).toBe(undefined)
  expect(await ui.find({ key: 'meter-change' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^line 42$/ })).toBeDefined()
  expect(await sources(ui)).toContain(loadingSvg('line42', 50))
  // The welcome reward is there once, and not given a second time.
  expect(await ui.findAll({ type: 'Text', text: /^Test W$/ })).toHaveLength(1)
  await ui.unmount()

  const kept = store.get('saved') as any
  expect(kept.minutes).toBe(20)
  expect(kept.claimedRewards).toEqual(['m15'])
  expect(kept.popupsOn).toBe(false)
  expect(kept.recent).toEqual(['aaaa'])
  expect(kept.welcomeEarned).toBe(true)
  expect(kept.marksPending ?? 0).toBe(0)

  // The picker offers the five only, and choosing saves a current name.
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  ui = await pressAndRedraw($, ui, 'meter-change')
  await chooseMeter(ui, 'install')
  await ui.unmount()
  expect((store.get('saved') as any).meter).toBe('install')
  expect((store.get('saved') as any).claimedRewards).toEqual(['m15'])
  expect(lines.at(-1)).toBe('+ [█████·····] 21/42 50% ↻1h 20m')
  // No picture file is opened any more: the catalogue and the release's own
  // settings (the test's end date and the trusted public keys) are the only files read here.
  expect([...new Set(reads)].sort()).toEqual(['offers.json', 'release.json'])
})

test('v2: the status-line forms count what their pictures count', () => {
  expect([0, 50, 99, 100].map(lineAt)).toEqual([1, 21, 41, 42])
  expect([0, 33, 34, 66, 67, 99, 100].map(stageAt)).toEqual([0, 0, 1, 1, 2, 2, 3])
  expect([0, 50, 99, 100].map(packagesAt)).toEqual([0, 21, 41, 42])
  expect([0, 50, 100].map(bytesAt)).toEqual([0, 16, 32])
  expect(DUMP_TEXT).toBe('take a break; paused on line 42.')
  expect(DUMP_TEXT.length).toBe(32)
  expect(drawMeter('install', 52)).toBe('+ [█████▎····] 21/42 52%')
  expect(drawMeter('install', 1)).toBe('+ [▏·········] 0/42 1%')
  expect(drawMeter('hexdump', 3)).toBe('2a: 74 __ .. .. .. .. .. .. |t.......| 3%')
  expect(drawMeter('line42', 99)).toBe('ln 41 ─────────>● 99%')
})

test('v2: status-line characters are terminal-safe, with no emoji, star or play mark', () => {
  const allowed = /^[\x20-\x7e─┄●·█▏▎▍▌▋▊▉▁▂▃▄▅▆▇]+$/u

  V2.forEach(id => {
    for (let p = 0; p <= 100; p += 1) {
      for (const frame of [undefined, 0, 1, 2, 3]) {
        const line = drawMeter(id, p, frame)

        expect(allowed.test(line)).toBe(true)
        expect(/[*▶]/u.test(line)).toBe(false)
        expect(line.endsWith(` ${p}%`)).toBe(true)
        expect(Array.from(line).length).toBeLessThanOrEqual(45)
      }
    }
  })
})

test('v2: each form moves with the frame, keeps the real percent, and stops at the end', () => {
  expect(drawMeter('line42', 50, 1)).toBe('ln 21 ─────·┄┄┄┄● 50%')
  expect(drawMeter('line42', 50, 2)).toBe('ln 21 ─────>┄┄┄┄● 50%')
  expect([0, 1, 2, 3].map(frame => drawMeter('pipeline', 50, frame))).toEqual(['|', '/', '-', '\\'].map(mark => `[x]build [${mark}]test [ ]ship [ ]treat 50%`))
  expect(drawMeter('install', 50, 1)).toBe('/ [█████·····] 21/42 50%')
  expect(drawMeter('rain', 50, 1)).not.toBe(drawMeter('rain', 50, 2))
  expect(drawMeter('hexdump', 50, 1)).toBe('33: 65 61 6b 3b 20 70 61 .. |eak; pa.| 50%')
  V2.forEach(id => {
    expect(drawMeter(id, 100, 1)).toBe(drawMeter(id, 100))
    // The rain never repeats; the others come round every four frames.
    expect(drawMeter(id, 50, 4) === drawMeter(id, 50, 0)).toBe(id !== 'rain')
  })

  const base = { five: { percent: 50, resetMs: undefined }, gifts: 0, isGoodPace: false, waitedMinutes: 0, now: 1 }
  V2.forEach(id => {
    expect(canAnimate({ ...base, meter: id })).toBe(true)
    expect(canAnimate({ ...base, meter: id, display: 'ready' })).toBe(false)
    expect(canAnimate({ ...base, meter: id, five: { percent: 100, resetMs: undefined } })).toBe(false)
    expect(canAnimate({ ...base, meter: id, five: undefined })).toBe(false)
  })
  expect(canAnimate({ ...base, meter: 'rain', five: { percent: 0, resetMs: undefined } })).toBe(false)
  expect(canAnimate({ ...base, meter: 'line42', five: { percent: 0, resetMs: undefined } })).toBe(true)
  expect(statusLine({ ...base, meter: 'hexdump', now: NINE_AM, five: { percent: 100, resetMs: NINE_AM + 80 * MINUTE } })).toBe('42: 6c 69 6e 65 20 34 32 2e |line 42.| 100% 🛋 Limit Lounge · /pauzza ↻1h 20m')
  expect(statusLine({ ...base, meter: 'line42', five: undefined, present: { percent: 50, leftMs: 30 * SECOND } })).toBe('ln 21 ─────>┄┄┄┄● 50% →🎁 30s')
})

test('v2: every picture is one self-contained drawing in brand colours, at every percent', () => {
  V2.forEach(id => {
    for (let p = 0; p <= 100; p += 1) {
      for (const svg of [loadingSvg(id, p), loadingTileSvg(id, p)]) {
        expect(svg.length).toBeLessThanOrEqual(131072)
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
        expect(svg.endsWith('</svg>')).toBe(true)
        expect(count(svg, '<svg')).toBe(1)
        expect(count(svg, 'http')).toBe(1)
        expect(/<image|<script|<foreignObject|href=|url\((?!#sky\))|\son[a-z]+=|NaN|undefined|Infinity/.test(svg)).toBe(false)
        expect(svg).toContain(BRAND.terminal)
        // Movement is offered only to people who have not asked for less of it.
        expect(count(svg, '<style>@media (prefers-reduced-motion:no-preference){')).toBe(1)
        expect(count(svg, 'animation')).toBe(count(svg.slice(svg.indexOf('<style>'), svg.indexOf('</style>')), 'animation'))
      }
    }

    expect(loadingSvg(id, 52)).toContain('viewBox="0 0 380 96"')
    expect(loadingTileSvg(id, 52)).toContain('viewBox="0 0 104 64"')
    expect(loadingSvg(id, 51.6)).toBe(loadingSvg(id, 52))
    expect(loadingSvg(id, 400)).toBe(loadingSvg(id, 100))
    expect(loadingSvg(id, -3)).toBe(loadingSvg(id, 0))
    expect(new Set([0, 52, 100].map(p => loadingSvg(id, p))).size).toBe(3)
    expect(new Set([0, 52, 100].map(p => loadingTileSvg(id, p))).size).toBe(3)
    // The finished picture always carries the brand yellow: the tag or the tagline.
    expect(loadingSvg(id, 100)).toContain(BRAND.yellow)
  })
})

test('v2: line 42 at 0%, partial and full', () => {
  const [empty, partial, full] = [0, 52, 100].map(p => loadingSvg('line42', p))

  expect(empty).toContain('ln 01/42')
  expect(empty).not.toContain(BRAND.band)
  expect(partial).toContain('ln 22/42')
  expect(partial).toContain('>22</text>')
  expect(partial).not.toContain('take a break;')
  expect(full).toContain(BRAND.band)
  expect(full).toContain('paused on line 42.')
  expect(full).toContain('>take a break;</text>')
  expect(full).toContain('while (ai.thinking) {')
  // The red dot never sits straight on yellow: the ink ring is under it.
  expect(full).toContain(`<circle cx="80" cy="80" r="50" fill="${BRAND.ink}"/><circle cx="80" cy="80" r="30" fill="${BRAND.red}"/>`)
  expect(partial).not.toContain(BRAND.ink)
  expect(count(loadingTileSvg('line42', 100), BRAND.band)).toBe(1)
})

test('v2: the pipeline at 0%, partial and full', () => {
  const [empty, partial, full] = [0, 52, 100].map(p => loadingSvg('pipeline', p))
  const done = `fill="${BRAND.green}"/><path d="M-4.5`

  expect([empty, partial, full].map(svg => count(svg, done))).toEqual([0, 1, 3])
  expect([empty, partial, full].map(svg => count(svg, 'class="sp"'))).toEqual([1, 1, 0])
  expect(empty).toContain('build: 0 errors, 42 warnings (ignored)')
  expect(partial).toContain('test: 41 passed, 1 flaky (retry until green)')
  expect(loadingSvg('pipeline', 80)).toContain('ship: it is friday. deploying anyway.')
  expect(full).toContain('pipeline green. take a break;')
  expect(full).toContain(BRAND.red)
  expect(partial).not.toContain(BRAND.red)
  ;['build', 'test', 'ship', 'treat', 'run #42'].forEach(word => expect(partial).toContain(`>${word}</text>`))
})

test('v2: the install at 0%, partial and full', () => {
  const [empty, partial, full] = [0, 52, 100].map(p => loadingSvg('install', p))

  ;[empty, partial, full].forEach(svg => expect(svg).toContain('>pauzza add take-a-break</text>'))
  expect(empty).toContain('>0/42</text>')
  expect(empty).toContain('rubber-duck@1.0.0')
  expect(count(empty, 'stroke-dasharray="5 1.8"')).toBe(1)
  expect(partial).toContain('>21/42</text>')
  expect(count(partial, 'stroke-dasharray="5 1.8"')).toBe(2)
  expect(partial).toContain('H155.44"')
  expect(full).toContain('>42/42</text>')
  expect(full).toContain('take-a-break@42.0.0')
  expect(full).toContain('added 42 packages in 4.2s')
  expect(full).toContain('1 break earned')
  expect(full).toContain('H286"')
  expect(full).not.toContain('class="sp"')
})

test('v2: the rain at 0%, partial and full', () => {
  const [empty, partial, full] = [0, 52, 100].map(p => loadingSvg('rain', p))

  expect(count(empty, 'class="f f')).toBe(9)
  expect(empty).not.toContain(BRAND.yellow)
  expect(empty).toContain('steps(12)')
  expect(count(partial, 'class="f f')).toBe(9)
  expect(partial).toContain(BRAND.yellow)
  expect(partial).toContain('steps(7)')
  expect(partial).toContain('clip-path="url(#sky)"')
  expect(full).not.toContain('class="f f')
  expect(full).not.toContain('@keyframes fall')
  expect(full).toContain('>take a break;</text>')
  // Generic rain: digits and code punctuation only, no script's letters and no stars.
  V2.forEach(id => expect(/[\u0080-￿]/.test(loadingSvg(id, 52) + loadingTileSvg(id, 52))).toBe(false))
  expect(/>[^<]*\*[^<]*<\/text>/.test(partial + full)).toBe(false)
})

test('v2: the hexdump at 0%, partial and full', () => {
  const [empty, partial, full] = [0, 52, 100].map(p => loadingSvg('hexdump', p))

  expect(empty).toContain('>0x00/0x20</text>')
  expect(count(empty, '>..</text>')).toBe(31)
  expect(count(empty, 'class="bl"')).toBe(1)
  expect(partial).toContain('>0x11/0x20</text>')
  expect(count(partial, '>..</text>')).toBe(14)
  expect(full).toContain('>0x20/0x20</text>')
  expect(full).not.toContain('>..</text>')
  expect(full).not.toContain('class="bl"')
  ;['002a', '0032', '003a', '0042'].forEach(offset => expect(full).toContain(`>${offset}</text>`))
  expect(count(loadingTileSvg('hexdump', 52), 'fill-opacity="0.9"')).toBe(17)
  expect(count(loadingTileSvg('hexdump', 100), BRAND.yellow)).toBe(8)
})

test('v2: the picker dots fit the five meters, and would keep their room with more', () => {
  expect(dotsWidth(METERS.length)).toBe(64)
  expect(dotsSvg(5, 0)).toContain('width="64"')
  expect(count(dotsSvg(5, 3), '<circle')).toBe(5)
  expect(count(dotsSvg(5, 3), 'fill-opacity')).toBe(4)
  expect(dotsWidth(11)).toBe(106)
})

test('v2: a new install starts on one of the terminal meters', () => {
  const parsed = parseCatalog(JSON.stringify({ defaultMeters: [...V2, 'matrix'] }))

  expect(parsed.defaultMeters).toEqual([...V2])
  expect(V2.map((_, i) => assignFirstMeter(fresh(), parsed.defaultMeters, NINE_AM + i).meter).sort()).toEqual([...V2].sort())
  V2.forEach((_, i) => expect(assignFirstMeter(pickMeter(fresh(), 'rain'), parsed.defaultMeters, NINE_AM + i).meter).toBe('rain'))
  expect(parseCatalog(JSON.stringify({ defaultMeters: [...RETIRED] })).defaultMeters).toEqual([])
})

engineTest('v2: after accepting, the default terminal meter is pictured wide, and nothing is read before', async ($, on) => {
  await withConsent(undefined, async () => {
    catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), defaultMeters: ['hexdump'] })
    const { lines, calls } = countingEngine(on)
    await start($)
    expect(lines.at(-1)).toBe(CONSENT_TEXT.invite)

    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await sources(ui)).toContain(loadingSvg('hexdump', 0))
    expect(await ui.find({ type: 'Text', text: /^hexdump$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Test/ })).toBe(undefined)
    expect(calls.usage).toBe(0)

    ui = await pressAndRedraw($, ui, 'connect-press', 'desktop')
    expect(calls.usage).toBeGreaterThan(0)
    expect(await ui.find({ key: 'carousel-choose' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^hexdump$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Test W$/ })).toBeDefined()
    const wide = (await ui.findAll({ type: 'Svg' })).filter((svg: any) => svg.props.source.includes('viewBox="0 0 380 96"'))
    expect(wide).toHaveLength(1)
    expect(wide[0].props.isInteractive).toBe(undefined)
    expect(wide[0].props.alt).toMatch(/^2a: /)
    await ui.unmount()
  })
})

engineTest('v2: Change flips through the five meters only, wraps round both ways, and saves on choosing', async ($, on) => {
  savedSeed = { meter: 'line42', meterDisplay: 'always' }
  const { lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
  await start($)
  expect(lines.at(-1)).toBe('ln 21 ─────>┄┄┄┄● 50% ↻1h 20m')

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await sources(ui)).toContain(loadingSvg('line42', 50))
  ui = await pressAndRedraw($, ui, 'meter-change', 'desktop')
  const shown = await sources(ui)
  expect(shown).toContain(loadingTileSvg('line42', 50))
  expect(shown).toContain(fadedSvg(loadingTileSvg('pipeline', 50)))
  // The neighbour before the first meter is the last one.
  expect(shown).toContain(fadedSvg(loadingTileSvg('hexdump', 50)))
  expect(shown).toContain(dotsSvg(5, 0))
  shown.forEach((source: string) => expect(source).not.toContain('<image'))
  await chooseMeter(ui, 'hexdump')
  await ui.unmount()
  expect(lines.at(-1)).toBe('33: 65 61 6b 3b 20 70 61 __ |eak; pa.| 50% ↻1h 20m')
  expect(await panelHas($, /^hexdump$/)).toBe(true)

  // One step on from the last meter wraps round to the first.
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  ui = await pressAndRedraw($, ui, 'meter-change')
  ui = await pressAndRedraw($, ui, 'carousel-next')
  expect(await ui.find({ type: 'Text', text: /^line 42$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● ○ ○ ○ ○$/ })).toBeDefined()
  // Flipping is only a preview: the saved meter is still the one on the line.
  expect(lines.at(-1)).toBe('33: 65 61 6b 3b 20 70 61 __ |eak; pa.| 50% ↻1h 20m')
  await ui.press({ key: 'carousel-next' })
  await ui.press({ key: 'carousel-choose' })
  await ui.unmount()
  expect(lines.at(-1)).toBe('[x]build [~]test [ ]ship [ ]treat 50% ↻1h 20m')
  expect(await panelHas($, /^pipeline$/)).toBe(true)

  // Two steps back from the second meter wrap round to the last.
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  ui = await pressAndRedraw($, ui, 'meter-change')
  await ui.press({ key: 'carousel-prev' })
  ui = await pressAndRedraw($, ui, 'carousel-prev')
  expect(await ui.find({ type: 'Text', text: /^○ ○ ○ ○ ●$/ })).toBeDefined()
  await ui.press({ key: 'carousel-choose' })
  await ui.unmount()
  expect(lines.at(-1)).toBe('33: 65 61 6b 3b 20 70 61 __ |eak; pa.| 50% ↻1h 20m')

  // Every name the picker can save is one of the five: seven more steps go round them all.
  const saved: string[] = []

  for (let i = 0; i < 7; i += 1) {
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    ui = await pressAndRedraw($, ui, 'meter-change')
    await ui.press({ key: 'carousel-next' })
    await ui.press({ key: 'carousel-choose' })
    await ui.unmount()
    saved.push(V2.find(id => lines.at(-1) === `${drawMeter(id, 50)} ↻1h 20m`) ?? 'none')
  }

  expect(saved).toEqual(['line42', 'pipeline', 'install', 'rain', 'hexdump', 'line42', 'pipeline'])
})

engineTest('v2: a terminal meter moves on the line only while working, on the timer that was already there', async ($, on) => {
  savedSeed = { meter: 'pipeline', meterDisplay: 'always' }
  const { clock, lines } = usageEngine(on, () => [{ kind: 'five_hour', percentUsed: 50, resetsAt: IN_80() }])
  await start($)
  const still = lines.length

  await clock.advance(5 * SECOND)
  expect(lines.length).toBe(still)

  await setWorking($, true)
  await clock.advance(2 * SECOND)
  const moved = lines.slice(still) as string[]
  expect(moved.length).toBeGreaterThan(2)
  expect(moved.length).toBeLessThanOrEqual(6)
  moved.forEach(line => expect(line).toMatch(/^\[x\]build \[[|/\\-]\]test \[ \]ship \[ \]treat 50% ↻1h 20m$/))

  await setWorking($, false)
  expect(lines.at(-1)).toBe('[x]build [~]test [ ]ship [ ]treat 50% ↻1h 20m')
  const stopped = lines.length
  await clock.advance(5 * SECOND)
  expect(lines.length).toBe(stopped)
})

// English only: the Georgian, Mkhedruli, Mtavruli and Nuskhuri blocks, as escapes.
const GEORGIAN = /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/

// Walks every element the panel drew: its shown text and all its plain props
// (labels, alt texts, drawings, Markdown text, link addresses).
async function expectNoGeorgian(ui: any) {
  const drawn = await ui.findAll({})

  expect(drawn.length).toBeGreaterThan(3)

  for (const element of drawn) {
    expect(GEORGIAN.test(JSON.stringify([element.text, element.props]) ?? '')).toBe(false)
  }
}

async function leaveSettings($: any) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  if ((await ui.find({ key: 'settings-back' })) !== undefined) {
    await ui.press({ key: 'settings-back' })
  }

  await ui.unmount()
}

engineTest('English only: no Georgian character in any consent view, the active view, the line or a pop-up', async ($, on) => {
  const said: unknown[] = []
  const walk = async (surface: 'terminal' | 'desktop', keys: string[] = []) => {
    let ui = await $.ui.mount({ ...PANE, surface })

    for (const key of keys) {
      ui = await pressAndRedraw($, ui, key, surface)
    }

    await expectNoGeorgian(ui)
    await ui.unmount()
  }

  // The day before the Stage B texts apply, so that the changed-terms views below are both reached.
  const resetsAt = new Date(onEffectiveDay(0, 3)).toISOString()
  let limits: unknown[] = [{ kind: 'five_hour', percentUsed: 50, resetsAt }]
  const look = () => $.session.measure({ context: {}, rateLimits: [], changed: ['rateLimits'] })

  await withConsent(undefined, async () => {
    catalogNow = JSON.stringify({ ...JSON.parse(CATALOG), defaultMeters: ['rain'], dailyPresent: true, milestones: [{ id: 'first', minutes: 0.25, brand: 'Test Q', text: 'x', code: 'TEST-Q001' }] })
    const { clock, lines, toasts, store } = usageEngine(on, () => limits, onEffectiveDay(9, -1))
    await start($)
    await leaveSettings($)

    // Asked, with each document open, then declined.
    for (const surface of ['terminal', 'desktop'] as const) {
      await walk(surface)
      await walk(surface, ['connect-terms'])
      await walk(surface, ['document-back', 'connect-privacy'])
      await walk(surface, ['document-back'])
    }

    await walk('desktop', ['consent-later'])
    await walk('terminal')

    // Accepted with the one press (its connection fails calmly here): the
    // active view with its meter, then with each drawer open, the meter
    // picker and the settings.
    await walk('desktop', ['connect-press'])
    await walk('terminal')
    await clock.advance(4 * 60 * MINUTE)

    for (const surface of ['terminal', 'desktop'] as const) {
      await walk(surface)
      await walk(surface, ['drawer-day'])
      await walk(surface, ['drawer-food'])
      await walk(surface, ['drawer-gadgets'])
      await walk(surface, ['drawer-mine'])
      await walk(surface, ['meter-change'])
      await walk(surface, ['carousel-cancel', 'settings-toggle'])
      await walk(surface, ['display-off'])
      await walk(surface, ['display-always', 'reset'])
      await walk(surface, ['reset-cancel', 'settings-back'])
    }

    expect(await panelHas($, /^Next present in \d+ h$/)).toBe(true)

    // Changed terms: before they apply (still active), then after (paused).
    store.set('consent', { ...GIVEN, termsVersion: 'older' })
    await look()
    expect(await panelHas($, /^Terms updated$/)).toBe(true)
    await walk('terminal')
    await walk('desktop')
    await clock.advance(24 * 60 * MINUTE)
    expect(lines.at(-1)).toBe(CONSENT_TEXT.updateLine)
    await walk('terminal')
    await walk('desktop')

    // Accepted again and stopped at 100%: the Limit Lounge.
    await walk('desktop', ['connect-press'])
    limits = [{ kind: 'five_hour', percentUsed: 100, resetsAt }]
    await look()
    expect(await panelHas($, /^🛋 Limit Lounge: best offers first$/)).toBe(true)
    await walk('terminal')
    await walk('desktop')

    // Withdrawn: the undo countdown, then the stopped view.
    await walk('desktop', ['settings-toggle', 'consent-untick'])
    await walk('terminal')
    await clock.advance(11 * SECOND)
    expect(await panelHas($, /^Pauzza is stopped\./)).toBe(true)
    await walk('terminal')
    await walk('desktop')
    said.push(...lines, ...toasts)
    expect(toasts.length).toBeGreaterThan(1)
  })

  expect(said.length).toBeGreaterThan(5)
  expect(said.filter(line => typeof line === 'string' && GEORGIAN.test(line))).toEqual([])
  expect(Object.values(CONSENT_TEXT).filter(item => GEORGIAN.test(typeof item === 'string' ? item : item(10)))).toEqual([])
  expect(Object.values(CONNECT_TEXT).filter(item => GEORGIAN.test(typeof item === 'string' ? item : item(10)))).toEqual([])
  expect(METERS.filter(meter => GEORGIAN.test(meter.name))).toEqual([])
})
