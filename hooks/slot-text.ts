// Every word of the special slots, the campaigns, the news and update pop-ups,
// the "Try now" and "Check now" buttons and the "Automatic updates" row, in one
// file, so the on-screen text can be changed without touching anything else.
// English only.
//
// WORDING (add-on 0.21.0): confirmed by the owner on 2026-11-13; Legal has not
// cleared it yet. No logic reads these words. The limit-prize note says what
// pressing tells Pauzza (slots design, section 6): keep its meaning if it is
// reworded.
//
// Nothing here comes from the server. The signed list only names a look or a
// pop-up template; the words, colours and pictures are built in. A campaign's
// own name (checked like offer text) is the one server word on its drawer, and
// it never reaches a pop-up.

import type { EventLook } from './catalogue'

export const SLOT_TEXT = {
  // The daily offer drawer, after Connect. Before Connect the practice drawer
  // keeps its old name, "Daily Drop".
  dailyDrawer: 'Daily offer',
  dailyNote: (time: string) => `A new one each day at ${time}, open until ${time} the next day.`,
  dailyOpensAt: (time: string) => `Opens at ${time}`,

  // Limit prizes, under Mine, once the device has seen that limit at 100%.
  fivePrize: '🎁 5-hour limit prize',
  weekPrize: '🎁 Weekly limit prize',
  // What pressing "Get code" on a limit prize tells Pauzza (slots design §6).
  fiveNote: 'Getting this code tells Pauzza you reached a usage limit today.',
  weekNote: 'Getting this code tells Pauzza you reached a usage limit this week.',

  // A present: a step on the ladder by time since connecting.
  present: '🎁 Present',

  // The campaign drawer. `date` is a short day such as "1 Dec".
  campaignUntil: (name: string, date: string) => `${name} · until ${date}`,
  campaignSeenAll: (name: string) => `You have seen all ${name} offers`,

  // Connected, with no signed list in hand, and the server out of reach.
  offlineNoList: "Can't reach Pauzza right now. It will try again later by itself.",
  // The button beside either "Can't reach" line, and what a press may answer.
  tryNow: 'Try now',
  trying: 'Trying…',
  tryWait: 'Just tried. Wait a few seconds, then try again.',
  tryFailed: "Couldn't update the offers. It will keep trying by itself.",

  // Settings, while connected: when the offers were last checked, and a button
  // that checks at once. It is the "Try now" press, sharing its 30 seconds; a
  // failure shows `tryFailed`. `time` is local, such as "14:05"; `day` is a
  // short day such as "15 Nov", used when the last check was not today.
  // Working words (2026-11-16), for the owner to confirm.
  checkedAt: (time: string) => `Offers checked at ${time}`,
  checkedOn: (day: string, time: string) => `Offers checked on ${day} at ${time}`,
  // No time to show: no try saved yet, or the last try failed (the saved
  // schedule then no longer knows when the last good check was).
  notCheckedYet: 'Not checked yet',
  lastCheckFailed: "Last check didn't go through",
  checkNow: 'Check now',
  checking: 'Checking…',
  checkSame: 'Up to date',
  // A newer signed list: it may change no offer on screen, or hide them all
  // through its minimum version, so it says the list changed, not the offers.
  checkNew: 'Offer list updated',
  checkWait: 'Just checked. Wait a few seconds.',

  // Under the drawers when the signed list names a newer add-on. It covers an
  // update already downloaded and one not yet downloaded.
  updateHint: 'A newer Pauzza is out. Type /reload-plugins. If nothing changes, update it in /plugin first.',

  // Settings. Not a switch: the tool gives add-ons and marketplaces no way to
  // turn its auto-update on, and Pauzza never writes the tool's settings.
  autoUpdateTitle: 'Automatic updates',
  autoUpdateHow: 'To switch them on: /plugin → Marketplaces → pauzza → Enable auto-update.',
  autoUpdateOnlyYou: 'Pauzza cannot switch this on for you. Only you can, in /plugin.',
} as const

// Built-in pop-up lines. The signed list may allow them, never word them.
export const NEWS_POPUP = 'Something new in Pauzza · /pauzza'
export const UPDATE_POPUP = 'New Pauzza version · /reload-plugins, or update in /plugin'

// The campaign looks. `name` is what the owner sees in the panel; `emoji`
// heads the drawer in the terminal; `popup` is the look's own fixed line,
// whatever the campaign is called. Colours and icons are drawn in art.ts.
export type LookText = { name: string; emoji: string; popup: string }

export const LOOK_TEXT: Readonly<Record<EventLook, LookText>> = {
  sale: { name: 'Sale', emoji: '🏷', popup: '🏷 Sale is on · /pauzza' },
  'black-friday': { name: 'Black Friday', emoji: '🖤', popup: '🖤 Black Friday deals are on · /pauzza' },
  'new-year': { name: 'New Year', emoji: '🎄', popup: '🎄 New Year deals are on · /pauzza' },
  valentine: { name: "Valentine's", emoji: '❤️', popup: "❤️ Valentine's deals are on · /pauzza" },
  summer: { name: 'Summer', emoji: '☀️', popup: '☀️ Summer deals are on · /pauzza' },
  'back-to-school': { name: 'Back to school', emoji: '📚', popup: '📚 Back to school deals are on · /pauzza' },
  special: { name: 'Special', emoji: '🎉', popup: '🎉 Special deals are on · /pauzza' },
  spotlight: { name: 'Spotlight', emoji: '🔦', popup: '🔦 Spotlight deals are on · /pauzza' },
  fresh: { name: 'Fresh', emoji: '🌱', popup: '🌱 Fresh deals are on · /pauzza' },
}

// A look's words, or undefined for a name this version does not know. Never a
// plain property read: a list could name `constructor`.
export function lookText(look: unknown): LookText | undefined {
  return typeof look === 'string' && Object.hasOwn(LOOK_TEXT, look) ? LOOK_TEXT[look as EventLook] : undefined
}
