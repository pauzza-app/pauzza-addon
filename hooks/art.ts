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

const ICON_SHAPES: Record<string, string> = {
  line: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="7" width="15" height="9.5" rx="2.5"/><path d="M7 21h14"/></g>',
  pop: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6.5a5 5 0 0 0-5 5V15l-1.8 3h13.6L19 15v-3.5a5 5 0 0 0-5-5z"/><path d="M12.2 21a2 2 0 0 0 3.6 0"/></g>',
  trash: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.5h13M11.5 9.5v-2h5v2M9.5 9.5l.8 12a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9l.8-12"/><path d="M12.5 13v6M15.5 13v6"/></g>',
  mine: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 13.5h14v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 7 21z"/><rect x="6" y="10" width="16" height="3.5" rx="1"/><path d="M14 10v12.5"/><path d="M14 10c-1.5-3.5-5.5-3.5-5.5-1 0 1.4 2 1 5.5 1zM14 10c1.5-3.5 5.5-3.5 5.5-1 0 1.4-2 1-5.5 1z"/></g>',
  day: '<path fill="#fff" d="M14 6.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L14 18.3l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"/>',
  food: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5v5a2.5 2.5 0 0 0 5 0v-5"/><path d="M11 6.5v15"/><path d="M19.5 21.5v-15c-2 .8-3 3-3 6v2.5h3"/></g>',
  drinks: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l1 10.6a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L19 11"/><path d="M7.8 11h12.4"/><path d="M14.5 11L16 5.5h2.5"/></g>',
  tickets: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v2.4a1.8 1.8 0 0 0 0 3.2V18a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-2.4a1.8 1.8 0 0 0 0-3.2z"/><path d="M16.5 10v8" stroke-dasharray="1.2 2.4"/></g>',
  gadgets: '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"><path d="M7.5 17v-2.5a6.5 6.5 0 0 1 13 0V17"/></g><rect fill="#fff" x="6" y="16" width="3.8" height="6" rx="1.6"/><rect fill="#fff" x="18.2" y="16" width="3.8" height="6" rx="1.6"/>',
}

const TILE_COLOURS: Record<string, [string, string]> = {
  line: ['#9AA3AF', '#6B7280'],
  pop: ['#9AA3AF', '#6B7280'],
  trash: ['#FF7A7A', '#DC3B3B'],
  mine: ['#3DD68C', '#1FA463'],
  day: ['#A78BFA', '#7C5CE0'],
  food: ['#FFA94D', '#F07A1A'],
  drinks: ['#2DD4BF', '#0E9F96'],
  tickets: ['#FB7AA5', '#E6457F'],
  gadgets: ['#60A5FA', '#3B7DEB'],
}

// The bottom tile colour doubles as the drawer's offer-line colour.
export function drawerColour(id: string): string {
  return (own(TILE_COLOURS, id) ?? [GREY, GREY])[1]
}

export function iconTileSvg(id: string): string {
  const [top, bottom] = own(TILE_COLOURS, id) ?? [GREY, GREY]

  return `<svg ${SVG_NS} width="28" height="28" viewBox="0 0 28 28"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="28" height="28" rx="8" fill="url(#g)"/>${own(ICON_SHAPES, id) ?? ''}</svg>`
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
