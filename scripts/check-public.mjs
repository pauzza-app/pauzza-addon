// Checks the promises that can be checked from the files alone. It is a
// tripwire, not proof: a reviewer still reads every change to hooks/.
// Usage: node scripts/check-public.mjs --validate-output validate.txt [--release]
// validate.txt is the output of `claude plugin validate .`.
// --release also checks that the folder is ready to publish.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

const failures = []
const fail = message => failures.push(message)
// Line endings are made plain first, so a Windows checkout reads the same.
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const option = name => {
  const at = process.argv.indexOf(`--${name}`)

  return at === -1 ? undefined : process.argv[at + 1]
}
const isRelease = process.argv.includes('--release')

const surface = JSON.parse(read('scripts/allowed-surface.json'))
const ALLOWED_CALLS = new Set([...surface.calls.map(call => call.slice(2)), 'plugin.root'])
// Every web address that may appear in hooks/, and the files it may appear in:
// the one server address (BASE_URL), the official repository, the SVG
// namespace, and the two forms catalogue.ts compares a signed link with. The
// add-on never fetches a signed link; the person's own browser opens it.
const ADDRESSES = surface.addresses
const FORBIDDEN_CODE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|child_process|eval|globalThis|navigator|arguments)\b|\b(?:Function|require|import)\s*\(|\b(?:process|Bun|Deno)\./
const ALLOWED_FILES = new Set(['offers.json', 'release.json', 'TERMS.md', 'PRIVACY.md'])
// The only functions in hooks/ that may be handed the engine object.
const KNOWN_HELPERS = new Set([
  'changeConsent', 'changeSaved', 'claimOffer', 'connectNow', 'copyCode', 'disconnectNow', 'DrawerRow', 'fetchCatalogue', 'forgetNoneLeft',
  'forgetServerData', 'forgetTextsChanged', 'holdSaved', 'isAccepted', 'isUnreachable', 'loadCatalog', 'loadCodes', 'loadConnection',
  'loadConsent', 'loadDocument', 'loadNoneLeft', 'loadRelease', 'loadReleaseIfUsed', 'loadSaved', 'networkTick', 'noteNoneLeft', 'paintStatus',
  'pruneCodes', 'readLimits', 'redraw', 'refreshStatus', 'resetSaved', 'saveNoneLeft', 'send', 'sendWithdrawal', 'settleConsent',
  'syncAnimation', 'syncPresentTimer', 'syncUndoTimer', 'tryNow', 'undoDisconnectNow', 'wakeServerLink',
])
const ENGINE = String.raw`(?<![\w$.])\$(?![\w{])`
// The one network call, and what it may be given.
const FETCH = /\$\.http\.fetch\b/g
const FETCH_OPTIONS = new Set(['method', 'headers', 'body'])
// The fetch schedule's store key is the one place the word stands alone.
const FETCH_STORE_KEY = "export const FETCH_KEY = 'fetch'"
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>]*/gi

// The text between the parenthesis at `open` and the one that closes it.
function insideParens(code, open) {
  let depth = 0

  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '(') depth += 1
    if (code[at] === ')' && --depth === 0) return code.slice(open + 1, at)
  }

  return code.slice(open + 1)
}

// F1: this generated folder lists the connected accounts of whoever built it.
if (existsSync('.claude-plugin/types')) fail('.claude-plugin/types is present; publish tracked files only')

// F2: an unpinned marketplace entry would follow the head of the repository.
if (existsSync('.claude-plugin/marketplace.json')) {
  const { plugins } = JSON.parse(read('.claude-plugin/marketplace.json'))

  for (const plugin of plugins ?? []) {
    if (!/^[0-9a-f]{40}$/.test(plugin.source?.sha ?? '')) fail(`marketplace entry ${plugin.name} is not pinned to a full commit`)
  }
}

const hooks = readdirSync('hooks').filter(name => /\.tsx?$/.test(name))
const fetches = []
const filesRead = new Set()
const serverSource = existsSync('hooks/server.ts') ? read('hooks/server.ts') : ''
const baseUrl = serverSource.match(/^export const BASE_URL = '([^']+)'$/m)?.[1]
let baseUrlCount = 0

if (baseUrl === undefined || !ADDRESSES[baseUrl]?.includes('server.ts') || !baseUrl.startsWith('https://')) {
  fail('hooks/server.ts: BASE_URL is missing or not an allowed https address')
}

for (const name of hooks) {
  const source = read(join('hooks', name))
  const code = source.replace(/^\s*\/\/.*$/gm, '')
  // Import paths and the one allowed call are checked on their own below.
  let scanned = code.replace(/\bfrom\s+'\.\/[\w.-]+'/g, "from ''").replace(FETCH, '')

  if (name === 'server-link.ts') scanned = scanned.replace(FETCH_STORE_KEY, '')

  const forbidden = scanned.match(FORBIDDEN_CODE)

  if (forbidden) fail(`hooks/${name}: forbidden code: ${forbidden[0]}`)

  for (const [, from] of code.matchAll(/\bfrom\s+'([^']+)'/g)) {
    if (!from.startsWith('./') && from !== 'claude-code') fail(`hooks/${name}: imports ${from}`)
  }

  for (const [, call] of code.matchAll(/\$\.([a-zA-Z]+(?:\.[a-zA-Z]+)?)/g)) {
    if (!ALLOWED_CALLS.has(call)) fail(`hooks/${name}: call not on the allowed list: $.${call}`)
  }

  for (const found of code.matchAll(FETCH)) fetches.push({ name, code, index: found.index })

  // Options that could reach something other than the one address.
  for (const [word] of code.matchAll(/\b(?:auth|socketPath)\b/g)) fail(`hooks/${name}: names ${word}, which the fetch must never be given`)

  // F3: every other way of reaching the engine object.
  if (new RegExp(`${ENGINE}\\s*(?:\\?\\.\\s*)?\\[`).test(code)) fail(`hooks/${name}: bracket access to the engine object`)
  if (new RegExp(`=\\s*${ENGINE}\\s*(?:;|\\n|$)`).test(code)) fail(`hooks/${name}: the engine object is copied`)
  if (/\.\.\.\s*\$(?![\w{])/.test(code)) fail(`hooks/${name}: the engine object is spread`)
  if (new RegExp(`${ENGINE}\\s+as\\b`).test(code)) fail(`hooks/${name}: the engine object is cast`)
  if (/\w\s*:\s*EngineInterface\b/.test(code)) fail(`hooks/${name}: the engine object has another name`)

  for (const [, handler] of code.matchAll(/\bon\(\s*'[^']+'\s*,\s*(?:\{[^}]*\}\s*,\s*)?(?:async\s*)?\(?\s*([^,)\s]+)/g)) {
    if (handler !== '$') fail(`hooks/${name}: a handler names the engine object ${handler}`)
  }

  for (const [, callee] of code.matchAll(new RegExp(`(\\w+)\\(\\s*${ENGINE}\\s*[,)]`, 'g'))) {
    if (!KNOWN_HELPERS.has(callee)) fail(`hooks/${name}: engine object passed to ${callee}`)
  }

  if (new RegExp(`,\\s*${ENGINE}\\s*[,)]`).test(code)) fail(`hooks/${name}: engine object passed as a later argument`)

  for (const [, argument] of code.matchAll(/\$\.fs\.read\(([^)]*)\)/g)) {
    const file = argument.match(/^`\$\{\$\.plugin\.root\}\/([\w.-]+)`$/)?.[1]

    if (!ALLOWED_FILES.has(file)) fail(`hooks/${name}: reads an unexpected file: ${argument}`)
    else filesRead.add(file)
  }

  // Each web address must be one of the few allowed ones, in its own file.
  for (const [address] of code.matchAll(ADDRESS)) {
    if (!Object.hasOwn(ADDRESSES, address)) fail(`hooks/${name}: web address not on the allowed list: ${address}`)
    else if (!ADDRESSES[address].includes(name)) fail(`hooks/${name}: web address not allowed in this file: ${address}`)
    if (address === baseUrl) baseUrlCount += 1
  }
}

if (baseUrl !== undefined && baseUrlCount !== 1) fail(`hooks/: the server address must be written once, as BASE_URL, found ${baseUrlCount}`)

// The one network path: one call site, inside `send` in server-link.ts, to an
// address that starts with BASE_URL, with plain options only.
if (fetches.length !== 1) {
  fail(`hooks/: exactly one $.http.fetch, found ${fetches.length}`)
} else {
  const [{ name, code, index }] = fetches

  if (name !== 'server-link.ts') {
    fail(`the one $.http.fetch must be in hooks/server-link.ts, found in hooks/${name}`)
  } else {
    const start = code.indexOf('\nasync function send(')
    const end = start === -1 ? -1 : code.indexOf('\n}\n', start)

    if (start === -1 || index < start || index > end) fail('hooks/server-link.ts: $.http.fetch is not inside send')
    else if (!code.slice(start, index).includes('if (!request.url.startsWith(BASE_URL)) {')) fail('hooks/server-link.ts: send does not first check the address starts with BASE_URL')
  }

  const args = insideParens(code, code.indexOf('(', index))

  if (!/^request\.url\s*,/.test(args)) fail(`hooks/${name}: the fetch address must be request.url`)
  if (/\.\.\.\s*[\w$]/.test(args)) fail(`hooks/${name}: spreads a value into the fetch options`)

  for (const [, key] of args.matchAll(/(?<![\w.$])(\w+)\s*:/g)) {
    if (!FETCH_OPTIONS.has(key)) fail(`hooks/${name}: fetch option not allowed: ${key}`)
  }
}

// Every file the add-on reads must ship with it.
for (const file of filesRead) if (!existsSync(file)) fail(`${file}: read by the add-on but missing`)

// The two values fixed in the release: the test's last day and the public
// keys the signed offer list is checked against. The rules match what the
// add-on itself accepts in server-link.ts.
let release

try {
  release = JSON.parse(read('release.json'))
} catch {
  fail('release.json: does not parse')
}

if (release !== undefined) {
  const end = release?.testEndDate
  const parts = typeof end === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(end) : null
  const isReal = parts !== null && new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))).toISOString().slice(0, 10) === end
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Left out, or "", means no end date (the launch build), as hooks/connect-text.ts reads it.
  const hasNoEnd = end === undefined || end === ''

  if (!hasNoEnd && !isReal) fail(`release.json: testEndDate is not a real date: ${JSON.stringify(end)}`)
  else if (!hasNoEnd && isRelease && end < today) fail(`release.json: testEndDate ${end} is in the past`)

  const keys = release?.catalogueKeys

  if (typeof keys !== 'object' || keys === null || Array.isArray(keys) || Object.keys(keys).length === 0) {
    fail('release.json: no pinned key in catalogueKeys')
  } else {
    if (Object.keys(keys).length > 4) fail('release.json: more than 4 pinned keys; the add-on reads the first 4 only')

    for (const [id, key] of Object.entries(keys)) {
      if (!/^[a-z0-9-]{1,20}$/.test(id)) fail(`release.json: key id not allowed: ${JSON.stringify(id)}`)
      if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) {
        fail(`release.json: pinned key ${id} is not a base64 value of 32 bytes`)
      }
    }
  }
}

// F3: what the host's own validator sees must equal the reviewed list.
const validateOutput = option('validate-output')

if (validateOutput === undefined || !existsSync(validateOutput)) {
  fail('--validate-output must name the output of `claude plugin validate .`')
} else {
  const lines = read(validateOutput).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)
  const reported = kind => lines.flatMap(line => {
    const found = line.match(new RegExp(`\\./\\S+ ${kind}: (.*)$`))

    return found === null ? [] : [found[1]]
  })
  const compare = (kind, items) => {
    if (reported(kind).length === 0) fail(`validator output has no ${kind} line`)

    const seen = new Set(items)
    const allowed = new Set(surface[kind])

    for (const item of seen) if (!allowed.has(item)) fail(`validator reports ${kind} not on the reviewed list: ${item}`)
    for (const item of allowed) if (!seen.has(item)) fail(`reviewed list has ${kind} the validator no longer reports: ${item}`)
  }

  compare('hooks', reported('hooks').flatMap(line => line.split(/, (?![^{]*\})/)))
  compare('calls', reported('calls').flatMap(line => line.replace(/\s*\(via [^)]*\)/g, '').split(', ')))
}

// CI must never run untrusted pull-request code with write access.
for (const name of readdirSync('.github/workflows')) {
  if (read(join('.github/workflows', name)).includes('pull_request_target')) fail(`${name}: uses pull_request_target`)
}

// F3 and T1: the owner reviews what can change users' machines.
if (!existsSync('.github/CODEOWNERS')) {
  fail('.github/CODEOWNERS is missing')
} else {
  const owners = read('.github/CODEOWNERS')

  for (const path of ['/hooks/', '/.claude-plugin/', '/.github/', '/scripts/', '/release.json']) {
    if (!owners.split(/\r?\n/).some(line => line.startsWith(`${path} @`))) fail(`.github/CODEOWNERS does not cover ${path}`)
  }
}

// F4: promises that were found to be untrue must not come back.
const manifest = JSON.parse(read('.claude-plugin/plugin.json'))
const readme = read('README.md')

if (/nothing shows/i.test(manifest.description ?? '')) fail('plugin.json: description says nothing shows')
if (readme.includes('შენახული მონაცემების წაშლა')) fail('README.md: names a button that does not exist')
if (/\b[a-z]:\\/i.test(readme)) fail('README.md: contains a local path')

// The version the add-on reports to the server is the version people install.
const addonVersion = serverSource.match(/^export const ADDON_VERSION = '([^']*)'$/m)?.[1]

if (addonVersion !== manifest.version) fail(`hooks/server.ts: ADDON_VERSION ${addonVersion} does not equal plugin.json ${manifest.version}`)

// T10: the public statement people rely on.
if (!/only official copy/.test(readme)) fail('README.md: official address statement is missing')
if (!/never asks for your card details or passwords/.test(readme)) fail('README.md: "never asks" statement is missing')

// Relative links must name a real file: GitHub file names are case-sensitive.
for (const file of readdirSync('.').filter(name => name.endsWith('.md'))) {
  for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue
    if (!readdirSync('.').includes(target.split('/')[0]) || !existsSync(target)) fail(`${file}: link to a missing file: ${target}`)
  }
}

// The licence covers code only.
const licence = read('LICENSE')

if (!/All rights reserved/.test(licence) || /MIT License/.test(licence) || !/\bimage\b/.test(licence) || !/name "Pauzza"/.test(licence)) fail('LICENSE: must reserve all rights, with the pictures and name excluded')

// Every prize in the bundled catalogue must be fictional.
const walk = (value, visit) => {
  if (Array.isArray(value)) value.forEach(item => walk(item, visit))
  else if (value !== null && typeof value === 'object') {
    visit(value)
    Object.values(value).forEach(item => walk(item, visit))
  }
}
let prizes = 0

walk(JSON.parse(read('offers.json')), item => {
  if (item.code === undefined && item.brand === undefined) return
  prizes += 1
  if (!/^Test /.test(item.brand ?? '') || !/^TEST-[A-Z0-9]{4}$/.test(item.code ?? '')) fail(`offers.json: not fictional: ${item.id}`)
})
if (prizes === 0) fail('offers.json: no prizes found')

if (isRelease) {
  const LEGAL = ['TERMS.md', 'TERMS.ka.md', 'PRIVACY.md', 'PRIVACY.ka.md']

  // Terms, Privacy and the README may not ship with open values. A link is not
  // one, and neither is a bracket with fewer than two letters in it, such as
  // the meter samples `[x]build` and `[█████▎····]` in the README.
  for (const file of [...LEGAL, 'README.md', 'RELEASING.md']) {
    const open = read(file).match(/\[[^\]\n]*\p{L}[^\]\n]*\p{L}[^\]\n]*\](?!\()/gu) ?? []

    if (open.length > 0) fail(`${file}: ${open.length} open values, such as ${open[0]}`)
  }

  for (const file of LEGAL) {
    if (/DRAFT, not in force|DRAFT for Legal|ჯერ არ მოქმედებს/.test(read(file))) fail(`${file}: still marked as a draft`)
  }

  // No rehearsal value or marked rehearsal wording may ship (scripts/release-gate.mjs lists each one).
  const gate = spawnSync(process.execPath, ['scripts/release-gate.mjs', '.'], { encoding: 'utf8' })

  if (gate.status !== 0) fail(`release gate: ${(gate.stdout + gate.stderr).trim().split(/\r?\n/).join('; ')}`)

  if (read('hooks/consent-text.ts').includes('[OWNER]')) fail('hooks/consent-text.ts: the public address still has [OWNER]')

  // F5: a repository of its own with no personal address. The first release was one commit; each later
  // release adds one on top, so the count is not checked.
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync('.')) fail('not the top of its own git repository')

    const commits = git('log', '--all', '--format=%ae%n%ce').split('\n')

    for (const email of new Set(commits)) {
      if (!email.endsWith('@users.noreply.github.com')) fail('a commit does not use a no-reply address')
    }

    if (git('ls-files').split('\n').some(path => path.startsWith('.claude-plugin/types/'))) fail('generated types are tracked')
  } catch {
    fail('not a git repository with a commit')
  }
}

if (failures.length > 0) {
  console.error(failures.map(item => `FAIL ${item}`).join('\n'))
  process.exit(1)
}

console.log(`OK: ${hooks.length} code files, one network call to ${baseUrl}, ${prizes} fictional prizes, host surface matches the reviewed list`)
