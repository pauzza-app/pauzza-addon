// The last check before anything reaches the screen. Pure.
//
// The status line and pop-ups show only text the add-on built itself; a future
// server may choose among these, never supply words of its own. The links are
// the official copy's page for one of the two documents, and an offer's own
// signed address.

import { checkLink } from './catalogue'
import { OFFER_POPUP } from './connect-text'
import { LOOK_TEXT, NEWS_POPUP, UPDATE_POPUP } from './slot-text'
import { BURN_FIVE_POPUP, BURN_WEEK_POPUP, DROP_POPUP } from './waiting-pays'

export const MAX_LINE = 80

// Control, invisible, direction and tag characters: none belongs on a line.
const HIDDEN_RANGES: ReadonlyArray<[number, number]> = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c], [0x115f, 0x1160], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0e], [0xfeff, 0xfeff],
  [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
]

const isHidden = (char: string) => {
  const code = char.codePointAt(0) ?? 0

  return HIDDEN_RANGES.some(([from, to]) => code >= from && code <= to)
}

// The line under the chat box, or undefined to show nothing.
export function checkLine(text: string | undefined): string | undefined {
  if (typeof text !== 'string' || text.length > MAX_LINE * 2) {
    return undefined
  }

  const chars = Array.from(text)

  return chars.length > MAX_LINE || chars.some(isHidden) ? undefined : text
}

const POPUPS: ReadonlySet<string> = new Set([DROP_POPUP, BURN_FIVE_POPUP, BURN_WEEK_POPUP, OFFER_POPUP, NEWS_POPUP, UPDATE_POPUP, ...Object.values(LOOK_TEXT).map(look => look.popup)])

export function isBuiltInPopup(text: unknown): text is string {
  return typeof text === 'string' && POPUPS.has(text)
}

const OFFICIAL_DOCUMENT = /^https:\/\/github\.com\/pauzza-app\/pauzza-addon\/blob\/main\/(TERMS|PRIVACY)\.md$/

// The address if it is the official copy's document page, else undefined.
export function officialLink(url: string): string | undefined {
  return OFFICIAL_DOCUMENT.test(url) ? url : undefined
}

// The characters a link may hold: letters, digits and - . _ ~ : / ? # @ & + , =
// from RFC 3986's set, and % only before two hex digits, so the address opened
// is exactly the one signed. No quote, dollar, bracket, semicolon, bang, star,
// space or anything outside plain ASCII. The same line is in the server's
// signing check (server/supabase/functions/_shared/catalogue.ts, a test there
// compares them), which refuses any other link before it is published.
const LINK_CHARS = /^(?:[A-Za-z0-9\-._~:/?#@&+,=]|%[0-9A-Fa-f]{2})+$/

export type OfferLink = { href: string; host: string }

// An offer's link (finding 4 of the 2026-11-12 review): the signed address
// itself, opened exactly as signed, and its host, shown as the link's label.
// Called only with the held list, whose signature was checked, and its signed
// host list: `checkLink` holds the address to https, an exact host from that
// list, and no user name, port or punycode. Anything else is no link at all.
// Pauzza's own address is never in it, and opening it sends Pauzza nothing.
export function offerLink(link: unknown, allowedHosts: readonly string[]): OfferLink | undefined {
  const host = checkLink(link, allowedHosts)

  return host === undefined || typeof link !== 'string' || !LINK_CHARS.test(link) ? undefined : { href: link, host }
}
