// Every word of the acceptance step that is not on the Connect card, in one
// file, so a proofreader's edits touch only this file. English only.
//
// Since the owner's decision of 2026-11-19 the acceptance is the Connect press
// itself: one press accepts the Terms and Privacy Policy, confirms 18 or older,
// and connects. Its words are Legal's Stage B Connect card, in connect-text.ts.
// What stays from the 2026-11-10 decision: the press is never pre-set and has
// no auto-focus, "Not now" sits beside it, and nothing runs or is sent before it.

// Raise TERMS_VERSION for a material change: everyone is asked again, with the
// one press. It names the Stage B Terms 1.0 and Privacy Policy 1.0, bundled as
// TERMS.md and PRIVACY.md; raise it with CONNECT_TERMS_VERSION or
// CONNECT_PRIVACY_VERSION. It replaced 'local-1' (the local-only Terms, accepted
// with a separate tick), so everyone who accepted that is asked again.
export const TERMS_VERSION = 'terms-1.0-privacy-1.0'
// When that version applies: the Stage B start. Before it, someone who accepted
// an earlier version keeps running and sees the update notice; from it, Pauzza
// pauses for them until they press Connect.
export const TERMS_EFFECTIVE = '2026-11-20'
// Saved beside each acceptance. A proofreading fix raises this and asks nobody
// again. The one-press screen: Legal's Connect card (stage-b-1) and the
// usage-figures line.
export const WORDING_VERSION = 'stage-b-1-en'
// One line on what changed. Empty for the first version.
export const TERMS_CHANGE_NOTE = ''

// The official copy. The documents' "view on website" link points here.
export const PUBLIC_REPO_URL = 'https://github.com/pauzza-app/pauzza-addon'
export const hasPublicRepo = !PUBLIC_REPO_URL.includes('[')
// The official copy's page for one of the two documents.
export type DocumentFile = 'TERMS.md' | 'PRIVACY.md'
export const documentUrl = (file: DocumentFile, repo = PUBLIC_REPO_URL) => `${repo}/blob/main/${file}`

export const CONSENT_TEXT = {
  // Beside the Connect press on the first screen and the update notice.
  later: 'Not now',
  // Settings: the two documents the press accepted.
  terms: 'Terms',
  privacy: 'Privacy',
  settingOn: '☑ Pauzza is on',
  settingWarn: 'If you switch Pauzza off, it stops and saved data is deleted.',
  updated: 'Terms updated',
  samples: 'Samples · not real offers',

  // From the approved design, adjusted so that nothing here says "consent".
  invite: '👋 to turn on · /pauzza',
  updateLine: '📄 Terms updated · /pauzza',
  declined: 'OK. Pauzza will show nothing and count nothing. If you change your mind, press "Connect".',
  stopped: 'Pauzza is stopped. If you change your mind, press "Connect".',
  stoppedNow: 'Pauzza stopped',
  deletingIn: (seconds: number) => `Saved data will be deleted in ${seconds} s`,
  undo: 'Undo',
  openOnline: 'View on the website',
} as const
