// Loadings v2: the five terminal meters of the Breakpoint brand. Pure: the only
// inputs are a whole percentage and, for the status line, a frame number.
// Every picture is built here as SVG text, so the add-on ships no picture file.
//
// Movement inside a picture is CSS inside the SVG, under a "no reduced motion"
// media query: no timer runs for it, and with reduced motion, or where the
// surface drops the style, the picture is simply still and still complete.
// All wording of the new meters lives in this file.

export type LoadingId = 'line42' | 'pipeline' | 'install' | 'rain' | 'hexdump'
export type Loading = { id: LoadingId; name: string; draw: (percent: number, frame?: number) => string }

// The approved brand colours.
const YELLOW = '#FFC800'
const INK = '#141015'
const RED = '#F2453D'
const GREEN = '#5BFF8F'
const TERMINAL = '#0B0F0C'
const BAND = '#352A12'
const QUIET = '#6D6B6E'
const HEAD = '#D8FFE6'

const SPIN = ['|', '/', '-', '\\']
const part = (p: number, parts: number) => Math.round((p / 100) * parts)
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const mix = (a: number, b: number) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0

// ---- line 42: the cursor walks the gutter to the breakpoint ----

export const LAST_LINE = 42
export const lineAt = (p: number) => 1 + Math.floor((p / 100) * (LAST_LINE - 1))

const CODE_LOOP = [
  'const focus = deep()',
  'if (stuck) duck.ask()',
  '// TODO: remove this TODO',
  'retry(untilItWorks)',
  'let bugs = features + 1',
  'cache.clear() // just in case',
  'log("here")',
  'log("here 2")',
  'ship(friday) // brave',
]
const CODE_END: Record<number, [number, string]> = {
  38: [0, 'while (ai.thinking) {'],
  39: [2, 'coffee.sip()'],
  40: [2, 'deals.peek()'],
  41: [0, '}'],
  42: [0, 'take a break;'],
}
const codeLine = (n: number): [number, string] => (Object.hasOwn(CODE_END, n) ? CODE_END[n] : [0, CODE_LOOP[n % CODE_LOOP.length]])

function line42Text(p: number, frame?: number): string {
  if (p >= 100) {
    return `ln ${LAST_LINE} ${'─'.repeat(9)}● 100%`
  }

  const at = part(p, 9)
  const cursor = frame !== undefined && frame % 2 === 1 ? '·' : '>'

  return `ln ${lineAt(p)} ${'─'.repeat(at)}${cursor}${'┄'.repeat(9 - at)}● ${p}%`
}

// ---- pipeline: three stages, then the treat ----

export const STAGES = ['build', 'test', 'ship'] as const
const STAGE_LOG = [
  'build: 0 errors, 42 warnings (ignored)',
  'test: 41 passed, 1 flaky (retry until green)',
  'ship: it is friday. deploying anyway.',
  'pipeline green. take a break;',
]
export const stageAt = (p: number) => Math.min(STAGES.length, Math.floor((p * STAGES.length) / 100))

function pipelineText(p: number, frame?: number): string {
  const stage = stageAt(p)
  const running = frame === undefined ? '~' : SPIN[frame % SPIN.length]
  const boxes = STAGES.map((name, i) => `[${i < stage ? 'x' : i === stage ? running : ' '}]${name}`)

  return `${boxes.join(' ')} [${stage === STAGES.length ? 'x' : ' '}]treat ${p}%`
}

// ---- install: forty-two invented packages ----

export const PACKAGE_COUNT = 42
// Invented names. None is meant to be a real package of any registry.
const PACKAGES = [
  'rubber-duck@1.0.0',
  'yak-shaver@0.9.9',
  'works-on-my-box@6.6.6',
  'tabs-vs-spaces@2.4.0',
  'coffee-driver@3.0.0',
  'khinkali-fold@19.0.0',
  'null-snacks@0.0.0',
  'friday-deploy@5.0.0',
  'legacy-do-not-touch@1.9.99',
  'todo-later@0.1.0',
  'semicolon-finder@4.2.0',
  'stack-trace-tea@2.1.0',
  'one-more-tab@99.0.0',
]
const LAST_PACKAGE = 'take-a-break@42.0.0'
const INSTALL_COMMAND = 'pauzza add take-a-break'
const INSTALL_DONE = ['added 42 packages in 4.2s', '1 break earned']
const EIGHTHS = ' ▏▎▍▌▋▊▉'
export const packagesAt = (p: number) => Math.floor((p / 100) * PACKAGE_COUNT)
const packageName = (index: number) => (index >= PACKAGE_COUNT - 1 ? LAST_PACKAGE : PACKAGES[index % PACKAGES.length])

function installText(p: number, frame?: number): string {
  const eighths = part(p, 80)
  const full = Math.floor(eighths / 8)
  const rest = eighths % 8
  const cells = `${'█'.repeat(full)}${rest > 0 ? EIGHTHS[rest] : ''}${'·'.repeat(10 - full - (rest > 0 ? 1 : 0))}`
  const mark = p >= 100 || frame === undefined ? '+' : SPIN[frame % SPIN.length]

  return `${mark} [${cells}] ${packagesAt(p)}/${PACKAGE_COUNT} ${p}%`
}

// ---- rain: generic code rain that fills the screen from the floor up ----

const LEVELS = '▁▂▃▄▅▆▇█'
const RAIN_COLUMNS = 8
// No letters of any script, no stars: plain digits and code punctuation.
const GLYPHS = '01{};<>/=+_%#|^~?!01ab3cd7ef9'

function rainText(p: number, frame?: number): string {
  const base = part(p, LEVELS.length - 1)
  const columns = Array.from({ length: RAIN_COLUMNS }, (_, column) => {
    const wobble = p <= 0 || p >= 100 ? 0 : (mix(column, frame ?? 0) % 3) - 1

    return LEVELS[clamp(base + wobble, 0, LEVELS.length - 1)]
  })

  return `rain ${columns.join('')} ${p}%`
}

// ---- hexdump: 32 bytes, from offset 0x2a, that spell the two taglines ----

export const DUMP_TEXT = 'take a break; paused on line 42.'
const DUMP_ROW = 8
const DUMP_BASE = 0x2a
export const bytesAt = (p: number) => part(p, DUMP_TEXT.length)
const hexOf = (index: number) => DUMP_TEXT.charCodeAt(index).toString(16).padStart(2, '0')
const offsetOf = (row: number) => (DUMP_BASE + row * DUMP_ROW).toString(16)

function hexdumpText(p: number, frame?: number): string {
  const shown = bytesAt(p)
  // One row of eight that slides along with the cursor, like a tape.
  const first = clamp(shown - (DUMP_ROW - 1), 0, DUMP_TEXT.length - DUMP_ROW)
  const indexes = Array.from({ length: DUMP_ROW }, (_, i) => first + i)
  const cursor = frame !== undefined && frame % 2 === 1 ? '..' : '__'
  const bytes = indexes.map(index => (index < shown ? hexOf(index) : index === shown ? cursor : '..'))
  const letters = indexes.map(index => (index < shown ? DUMP_TEXT[index] : '.'))

  return `${(DUMP_BASE + first).toString(16)}: ${bytes.join(' ')} |${letters.join('')}| ${p}%`
}

export const LOADINGS: readonly Loading[] = [
  { id: 'line42', name: 'line 42', draw: line42Text },
  { id: 'pipeline', name: 'pipeline', draw: pipelineText },
  { id: 'install', name: 'install', draw: installText },
  { id: 'rain', name: 'code rain', draw: rainText },
  { id: 'hexdump', name: 'hexdump', draw: hexdumpText },
]

// Whether the status-line form has something left to move. Nothing moves at
// the end, and the rain is flat at both ends.
export function loadingMoves(id: LoadingId, p: number): boolean {
  return p < 100 && (id !== 'rain' || p > 0)
}

// ---- The pictures ----

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
const FONT = `font-family="'JetBrains Mono',ui-monospace,'Cascadia Mono',Consolas,Menlo,monospace"`
const WIDE_WIDTH = 380
const WIDE_HEIGHT = 96
const TAG_PATH =
  'M0 20C0 8.954 8.954 0 20 0H151.716C157.02 0 162.107 2.107 165.858 5.858L225.858 65.858C233.668 73.668 233.668 86.332 225.858 94.142L165.858 154.142C162.107 157.893 157.02 160 151.716 160H20C8.954 160 0 151.046 0 140V20Z'
const MOTION =
  '.bl{animation:bl 1.2s steps(1) infinite}.sp{animation:sp 1.2s steps(8) infinite}' +
  '.pop{animation:pop .5s ease-out 1;transform-box:fill-box;transform-origin:center}' +
  '@keyframes bl{50%{opacity:0}}@keyframes sp{to{transform:rotate(360deg)}}@keyframes pop{from{transform:scale(0)}}'

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (value: number) => String(Number(value.toFixed(2)))

// Every text has its width fixed, so a fallback font cannot break the layout.
function text(x: number, y: number, value: string, fill: string, size = 9, more = ''): string {
  return `<text x="${num(x)}" y="${num(y)}" font-size="${size}" fill="${fill}" textLength="${num(value.length * size * 0.6)}" lengthAdjust="spacingAndGlyphs"${more}>${escapeXml(value)}</text>`
}

// One character per cell, each at its own x.
function cells(xs: number[], y: number, value: string, fill: string, size: number, more = ''): string {
  return value === '' ? '' : `<text x="${xs.map(num).join(' ')}" y="${num(y)}" font-size="${size}" text-anchor="middle" fill="${fill}"${more}>${escapeXml(value)}</text>`
}

// The Breakpoint tag. "full" carries the ink ring and red dot, "one" is the
// one-colour mark with a hole, "off" a grey one that has not been reached.
function tag(x: number, y: number, height: number, mode: 'full' | 'one' | 'off', hole = TERMINAL): string {
  const inner =
    mode === 'full'
      ? `<circle cx="80" cy="80" r="50" fill="${INK}"/><circle cx="80" cy="80" r="30" fill="${RED}"/>`
      : `<circle cx="80" cy="80" r="34" fill="${hole}"/>`
  const pop = mode === 'full' ? ' class="pop"' : ''

  return `<g transform="translate(${num(x)} ${num(y)}) scale(${num(height / 160)})"><g${pop}><path d="${TAG_PATH}" fill="${mode === 'off' ? QUIET : YELLOW}"/>${inner}</g></g>`
}

function cursorBlock(x: number, y: number, width: number, height: number, fill: string): string {
  return `<rect class="bl" x="${num(x)}" y="${num(y)}" width="${width}" height="${height}" fill="${fill}"/>`
}

function style(extra = ''): string {
  return `<style>@media (prefers-reduced-motion:no-preference){${MOTION}${extra}}</style>`
}

// The wide scene of the chosen meter: drawn at twice its size, shrunk to the panel.
function wide(body: string, extraStyle = ''): string {
  return (
    `<svg ${SVG_NS} width="${WIDE_WIDTH * 2}" height="${WIDE_HEIGHT * 2}" viewBox="0 0 ${WIDE_WIDTH} ${WIDE_HEIGHT}" ${FONT}>${style(extraStyle)}` +
    `<rect x="0.5" y="0.5" width="${WIDE_WIDTH - 1}" height="${WIDE_HEIGHT - 1}" rx="8" fill="${TERMINAL}" stroke="${GREEN}" stroke-opacity="0.18"/>${body}</svg>`
  )
}

// The small tile of the picker.
function tile(body: string, extraStyle = ''): string {
  return (
    `<svg ${SVG_NS} width="104" height="64" viewBox="0 0 104 64" ${FONT}>${style(extraStyle)}` +
    `<rect x="2.5" y="2.5" width="99" height="59" rx="7" fill="${TERMINAL}" stroke="${GREEN}" stroke-opacity="0.18"/>${body}</svg>`
  )
}

function line42Wide(p: number): string {
  const current = lineAt(p)
  const isPaused = p >= 100
  const first = clamp(current - 2, 1, LAST_LINE - 4)
  const rows = Array.from({ length: 5 }, (_, i) => {
    const n = first + i
    const y = 20 + i * 16
    const [indent, code] = codeLine(n)
    const isCurrent = n === current
    const x = 48 + indent * 5.4
    const colour = isCurrent && isPaused ? YELLOW : GREEN
    const band = !isCurrent ? '' : isPaused ? `<rect x="1" y="${y - 11.5}" width="378" height="16" fill="${BAND}"/>` : `<rect x="1" y="${y - 11.5}" width="378" height="16" fill="${GREEN}" fill-opacity="0.08"/>`
    const pointer = !isCurrent ? '' : tag(5, y - 9, 11, isPaused ? 'full' : 'one')
    const dot = n === LAST_LINE && !isCurrent ? `<circle cx="11" cy="${y - 3.5}" r="3.6" fill="${RED}"/>` : ''
    const number = text(38 - String(n).length * 5.4, y, String(n), isCurrent ? YELLOW : QUIET, 9)
    const words = text(x, y, code, colour, 9, isCurrent ? '' : ' fill-opacity="0.5"')
    const cursor = isCurrent ? cursorBlock(x + code.length * 5.4 + 3, y - 8.5, 5, 10, colour) : ''

    return band + pointer + dot + number + words + cursor
  }).join('')
  // The rail on the right: the whole file, with the breakpoint waiting at its end.
  const reach = 26 + 48 * (p / 100)
  const rail =
    `<path d="M366 26V74" stroke="${GREEN}" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M366 26V${num(reach)}" stroke="${GREEN}" stroke-width="2" stroke-linecap="round"/>` +
    (isPaused ? '' : `<rect x="362" y="${num(reach - 1.5)}" width="8" height="3" rx="1.5" fill="${YELLOW}"/>`) +
    `<circle cx="366" cy="82" r="4" fill="${RED}"/>`
  const label = isPaused ? text(264, 15, 'paused on line 42.', YELLOW, 9) : text(331, 15, `ln ${String(current).padStart(2, '0')}/${LAST_LINE}`, GREEN, 8, ' fill-opacity="0.6"')

  return wide(rows + rail + label)
}

function line42Tile(p: number): string {
  const current = lineAt(p)
  const isPaused = p >= 100
  const first = clamp(current - 1, 1, LAST_LINE - 2)
  const rows = Array.from({ length: 3 }, (_, i) => {
    const n = first + i
    const y = 20 + i * 14
    const isCurrent = n === current
    const band = !isCurrent ? '' : `<rect x="3" y="${y - 7}" width="98" height="14" fill="${isPaused ? BAND : GREEN}"${isPaused ? '' : ' fill-opacity="0.1"'}/>`
    const pointer = !isCurrent ? '' : tag(7, y - 5, 10, isPaused ? 'full' : 'one')
    const dot = n === LAST_LINE && !isCurrent ? `<circle cx="13" cy="${y}" r="3.2" fill="${RED}"/>` : ''
    const number = text(26, y + 2.5, String(n), isCurrent ? YELLOW : QUIET, 7)
    const bar = `<rect x="40" y="${y - 2}" width="${[42, 30, 50][n % 3]}" height="4" rx="2" fill="${isCurrent && isPaused ? YELLOW : GREEN}"${isCurrent ? '' : ' fill-opacity="0.4"'}/>`

    return band + pointer + dot + number + bar
  }).join('')

  return tile(rows)
}

type Node = { x: number; y: number; r: number }

function stageNode(node: Node, state: 'done' | 'running' | 'waiting'): string {
  const { x, y, r } = node
  const at = `transform="translate(${x} ${y})"`

  if (state === 'done') {
    const k = r / 11

    return `<g ${at}><circle r="${r}" fill="${GREEN}"/><path d="M${num(-4.5 * k)} ${num(0.5 * k)}l${num(3 * k)} ${num(3 * k)} ${num(6 * k)}${num(-6.5 * k)}" fill="none" stroke="${TERMINAL}" stroke-width="${num(2.2 * k)}" stroke-linecap="round" stroke-linejoin="round"/></g>`
  }

  if (state === 'running') {
    const round = 2 * Math.PI * (r - 1)

    return (
      `<g ${at}><circle r="${r - 1}" fill="none" stroke="${YELLOW}" stroke-opacity="0.3" stroke-width="2"/>` +
      `<circle class="sp" r="${r - 1}" fill="none" stroke="${YELLOW}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${num(round * 0.3)} ${num(round * 0.7)}"/>` +
      `<circle r="${num(r / 4.4)}" fill="${YELLOW}"/></g>`
    )
  }

  return `<g ${at}><circle r="${r - 1}" fill="none" stroke="${QUIET}" stroke-width="1.5" stroke-dasharray="2 3"/></g>`
}

// The stages, the lines between them and the tag at the end. The lines fill
// with the percentage, so the picture moves within a stage too.
function pipelineRow(p: number, xs: number[], y: number, r: number, tagHeight: number): string {
  const stage = stageAt(p)
  const share = 100 / STAGES.length
  const links = STAGES.map((_, i) => {
    const from = xs[i] + r + 3
    const to = xs[i + 1] - r - 3 - (i === STAGES.length - 1 ? tagHeight * 0.25 : 0)
    const done = clamp((p - i * share) / share, 0, 1)

    return (
      `<path d="M${num(from)} ${y}H${num(to)}" stroke="${GREEN}" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
      (done === 0 ? '' : `<path d="M${num(from)} ${y}H${num(from + (to - from) * done)}" stroke="${GREEN}" stroke-width="2" stroke-linecap="round"/>`)
    )
  }).join('')
  const nodes = STAGES.map((_, i) => stageNode({ x: xs[i], y, r }, i < stage ? 'done' : i === stage ? 'running' : 'waiting')).join('')
  const treat = tag(xs[STAGES.length] - tagHeight * 0.75, y - tagHeight / 2, tagHeight, stage === STAGES.length ? 'full' : 'off')

  return links + nodes + treat
}

function pipelineWide(p: number): string {
  const stage = stageAt(p)
  const xs = [56, 146, 236, 326]
  const labels = [...STAGES, 'treat'].map((name, i) => {
    const colour = i < stage || (i === stage && i === STAGES.length) ? GREEN : i === stage ? YELLOW : QUIET

    return text(xs[i] - name.length * 2.55, 66, name, colour, 8.5)
  }).join('')
  const log = STAGE_LOG[stage]
  const line = text(14, 86, '>', YELLOW, 8.5) + text(24, 86, log, GREEN, 8.5, ' fill-opacity="0.85"') + cursorBlock(27 + log.length * 5.1, 78.5, 5, 9, GREEN)

  return wide(text(14, 15, 'run #42', GREEN, 7.5, ' fill-opacity="0.5"') + pipelineRow(p, xs, 40, 11, 24) + labels + line)
}

function pipelineTile(p: number): string {
  const track = `<path d="M14 50H90" stroke="${GREEN}" stroke-opacity="0.2" stroke-width="3" stroke-linecap="round"/>` + (p === 0 ? '' : `<path d="M14 50H${num(14 + 76 * (p / 100))}" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>`)

  return tile(pipelineRow(p, [17, 39, 61, 87], 27, 7, 14) + track)
}

// A bar of blocks: one stroke, cut into cells by its dashes.
function blockBar(x: number, y: number, width: number, height: number, p: number, dash: string): string {
  const line = (to: number, more: string) => `<path d="M${x} ${y}H${num(to)}" stroke="${GREEN}" stroke-width="${height}" stroke-dasharray="${dash}"${more}/>`

  return line(x + width, ' stroke-opacity="0.16"') + (p === 0 ? '' : line(x + width * (p / 100), ''))
}

function installWide(p: number): string {
  const isDone = p >= 100
  const count = packagesAt(p)
  const command = text(14, 17, '>', YELLOW, 9) + text(25, 17, INSTALL_COMMAND, GREEN, 9)
  const added = (index: number, y: number) => (index < 0 ? '' : text(14, y, '+', GREEN, 9, ' fill-opacity="0.55"') + text(25, y, packageName(index), GREEN, 9, ' fill-opacity="0.55"'))
  const working =
    `<g transform="translate(17 55)"><circle class="sp" r="3.4" fill="none" stroke="${YELLOW}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="6.4 15"/></g>` +
    text(25, 58, packageName(count), GREEN, 9) +
    cursorBlock(28 + packageName(count).length * 5.4, 49.5, 5, 10, GREEN)
  const lines = isDone
    ? added(PACKAGE_COUNT - 1, 31) + text(14, 44.5, INSTALL_DONE[0], GREEN, 9) + text(14, 58, INSTALL_DONE[1], GREEN, 9, ' fill-opacity="0.55"')
    : added(count - 2, 31) + added(count - 1, 44.5) + working
  const total = text(296, 79, `${count}/${PACKAGE_COUNT}`, isDone ? YELLOW : GREEN, 9)

  return wide(command + lines + blockBar(14, 76, 272, 9, p, '5 1.8') + total + (isDone ? tag(322, 22, 28, 'full') : ''))
}

function installTile(p: number): string {
  const rows = [0, 1, 2].map(i => {
    const y = 16 + i * 10
    const fade = i === 2 ? '' : ' fill-opacity="0.45"'

    return text(12, y + 2.5, '+', i === 2 ? YELLOW : GREEN, 7, fade) + `<rect x="21" y="${y - 2}" width="${[46, 58, 38][i]}" height="4" rx="2" fill="${GREEN}"${fade}/>`
  }).join('')

  return tile(rows + blockBar(12, 50, 80, 7, p, '4 1.5'))
}

type Grid = { x: number; y: number; columns: number; rows: number; cell: number; pitch: number; size: number; drops: number }

// The rain. Settled glyphs pile up from the floor, row by row from the left,
// and the drops fall only through the room that is left.
function rainBody(grid: Grid, p: number): { body: string; css: string } {
  const { x, y, columns, rows, cell, pitch, size, drops } = grid
  const settled = part(p, columns * rows)
  const fullRows = Math.floor(settled / columns)
  const rest = settled % columns
  const xs = Array.from({ length: columns }, (_, c) => x + c * cell)
  const rowY = (r: number) => y + r * pitch
  const glyphs = (r: number, count: number) => Array.from({ length: count }, (_, c) => GLYPHS[mix(c, r) % GLYPHS.length]).join('')
  const isFull = p >= 100
  const top = rows - fullRows
  const floor = Array.from({ length: fullRows }, (_, i) => {
    const r = rows - 1 - i
    const isSurface = rest === 0 && r === top && !isFull

    return cells(xs, rowY(r), glyphs(r, columns), isSurface ? YELLOW : GREEN, size, isSurface ? '' : ` fill-opacity="${isFull ? 0.3 : 0.8}"`)
  }).join('')
  const surface = rest === 0 ? '' : cells(xs.slice(0, rest), rowY(top - 1), glyphs(top - 1, rest), YELLOW, size)
  const level = fullRows === 0 ? '' : `<rect x="${num(x - cell / 2)}" y="${num(rowY(top) - pitch + 2.5)}" width="${columns * cell}" height="${num(fullRows * pitch)}" fill="${GREEN}" fill-opacity="0.07"/>`
  const freeRows = top - (rest > 0 ? 1 : 0)

  if (freeRows <= 0) {
    return { body: level + floor + surface, css: '' }
  }

  const clipHeight = rowY(freeRows - 1) + 2.5
  const travel = (freeRows + 4) * pitch
  const streak = (k: number) => {
    const column = Math.min(columns - 1, Math.floor((k + 0.5) * (columns / drops)) + (mix(k, 5) % 2))
    const rest0 = mix(k, 9) % freeRows
    const marks = [0, 1, 2, 3].map(i =>
      `<text x="${num(xs[column])}" y="${num(-i * pitch)}" font-size="${size}" text-anchor="middle" fill="${i === 0 ? HEAD : GREEN}" fill-opacity="${[1, 0.7, 0.4, 0.18][i]}">${escapeXml(GLYPHS[mix(k * 7 + i, column) % GLYPHS.length])}</text>`,
    ).join('')

    // Without movement the streak rests at a row of its own.
    return `<g class="f f${k}" transform="translate(0 ${num(rowY(rest0))})">${marks}</g>`
  }
  const falling = Array.from({ length: drops }, (_, k) => streak(k)).join('')
  const timing = Array.from({ length: drops }, (_, k) => {
    const seconds = 5 + (mix(k, 3) % 5)

    return `.f${k}{animation-duration:${seconds}s;animation-delay:-${num((mix(k, 4) % 50) / 10)}s}`
  }).join('')
  const css = `.f{animation:fall 6s steps(${freeRows + 4}) infinite}${timing}@keyframes fall{from{transform:translateY(${num(y - pitch)}px)}to{transform:translateY(${num(y - pitch + travel)}px)}}`
  const clip = `<clipPath id="sky"><rect x="0" y="3" width="${num(x + columns * cell)}" height="${num(clipHeight - 3)}"/></clipPath>`

  return { body: `${clip}<g clip-path="url(#sky)">${falling}</g>${level}${floor}${surface}`, css }
}

function rainWide(p: number): string {
  const { body, css } = rainBody({ x: 15, y: 14, columns: 36, rows: 8, cell: 10, pitch: 11, size: 9, drops: 9 }, p)
  const words = 'take a break;'
  const banner = p < 100 ? '' : `<rect x="118" y="34" width="144" height="28" rx="4" fill="${INK}" stroke="${YELLOW}" stroke-opacity="0.5"/>` + text(134, 52.5, words, YELLOW, 13) + cursorBlock(134 + words.length * 7.8 + 3, 41, 7, 14, YELLOW)

  return wide(body + banner, css)
}

function rainTile(p: number): string {
  const { body, css } = rainBody({ x: 12, y: 15, columns: 9, rows: 5, cell: 10, pitch: 10, size: 8, drops: 3 }, p)

  return tile(body + (p < 100 ? '' : `<rect x="34" y="20" width="36" height="24" rx="4" fill="${INK}"/>${tag(41, 25, 14, 'full')}`), css)
}

function hexdumpWide(p: number): string {
  const shown = bytesAt(p)
  const isDone = p >= 100
  const size = 10
  const step = size * 0.6
  const rows = Array.from({ length: DUMP_TEXT.length / DUMP_ROW }, (_, row) => {
    const y = 23 + row * 18
    const isCurrent = !isDone && Math.floor(shown / DUMP_ROW) === row
    const band = isCurrent ? `<rect x="1" y="${y - 12.5}" width="378" height="18" fill="${GREEN}" fill-opacity="0.07"/>` : ''
    const offset = text(14, y, offsetOf(row).padStart(4, '0'), isDone && row === 3 ? YELLOW : QUIET, size)
    const bytes = Array.from({ length: DUMP_ROW }, (_, i) => {
      const index = row * DUMP_ROW + i
      const x = 52 + i * step * 3 + (i >= DUMP_ROW / 2 ? step : 0)

      if (index === shown) {
        return cursorBlock(x, y - 9, step * 2, 11, YELLOW)
      }

      return index < shown ? text(x, y, hexOf(index), GREEN, size) : text(x, y, '..', GREEN, size, ' fill-opacity="0.25"')
    }).join('')
    const lettersX = 52 + step * 27
    const letters = Array.from({ length: DUMP_ROW }, (_, i) => {
      const index = row * DUMP_ROW + i
      const isShown = index < shown

      return DUMP_TEXT[index] === ' ' && isShown ? '' : text(lettersX + step * (i + 1), y, isShown ? DUMP_TEXT[index] : '.', isShown ? (isDone ? YELLOW : GREEN) : GREEN, size, isShown ? '' : ' fill-opacity="0.25"')
    }).join('')
    const edges = text(lettersX, y, '|', QUIET, size) + text(lettersX + step * 9, y, '|', QUIET, size)

    return band + offset + bytes + letters + edges
  }).join('')
  const count = `0x${shown.toString(16).padStart(2, '0')}/0x${DUMP_TEXT.length.toString(16)}`
  const side = text(372 - count.length * 4.8, 23, count, isDone ? YELLOW : GREEN, 8, isDone ? '' : ' fill-opacity="0.6"') + (isDone ? tag(328, 40, 28, 'full') : '')

  return wide(rows + side)
}

function hexdumpTile(p: number): string {
  const shown = bytesAt(p)
  const isDone = p >= 100
  const squares = Array.from({ length: DUMP_TEXT.length }, (_, index) => {
    const x = 13 + (index % DUMP_ROW) * 10
    const y = 11 + Math.floor(index / DUMP_ROW) * 11
    const isLastRow = index >= DUMP_TEXT.length - DUMP_ROW
    const look = index === shown ? ` class="bl" fill="${YELLOW}"` : index < shown ? ` fill="${isDone && isLastRow ? YELLOW : GREEN}" fill-opacity="0.9"` : ` fill="${GREEN}" fill-opacity="0.16"`

    return `<rect x="${x}" y="${y}" width="8" height="8" rx="1.5"${look}/>`
  }).join('')

  return tile(squares)
}

const WIDE: Record<LoadingId, (p: number) => string> = { line42: line42Wide, pipeline: pipelineWide, install: installWide, rain: rainWide, hexdump: hexdumpWide }
const TILE: Record<LoadingId, (p: number) => string> = { line42: line42Tile, pipeline: pipelineTile, install: installTile, rain: rainTile, hexdump: hexdumpTile }
const whole = (percent: number) => clamp(Math.round(percent), 0, 100)

// The wide picture at the top of the panel.
export function loadingSvg(id: LoadingId, percent: number): string {
  return WIDE[id](whole(percent))
}

// The small picture in the picker.
export function loadingTileSvg(id: LoadingId, percent: number): string {
  return TILE[id](whole(percent))
}
