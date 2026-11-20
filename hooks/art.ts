// The small drawings of the panel, as SVG text. Pure. Colours are fixed
// mid-tones, because theme keys cannot reach an Svg. Every drawing is a plain
// image: Desktop did not show pictures in the `isInteractive` frame when tried
// on screen. The meters' own pictures are drawn in loadings.ts.

const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

const GREY = '#888888'
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
const STRETCH_WIDTH = 1600

// Dims a whole drawing, for the neighbours in the carousel.
export function fadedSvg(svg: string): string {
  return `${svg.replace('>', '><g opacity="0.4">').slice(0, -'</svg>'.length)}</g></svg>`
}

export function hairlineSvg(): string {
  return `<svg ${SVG_NS} width="${STRETCH_WIDTH}" height="1" viewBox="0 0 ${STRETCH_WIDTH} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${STRETCH_WIDTH}" height="1" fill="#88888833"/></svg>`
}

// Wide enough that the dots never touch, however many meters there are.
export function dotsWidth(count: number): number {
  return Math.max(64, count * 10 - 4)
}

export function dotsSvg(count: number, active: number): string {
  const width = dotsWidth(count)
  const dots = Array.from({ length: count }, (_, i) => {
    const x = 5 + i * ((width - 10) / (count - 1))

    return i === active ? `<circle cx="${x}" cy="3" r="3" fill="${GREY}"/>` : `<circle cx="${x}" cy="3" r="3" fill="${GREY}" fill-opacity="0.35"/>`
  }).join('')

  return `<svg ${SVG_NS} width="${width}" height="6" viewBox="0 0 ${width} 6">${dots}</svg>`
}

const line = (paths: string) => `<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`

const ICON_SHAPES: Record<string, string> = {
  line: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="7" width="15" height="9.5" rx="2.5"/><path d="M7 21h14"/></g>',
  pop: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6.5a5 5 0 0 0-5 5V15l-1.8 3h13.6L19 15v-3.5a5 5 0 0 0-5-5z"/><path d="M12.2 21a2 2 0 0 0 3.6 0"/></g>',
  trash: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.5h13M11.5 9.5v-2h5v2M9.5 9.5l.8 12a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-12"/><path d="M12.5 13v6M15.5 13v6"/></g>',
  update: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a6.5 6.5 0 0 0-11.8-2.8M7.5 16a6.5 6.5 0 0 0 11.8 2.8"/><path d="M8.5 5.8v3.5H12M19.5 22.2v-3.5H16"/></g>',
  // "Check now" in Settings: the offer list coming in, an arrow into a tray.
  check: line('<path d="M14 6.5v9"/><path d="M10.5 12.5l3.5 3.5 3.5-3.5"/><path d="M7.5 16.5v3a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  mine: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13.5h14v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 7 21z"/><rect x="6" y="10" width="16" height="3.5" rx="1"/><path d="M14 10v12.5"/><path d="M14 10c-1.5-3.5-5.5-3.5-5.5-1 0 1.4 2 1 5.5 1zM14 10c1.5-3.5 5.5-3.5 5.5-1 0 1.4-2 1-5.5 1z"/></g>',
  day: '<path fill="#fff" d="M14 6.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L14 18.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"/>',
  food: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5v5a2.5 2.5 0 0 0 5 0v-5"/><path d="M11 6.5v15"/><path d="M19.5 21.5v-15c-2 .8-3 3-3 6v2.5h3"/></g>',
  drinks: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l1 10.6a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L19 11"/><path d="M7.8 11h12.4"/><path d="M14.5 11L16 5.5h2.5"/></g>',
  tickets: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v2.4a1.8 1.8 0 0 0 0 3.2V18a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-2.4a1.8 1.8 0 0 0 0-3.2z"/><path d="M16.5 10v8" stroke-dasharray="1.2 2.4"/></g>',
  gadgets: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><path d="M7.5 17v-2.5a6.5 6.5 0 0 1 13 0V17"/></g><rect fill="#fff" x="6" y="16" width="3.8" height="6" rx="1.6"/><rect fill="#fff" x="18.2" y="16" width="3.8" height="6" rx="1.6"/>',
  // The other format 2 categories, and four plain shapes for the ones the owner names.
  groceries: line('<path d="M6.5 8h2.2l2 9.5h8.6l1.7-7H9.3"/><circle cx="11.5" cy="20.5" r="1.2"/><circle cx="18" cy="20.5" r="1.2"/>'),
  fashion: line('<path d="M11 6.5L6.5 9 8 12.5l2-.8v9.8h8v-9.8l2 .8L21.5 9 17 6.5c-.5 1.4-1.6 2.2-3 2.2s-2.5-.8-3-2.2z"/>'),
  beauty: line('<rect x="11" y="14" width="6" height="7.5" rx="1"/><path d="M12 14V9.5l4-3V14"/>'),
  health: line('<path d="M14 8v12M8 14h12"/>'),
  sport: line('<circle cx="14" cy="14" r="7"/><path d="M14 7v14M7 14h14"/><path d="M9 9c2.5 2.5 2.5 7.5 0 10M19 9c-2.5 2.5-2.5 7.5 0 10"/>'),
  travel: line('<rect x="7" y="10" width="14" height="10.5" rx="2"/><path d="M11 10V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 14.5h14"/>'),
  transport: line('<rect x="8" y="6.5" width="12" height="13" rx="2.5"/><path d="M8 13h12"/><path d="M10 19.5v2M18 19.5v2"/><circle cx="11" cy="16.3" r=".9"/><circle cx="17" cy="16.3" r=".9"/>'),
  education: line('<path d="M5.5 11.5L14 7.5l8.5 4-8.5 4z"/><path d="M9.5 13.5v4c2.8 2 6.2 2 9 0v-4"/><path d="M22.5 11.5v5"/>'),
  software: line('<rect x="6" y="7.5" width="16" height="13" rx="2"/><path d="M6 11h16"/><path d="M12 14.5l-2 2 2 2M16 14.5l2 2-2 2"/>'),
  services: line('<path d="M17.5 6.8a4 4 0 0 0-4.6 5.3l-5.6 5.6a1.6 1.6 0 0 0 2.3 2.3l5.6-5.6a4 4 0 0 0 5.3-4.6l-2.4 2.4-2.4-.6-.6-2.4z"/>'),
  finance: line('<rect x="6" y="9" width="16" height="11" rx="2"/><path d="M6 12.5h16M9.5 16.5h3"/>'),
  insurance: line('<path d="M14 6.5l6.5 2.5v5c0 4-2.8 6.8-6.5 8-3.7-1.2-6.5-4-6.5-8V9z"/><path d="M11 14l2 2 4-4"/>'),
  home: line('<path d="M6.5 13L14 6.5l7.5 6.5"/><path d="M8.5 11.5v9.5h11v-9.5"/><path d="M12.5 21v-5h3v5"/>'),
  games: line('<path d="M9.5 10.5h9a3.5 3.5 0 0 1 3.4 4.3l-1 4a1.9 1.9 0 0 1-3.2.8l-2.2-2.1h-3l-2.2 2.1a1.9 1.9 0 0 1-3.2-.8l-1-4a3.5 3.5 0 0 1 3.4-4.3z"/><path d="M10.5 13v3M9 14.5h3M17 13.5h.01M19 15.5h.01"/>'),
  kids: line('<path d="M14 6.5c-3 0-5 2.4-5 5.3 0 3.2 2.6 5.7 5 6.2 2.4-.5 5-3 5-6.2 0-2.9-2-5.3-5-5.3z"/><path d="M14 18c0 1.5-1.5 2-1.5 3.5"/>'),
  other: '<g fill="#fff"><circle cx="9" cy="14" r="1.6"/><circle cx="14" cy="14" r="1.6"/><circle cx="19" cy="14" r="1.6"/></g>',
  'custom-1': line('<circle cx="14" cy="14" r="6"/>'),
  'custom-2': line('<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/>'),
  'custom-3': line('<path d="M14 8l6.5 11.5h-13z"/>'),
  'custom-4': line('<path d="M14 7.5l6.5 6.5-6.5 6.5-6.5-6.5z"/>'),
}

const TILE_COLOURS: Record<string, [string, string]> = {
  line: ['#9AA3AF', '#6B7280'],
  pop: ['#9AA3AF', '#6B7280'],
  trash: ['#FF7A7A', '#DC3B3B'],
  update: ['#9AA3AF', '#6B7280'],
  check: ['#9AA3AF', '#6B7280'],
  mine: ['#3DD68C', '#1FA463'],
  day: ['#A78BFA', '#7C5CE0'],
  food: ['#FFA94D', '#F07A1A'],
  drinks: ['#2DD4BF', '#0E9F96'],
  tickets: ['#FB7AA5', '#E6457F'],
  gadgets: ['#60A5FA', '#3B7DEB'],
  groceries: ['#A9E34B', '#5C940D'],
  fashion: ['#DA77F2', '#AE3EC9'],
  beauty: ['#F783AC', '#C2255C'],
  health: ['#FF8787', '#E03131'],
  sport: ['#FFD43B', '#D9730D'],
  travel: ['#66D9E8', '#1098AD'],
  transport: ['#748FFC', '#4263EB'],
  education: ['#B197FC', '#7048E8'],
  software: ['#4DABF7', '#1971C2'],
  services: ['#C0A080', '#8D6E4C'],
  finance: ['#69DB7C', '#2F9E44'],
  insurance: ['#38D9A9', '#099268'],
  home: ['#E8B07A', '#B5651D'],
  games: ['#9775FA', '#5F3DC4'],
  kids: ['#FFC078', '#E8590C'],
  other: ['#ADB5BD', '#868E96'],
  // Neutral tones, so a name the owner chooses never looks like a built-in category.
  'custom-1': ['#A3A9B5', '#6E7687'],
  'custom-2': ['#B5A89A', '#857563'],
  'custom-3': ['#9DB0AE', '#64807C'],
  'custom-4': ['#AFA3B8', '#7D6F8A'],
}

// The terminal's emoji for each format 2 category, beside the drawer's name where no picture can be
// drawn. The admin panel imports this table and the tiles below (this file has no imports).
export const CATEGORY_EMOJI: Readonly<Record<string, string>> = {
  food: '🍕', drinks: '🥤', groceries: '🛒', tickets: '🎟', gadgets: '🎧', fashion: '👕', beauty: '💄', health: '💊', sport: '⚽',
  travel: '✈️', transport: '🚌', education: '🎓', software: '💻', services: '🔧', finance: '💳', insurance: '☂️', home: '🏠',
  games: '🎮', kids: '🧸', other: '📦', 'custom-1': '⚪', 'custom-2': '⬜', 'custom-3': '🔘', 'custom-4': '🔳',
}

// A category's emoji, or the plain tag for an id this version does not know.
export function categoryEmoji(id: string): string {
  return own(CATEGORY_EMOJI, id) ?? '🏷'
}

// The bottom tile colour doubles as the drawer's offer-line colour.
export function drawerColour(id: string): string {
  return (own(TILE_COLOURS, id) ?? [GREY, GREY])[1]
}

export function iconTileSvg(id: string): string {
  const [top, bottom] = own(TILE_COLOURS, id) ?? [GREY, GREY]

  return `<svg ${SVG_NS} width="28" height="28" viewBox="0 0 28 28"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="28" height="28" rx="8" fill="url(#g)"/>${own(ICON_SHAPES, id) ?? ''}</svg>`
}

// The campaign looks: a fixed built-in set. The list names a look; it never
// sends a picture or a colour. `text` is the drawer's line colour, chosen to
// read at 3:1 or better on both a light (#FFFFFF) and a dark (#1E1E1E) panel;
// `ink` draws the icon on the tile. Same tile style as the drawer icons.
type LookArt = { top: string; bottom: string; ink: string; text: string; shape: string }

const stroked = (ink: string, paths: string) => `<g fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
const TAG = '<path d="M7 8.5v5.2a1.5 1.5 0 0 0 .44 1.06l6.8 6.8a1.5 1.5 0 0 0 2.12 0l5.2-5.2a1.5 1.5 0 0 0 0-2.12l-6.8-6.8A1.5 1.5 0 0 0 13.7 7H8.5A1.5 1.5 0 0 0 7 8.5z"/><circle cx="10.8" cy="10.8" r="1.3"/>'
const GOLD = '#F2C94C'

const LOOK_ART: Record<string, LookArt> = {
  sale: { top: '#FF7A7A', bottom: '#D23C3C', ink: '#fff', text: '#D23C3C', shape: TAG },
  'black-friday': { top: '#3A3A3A', bottom: '#0D0D0D', ink: GOLD, text: '#B8860B', shape: TAG },
  'new-year': { top: '#4CB782', bottom: '#2E8B57', ink: GOLD, text: '#2E8B57', shape: '<path d="M14 5.5l-4.5 6h2.5l-4 5.5h3.5l-3 4.5h11l-3-4.5H20l-4-5.5h2.5z"/><path d="M14 21.5v2"/>' },
  valentine: { top: '#F47BA6', bottom: '#D6457C', ink: '#fff', text: '#D6457C', shape: '<path d="M14 21.5s-7-4.3-7-9.3A3.7 3.7 0 0 1 14 10a3.7 3.7 0 0 1 7 2.2c0 5-7 9.3-7 9.3z"/>' },
  summer: { top: '#FFA94D', bottom: '#D9480F', ink: '#fff', text: '#D9480F', shape: '<circle cx="14" cy="14" r="3.8"/><path d="M14 5.5v2M14 20.5v2M5.5 14h2M20.5 14h2M8 8l1.4 1.4M18.6 18.6L20 20M8 20l1.4-1.4M18.6 9.4L20 8"/>' },
  'back-to-school': { top: '#60A5FA', bottom: '#2F6FD6', ink: '#fff', text: '#2F6FD6', shape: '<path d="M7 8.5c2.5-1 5-1 7 .8 2-1.8 4.5-1.8 7-.8v11c-2.5-1-5-1-7 .8-2-1.8-4.5-1.8-7-.8z"/><path d="M14 9.3v11"/>' },
  special: { top: '#B794F6', bottom: '#8250DF', ink: '#fff', text: '#8250DF', shape: '<path d="M14 6.5l1.8 5.7 5.7 1.8-5.7 1.8-1.8 5.7-1.8-5.7-5.7-1.8 5.7-1.8z"/>' },
  spotlight: { top: '#38BDF8', bottom: '#0B84A5', ink: '#fff', text: '#0B84A5', shape: '<path d="M7.5 12.5v3h3l6.5 4v-11l-6.5 4z"/><path d="M19.5 11.5a3.5 3.5 0 0 1 0 5"/>' },
  fresh: { top: '#69DB7C', bottom: '#2B8A3E', ink: '#fff', text: '#2B8A3E', shape: '<path d="M8 20c0-7 4.5-11.5 12-12 .5 7.5-4 12-11 12z"/><path d="M8 20l6-6"/>' },
}

// The line colour of a look, or grey for a name this version does not know.
export function lookColour(look: string): string {
  return own(LOOK_ART, look)?.text ?? GREY
}

export function lookTileSvg(look: string): string {
  const art = own(LOOK_ART, look)
  const [top, bottom] = art === undefined ? [GREY, GREY] : [art.top, art.bottom]

  return `<svg ${SVG_NS} width="28" height="28" viewBox="0 0 28 28"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="28" height="28" rx="8" fill="url(#g)"/>${art === undefined ? '' : stroked(art.ink, art.shape)}</svg>`
}

// Initials on a white tile, until real logos exist. Letters and digits only.
export function logoTileSvg(brand: string): string {
  const initials = brand
    .split(' ')
    .map(word => Array.from(word)[0] ?? '')
    .filter(letter => /^[\p{L}\p{N}]$/u.test(letter))
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return `<svg ${SVG_NS} width="34" height="34" viewBox="0 0 34 34"><rect width="34" height="34" rx="9" fill="#FFFFFF"/><text x="17" y="22" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="#333333">${initials}</text></svg>`
}

export function blankSvg(width: number): string {
  return `<svg ${SVG_NS} width="${width}" height="1" viewBox="0 0 ${width} 1"></svg>`
}
