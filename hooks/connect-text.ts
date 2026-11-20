// Every word of the Connect step and the connected screens, in one file, so the
// on-screen text can be changed without touching anything else. English only.
//
// The "legal" rows are Legal's Stage B Connect card
// (docs/legal/stage-b/connect-wording.md): one sentence, one button and one
// acceptance line. Do not reword a legal row without Legal. The "design" rows
// come from the Stage 2 design hand-over.
//
// ONE PRESS (owner, 2026-11-19): the Connect press is also the acceptance. It
// accepts the Terms and Privacy Policy, confirms 18 or older, and connects.
// There is no separate tick before it. The same card is the first screen, the
// "Terms updated" notice and the card while accepted but not connected.
//
// Each line that is still rehearsal-only ends with the release check's marker
// comment; addon/release-gate.mjs fails while any marker is left.

// The last day of a rehearsal, as YYYY-MM-DD. THE OWNER SETS IT IN ONE PLACE:
// "testEndDate" in `release.json`.
// - Left out, or "": no end date (Stage B and after). Connect is offered, and
//   nothing ends by a date.
// - A real date: Connect is offered until the end of that day. After it the
//   add-on disconnects by itself and deletes what it received from the server.
// - Anything else (a placeholder such as "[TEST END DATE]", or a `release.json`
//   that cannot be read or is not an object): Connect is not offered at all.
let end: [number, number, number] | 'none' | 'unusable' = 'unusable'

function endParts(date: unknown): [number, number, number] | undefined {
  const match = typeof date === 'string' && date.length <= 30 ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null

  if (match === null) {
    return undefined
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const parsed = new Date(year, month - 1, day)

  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? [year, month, day] : undefined
}

// Called once per session with the value read from `release.json`.
export function setTestEndDate(date: unknown) {
  end = date === undefined || date === '' ? 'none' : (endParts(date) ?? 'unusable')
}

// The first moment after the test's last day, on this computer's clock; or
// undefined when there is no end date.
export function testEndsAt(): number | undefined {
  return Array.isArray(end) ? new Date(end[0], end[1] - 1, end[2] + 1).getTime() : undefined
}

export const isTestOver = (now: number) => {
  const endsAt = testEndsAt()

  return endsAt !== undefined && now >= endsAt
}

// May the Connect press connect at all?
export const canOfferConnect = (now: number) => end !== 'unusable' && !isTestOver(now)

// Sent to the server at the Connect press and kept in its receipt of the press.
// Letters, digits, dots and dashes only, 20 characters at most. From Legal
// (Stage B: wording stage-b-1, Terms 1.0, Privacy Policy 1.0).
export const CONNECT_WORDING_VERSION = 'stage-b-1'
export const CONNECT_TERMS_VERSION = '1.0'
export const CONNECT_PRIVACY_VERSION = '1.0'

// The two documents the Connect press accepts, shown on the card and in
// Settings. They travel with the add-on, copied byte for byte from Legal's
// Stage B texts (docs/legal/stage-b/terms.en.md and privacy.en.md).
export const CONNECT_DOCUMENTS = { terms: 'TERMS.md', privacy: 'PRIVACY.md' } as const

export const CONNECT_TEXT = {
  // The Connect card: these rows, and nothing else.
  // legal: what happens
  what: 'Connect to Pauzza to get offers and promo codes from partner shops. Pauzza never reads your code, prompts or conversations.',
  // Under it, in place of the old first screen's "Pauzza sends nothing from
  // your computer", a promise that stays true after Connect: Stage B Privacy
  // Policy point 2, word for word. No usage number is ever sent (a limit
  // prize says what its own "Get code" tells Pauzza). Legal to confirm.
  figures: 'Your usage figures stay on your computer.',
  // legal: the button, alone
  connect: 'Connect',
  // legal: the line under the button, "By connecting you accept the [Terms]
  // and [Privacy Policy] and confirm you are 18 or older.", in the pieces the
  // panel draws: the two names are buttons that open the documents.
  acceptStart: 'By connecting you accept the',
  terms: 'Terms',
  acceptMiddle: 'and',
  privacy: 'Privacy Policy',
  acceptEnd: 'and confirm you are 18 or older.',
  // Working text, Legal to confirm: the one extra line on the Connect card when
  // it is back because the accepted texts changed (rehearsal Privacy point 9,
  // Stage B Terms 13.1 and Privacy 9). Shown in that case only.
  textsChanged: 'The texts have changed. To keep getting offers, read them and press Connect again. Codes you already have stay until their use-by date.',
  // legal: added to the "Pauzza is on" and "Delete" warnings while connected
  alsoDisconnects: 'This also disconnects Pauzza and deletes your install record on the server. Codes already claimed keep working until they expire.',

  // design: the small status word on the "Connected" note
  statusConnected: 'connected',
  statusOffline: 'offline',

  // 2a. design
  connecting: 'Connecting…',
  // 2b. design
  connectedTitle: 'Connected',
  connectedNote: "Offers and codes now come from Pauzza's server. You can disconnect at any time in ⚙.",
  // the marker above server-delivered offers (Stage B)
  offersLabel: 'Partner offers',
  // 2c. design, reworded for the one press (review, 2026-11-19): after a failed
  // press the acceptance is saved, so "Nothing was saved" no longer held. Also
  // used for a busy server.
  connectFailed: "Couldn't connect just now. Pauzza keeps working from its built-in samples; press Connect to try again.",

  // 3a, 3b. design
  hiddenCode: '••••••••',
  getCode: 'Get code',
  getCodeNote: 'A code is fetched only when you press Get code.',
  gettingCode: 'Getting code…',
  // 4a to 4c. design
  useBy: (date: string) => `Use by ${date}`,
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: '✓ Copied',
  // 5a to 5c. design
  noneLeft: 'No codes left',
  unavailable: 'Not available right now',
  noOffers: 'No offers right now',
  noOffersNote: 'Pauzza checks for new ones by itself, a few times a day. Codes you already claimed stay under Mine.',
  // 6. design
  offlineList: "Can't reach Pauzza right now. You're seeing the offers it last received. It will try again later by itself.",
  // Working text: beside an offer whose "Get code" press could not reach the server.
  claimOffline: "Can't reach Pauzza right now.",

  // 7a. Settings, connected: there is one switch, "Pauzza is on" (consent-text.ts).
  // It carries the alsoDisconnects line above and the reference below.
  // design
  reference: 'Your reference',
  referenceNote: 'Quote it if you write to us.',
  // The last line of Settings (owner, 2026-11-19: not beside the codes). Stage B Terms 5.3: claims go to
  // the shop first; a person may also write to us, and we pass the claim on (the vendor outline: within
  // 2 working days).
  support: 'Problem with a code? Tell the shop first, or write to hello@pauzza.ge and we will pass it on.',
  // 7b. design
  disconnected: 'Disconnected',
  offersStopped: 'Offers have stopped.',
  deletingIn: (seconds: number) => `Your install record on the server will be deleted in ${seconds} s.`,
  undo: 'Undo',
  // 7c, 7d. design
  disconnectedDone: 'Disconnected. Your install record on the server is deleted. Codes you already claimed stay here until their use-by date.',
  disconnectedQueued: 'Disconnected. Pauzza will ask the server to delete your install record as soon as it can reach it. Codes you already claimed stay here until their use-by date.',

  // Not in the hand-over: the heading over claimed codes while Pauzza is off.
  yourCodes: 'Your codes',
} as const

// Built-in pop-up line. The signed list chooses it by name and never supplies
// words of its own. Not in the hand-over; working text.
export const OFFER_POPUP = 'A new offer is open · /pauzza'

// 8. The hand-over's status-line strings (design). NOT SHOWN YET: the owner has
// still to choose between this form and the add-on's current short form
// (`🎁 2 · /pauzza`), which this version keeps.
export const STATUS_LINE = {
  invite: '○ pauzza · not connected · /pauzza',
  connected: '● pauzza · connected · /pauzza',
  ready: (count: number) => `● pauzza · ${count} ${count === 1 ? 'code' : 'codes'} ready · /pauzza`,
  offline: '○ pauzza · offline · built-in samples',
} as const
