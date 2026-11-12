// Every word of the Connect step and the connected screens, in one file, so the
// on-screen text can be changed without touching anything else. English only.
//
// The "legal" rows are Legal's "Test version 0.1" wording for the consent
// screens (owner's decision, 2026-11-11): a plain card with one sentence, one
// button and one acceptance line. Do not reword a legal row without Legal. The
// "design" rows come from the Stage 2 design hand-over.
//
// BEFORE THE FIRST REAL OFFER: Legal's real-offer wording, documents and
// versions replace these, and everyone connected must press "Connect" again.

// The last day of the test, as YYYY-MM-DD. THE OWNER SETS IT IN ONE PLACE:
// "testEndDate" in `release.json`. The same date is in TERMS-REHEARSAL.md and
// PRIVACY-REHEARSAL.md. While it is missing or not a real date the Connect card
// is not offered at all. After that day the add-on disconnects by itself and
// deletes what it received from the server.
let endDate = ''

// Called once per session with the value read from `release.json`.
export function setTestEndDate(date: unknown) {
  endDate = typeof date === 'string' && date.length <= 30 ? date : ''
}

function endParts(): [number, number, number] | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate)

  if (match === null) {
    return undefined
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? [year, month, day] : undefined
}

// The first moment after the test's last day, on this computer's clock; or
// undefined while the date is not filled in.
export function testEndsAt(): number | undefined {
  const parts = endParts()

  return parts === undefined ? undefined : new Date(parts[0], parts[1] - 1, parts[2] + 1).getTime()
}

export const isTestOver = (now: number) => {
  const end = testEndsAt()

  return end !== undefined && now >= end
}

// May the Connect card be offered at all?
export const canOfferConnect = (now: number) => endParts() !== undefined && !isTestOver(now)

// Sent to the server at the Connect press and kept in its receipt of the press.
// Letters, digits, dots and dashes only, 20 characters at most. From Legal.
export const CONNECT_WORDING_VERSION = 'stage-2-test-0.1'
export const CONNECT_TERMS_VERSION = '0.1'
export const CONNECT_PRIVACY_VERSION = '0.1'

// The two documents shown on the Connect card and while connected. They travel
// with the add-on, copied byte for byte from Legal's rehearsal texts.
export const CONNECT_DOCUMENTS = { terms: 'TERMS-REHEARSAL.md', privacy: 'PRIVACY-REHEARSAL.md' } as const

export const CONNECT_TEXT = {
  // The Connect card. Nothing else goes on it.
  // legal: what happens
  what: "Connect to Pauzza's server to get made-up test codes. Pauzza never reads your code, prompts or conversations.",
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
  // legal: the marker above server-delivered test codes
  testCodes: 'Test codes · not real offers',
  // 2c. design: also used for a busy server
  connectFailed: "Couldn't connect just now. Nothing was saved. Pauzza keeps working from its built-in samples.",

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
  offlineSamples: "Can't reach Pauzza right now. You're seeing the built-in samples. It will try again later by itself.",
  offlineList: "Can't reach Pauzza right now. You're seeing the offers it last received. It will try again later by itself.",
  // Working text: beside an offer whose "Get code" press could not reach the server.
  claimOffline: "Can't reach Pauzza right now.",

  // 7a. Settings, connected: there is one switch, "Pauzza is on" (consent-text.ts).
  // It carries the alsoDisconnects line above and the reference below.
  // design
  reference: 'Your reference',
  referenceNote: 'Quote it if you write to us about your data.',
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
