// The last check before anything reaches the screen. Pure.
//
// The status line and pop-ups show only text the add-on built itself; a future
// server may choose among these, never supply words of its own. The only link
// is the official copy's page for one of the two documents.

import { OFFER_POPUP } from './connect-text'
import { BASE_URL } from './server'
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

const POPUPS: ReadonlySet<string> = new Set([DROP_POPUP, BURN_FIVE_POPUP, BURN_WEEK_POPUP, OFFER_POPUP])

export function isBuiltInPopup(text: unknown): text is string {
  return typeof text === 'string' && POPUPS.has(text)
}

const OFFICIAL_DOCUMENT = /^https:\/\/github\.com\/pauzza-app\/pauzza-addon\/blob\/main\/(TERMS|PRIVACY)\.md$/

// The address if it is the official copy's document page, else undefined.
export function officialLink(url: string): string | undefined {
  return OFFICIAL_DOCUMENT.test(url) ? url : undefined
}

const OFFER_LINK = /^https:\/\/pwchzyltlirhiiaxoifb\.supabase\.co\/functions\/v1\/o\/[a-z0-9-]{1,40}$/

// The add-on's own fixed link for an offer, else undefined. The server looks
// the destination up from the signed list; no destination, install or code is
// ever in the address. Built from the one server address in `server.ts`.
export function offerLink(offerId: string): string | undefined {
  const url = `${BASE_URL}o/${offerId}`

  return OFFER_LINK.test(url) ? url : undefined
}
