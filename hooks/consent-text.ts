// Every word of the acceptance step, in one file, so a proofreader's edits touch
// only this file. English only. Rows marked "legal" are the English column of
// the "Stage 1 wording" table in the legal requirements, with the 2026-11-10
// "pressing" fix: do not change their meaning without Legal.

// Raise TERMS_VERSION for a material change: everyone is asked again.
export const TERMS_VERSION = 'local-1'
// When that version applies. After this date, people who have not accepted it pause.
export const TERMS_EFFECTIVE = '2026-11-09'
// Saved beside each acceptance. A proofreading fix raises this and asks nobody again.
export const WORDING_VERSION = 'stage-1.4-en'
// One line on what changed. Empty for the first version.
export const TERMS_CHANGE_NOTE = ''

// The official copy. The documents' "view on website" link points here.
export const PUBLIC_REPO_URL = 'https://github.com/pauzza-app/pauzza-addon'
export const hasPublicRepo = !PUBLIC_REPO_URL.includes('[')
// The official copy's page for one of the two documents.
export type DocumentFile = 'TERMS.md' | 'PRIVACY.md'
export const documentUrl = (file: DocumentFile, repo = PUBLIC_REPO_URL) => `${repo}/blob/main/${file}`

export const CONSENT_TEXT = {
  // legal
  what: 'This is a test version: every offer and code is made up and works nowhere. Pauzza sends nothing from your computer and does not read your code, prompts or conversations.',
  tick: '☐ I accept the Terms',
  later: 'Not now',
  age: 'By pressing you confirm you are 18 or older.',
  terms: 'Terms',
  privacy: 'Privacy',
  cancelIn: 'Cancel in ⚙',
  settingOn: '☑ Pauzza is on',
  settingWarn: 'If you switch Pauzza off, it stops and saved data is deleted.',
  updated: 'Terms updated',
  updateTick: '☐ I accept the updated terms',
  samples: 'Samples · not real offers',

  // From the approved design, adjusted so that nothing here says "consent".
  invite: '👋 to turn on · /pauzza',
  updateLine: '📄 Terms updated · /pauzza',
  declined: 'OK. Pauzza will show nothing and count nothing. If you change your mind, press "I accept the Terms".',
  stopped: 'Pauzza is stopped. If you change your mind, press "I accept the Terms".',
  stoppedNow: 'Pauzza stopped',
  deletingIn: (seconds: number) => `Saved data will be deleted in ${seconds} s`,
  undo: 'Undo',
  openOnline: 'View on the website',
} as const
