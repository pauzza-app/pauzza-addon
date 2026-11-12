// Run with: node --test scripts/check-public.test.mjs
// Each test copies the repository to a temporary folder, breaks one thing and
// checks that the guard notices.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const ROOT = resolve(import.meta.dirname, '..')
const surface = JSON.parse(readFileSync(join(ROOT, 'scripts/allowed-surface.json'), 'utf8'))
const validatorText = (hooks = surface.hooks, calls = surface.calls) =>
  `  ❯ ./register.tsx hooks: ${hooks.join(', ')}\n  ❯ ./register.tsx calls: ${calls.map(call => `${call} (via a, b)`).join(', ')}\n`

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'pauzza-guard-'))

  cpSync(ROOT, dir, { recursive: true, filter: source => !/[\\/](\.git|node_modules|validate\.txt)$/.test(source) })
  writeFileSync(join(dir, 'validate.txt'), validatorText())

  return dir
}

function guard(dir, ...extra) {
  return spawnSync(process.execPath, ['scripts/check-public.mjs', '--validate-output', 'validate.txt', ...extra], { cwd: dir, encoding: 'utf8' })
}

function expectFailure(change, pattern, ...extra) {
  const dir = copy()

  try {
    change(dir)
    const result = guard(dir, ...extra)

    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, pattern)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const addCode = (dir, code) => appendFileSync(join(dir, 'hooks/meters.ts'), `\n${code}\n`)
const edit = (dir, file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')))

test('the staged folder passes', () => {
  const dir = copy()

  try {
    const result = guard(dir)

    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('F1: the generated types folder is refused', () => {
  expectFailure(dir => mkdirSync(join(dir, '.claude-plugin/types')), /types is present/)
})

test('F2: an unpinned marketplace entry is refused', () => {
  expectFailure(dir => writeFileSync(join(dir, '.claude-plugin/marketplace.json'), JSON.stringify({ plugins: [{ name: 'pauzza', source: './' }] })), /not pinned/)
})

function marketplace(args) {
  const dir = mkdtempSync(join(tmpdir(), 'pauzza-market-'))
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/make-marketplace.mjs'), ...args, '--out', dir], { cwd: ROOT, encoding: 'utf8' })

  return { dir, result }
}

const { version } = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
const REF = `pauzza--v${version}`
const SHA = '0123456789abcdef0123456789abcdef01234567'

test('F2: the generator writes a full commit pin', () => {
  const { dir, result } = marketplace(['--repo', 'owner/pauzza-addon', '--ref', REF, '--sha', SHA])

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].source, { source: 'github', repo: 'owner/pauzza-addon', ref: REF, sha: SHA })
  rmSync(dir, { recursive: true, force: true })
})

for (const [label, args] of [
  ['a short commit', ['--repo', 'owner/pauzza-addon', '--ref', REF, '--sha', 'abc123']],
  ['an all-zero commit', ['--repo', 'owner/pauzza-addon', '--ref', REF, '--sha', '0'.repeat(40)]],
  ['a tag that disagrees with the version', ['--repo', 'owner/pauzza-addon', '--ref', 'pauzza--v9.9.9', '--sha', SHA]],
  ['an unfilled owner', ['--repo', '[OWNER]/pauzza-addon', '--ref', REF, '--sha', SHA]],
]) {
  test(`F2: the generator refuses ${label}`, () => {
    const { dir, result } = marketplace(args)

    assert.equal(result.status, 1)
    rmSync(dir, { recursive: true, force: true })
  })
}

for (const [label, code, pattern] of [
  ['a network call', "const a = fetch('x')", /forbidden code/],
  ['a process call', '$.process.run()', /not on the allowed list/],
  ['bracket access', "$['http']", /bracket access/],
  ['optional bracket access', "$?.['http']", /bracket access/],
  ['copying the engine', 'const e = $\n', /copied/],
  ['spreading the engine', 'const e = { ...$ }', /spread/],
  ['casting the engine', '($ as any).http', /cast/],
  ['an unknown helper', 'sneak($)', /passed to sneak/],
  ['a later argument', 'loadArt(1, $)', /later argument/],
  ['a renamed engine parameter', 'function f(engine: EngineInterface) {}', /another name/],
  ['a renamed handler parameter', "on('session.start', async (engine, e, next) => next(e))", /handler names/],
  ['an unexpected file', '$.fs.read(`${$.plugin.root}/secret.json`)', /unexpected file/],
  ['a web address', "const a = 'https://example.test'", /web address/],
  ['another repository address', "const a = 'https://github.com/someone/other-addon'", /web address/],
  ['a file below the add-on address', "const a = 'https://github.com/someone/pauzza-addon/evil'", /web address/],
]) {
  test(`F3: ${label} is refused`, () => {
    expectFailure(dir => addCode(dir, code), pattern)
  })
}

// The one network path: one call site, in `send`, to one address.
const FETCH_OPTIONS = '{ method: request.method,'

for (const [label, change, pattern] of [
  ['a second network call in another file', dir => addCode(dir, '$.http.fetch(BASE_URL)'), /exactly one \$\.http\.fetch, found 2/],
  ['a second network call in the same file', dir => appendFileSync(join(dir, 'hooks/server-link.ts'), '\nexport const leak = ($: EngineInterface) => $.http.fetch(BASE_URL)\n'), /exactly one \$\.http\.fetch, found 2/],
  ['the network call moved out of send', dir => edit(dir, 'hooks/server-link.ts', text => text.replace('async function send(', 'async function sendIt(')), /not inside send/],
  ['the network call moved to another file', dir => {
    edit(dir, 'hooks/server-link.ts', text => text.replace('$.http.fetch(', 'fetchFor($)('))
    addCode(dir, '$.http.fetch(BASE_URL)')
  }, /must be in hooks\/server-link\.ts/],
  ['auth passed to the fetch', dir => edit(dir, 'hooks/server-link.ts', text => text.replace(FETCH_OPTIONS, `{ auth: 'a:b', method: request.method,`)), /auth/],
  ['socketPath passed to the fetch', dir => edit(dir, 'hooks/server-link.ts', text => text.replace(FETCH_OPTIONS, `{ socketPath: '/x', method: request.method,`)), /socketPath/],
  ['an unknown fetch option', dir => edit(dir, 'hooks/server-link.ts', text => text.replace(FETCH_OPTIONS, `{ redirect: 'follow', method: request.method,`)), /fetch option not allowed: redirect/],
  ['a spread into the fetch options', dir => edit(dir, 'hooks/server-link.ts', text => text.replace(FETCH_OPTIONS, '{ ...request, method: request.method,')), /spreads a value into the fetch options/],
  ['a foreign server address', dir => edit(dir, 'hooks/server.ts', text => text.replace('https://pwchzyltlirhiiaxoifb.supabase.co/functions/v1/', 'https://evil.example/functions/v1/')), /web address not on the allowed list: https:\/\/evil\.example/],
  ['the server address in a second file', dir => addCode(dir, "const a = 'https://pwchzyltlirhiiaxoifb.supabase.co/functions/v1/'"), /meters\.ts: web address not allowed in this file/],
  ['another scheme', dir => addCode(dir, "const a = 'wss://pwchzyltlirhiiaxoifb.supabase.co/'"), /web address not on the allowed list: wss:/],
  ['a mismatched add-on version', dir => edit(dir, 'hooks/server.ts', text => text.replace(/ADDON_VERSION = '[^']+'/, "ADDON_VERSION = '0.0.1'")), /ADDON_VERSION 0\.0\.1 does not equal plugin\.json/],
]) {
  test(`Network: ${label} is refused`, () => {
    expectFailure(change, pattern)
  })
}

const setRelease = (dir, change) => edit(dir, 'release.json', text => JSON.stringify(change(JSON.parse(text)), null, 2))

for (const [label, change, pattern] of [
  ['an unreadable release.json', dir => writeFileSync(join(dir, 'release.json'), '{ not json'), /release\.json: does not parse/],
  ['a missing end date', dir => setRelease(dir, data => ({ ...data, testEndDate: '' })), /testEndDate is not a real date/],
  ['an impossible end date', dir => setRelease(dir, data => ({ ...data, testEndDate: '2026-02-30' })), /testEndDate is not a real date/],
  ['no pinned key', dir => setRelease(dir, data => ({ ...data, catalogueKeys: {} })), /no pinned key/],
  ['an empty pinned key', dir => setRelease(dir, data => ({ ...data, catalogueKeys: { 'owner-x': '' } })), /owner-x is not a base64 value of 32 bytes/],
  ['a short pinned key', dir => setRelease(dir, data => ({ ...data, catalogueKeys: { 'owner-x': 'AAAA' } })), /owner-x is not a base64 value of 32 bytes/],
  ['a pinned key that is not base64', dir => setRelease(dir, data => ({ ...data, catalogueKeys: { 'owner-x': `${'*'.repeat(43)}=` } })), /owner-x is not a base64 value of 32 bytes/],
  ['a badly named key', dir => setRelease(dir, data => ({ ...data, catalogueKeys: { 'Owner X': data.catalogueKeys[Object.keys(data.catalogueKeys)[0]] } })), /key id not allowed/],
  ['more keys than the add-on reads', dir => setRelease(dir, data => {
    const key = Object.values(data.catalogueKeys)[0]

    return { ...data, catalogueKeys: { a: key, b: key, c: key, d: key, e: key } }
  }), /more than 4 pinned keys/],
]) {
  test(`Release file: ${label} is refused`, () => {
    expectFailure(change, pattern)
  })
}

test('Release file: an end date in the past is refused for a release', () => {
  expectFailure(dir => setRelease(dir, data => ({ ...data, testEndDate: '2020-01-01' })), /testEndDate 2020-01-01 is in the past/, '--release')
})

test('F3: a validator call off the reviewed list is refused', () => {
  expectFailure(dir => writeFileSync(join(dir, 'validate.txt'), validatorText(surface.hooks, [...surface.calls, '$.http.request'])), /not on the reviewed list: \$\.http\.request/)
})

test('F3: a validator hook off the reviewed list is refused', () => {
  expectFailure(dir => writeFileSync(join(dir, 'validate.txt'), validatorText([...surface.hooks, 'model.request'], surface.calls)), /not on the reviewed list: model\.request/)
})

test('F3: missing validator output is refused', () => {
  expectFailure(dir => rmSync(join(dir, 'validate.txt')), /validate-output/)
})

test('F3: pull_request_target is refused', () => {
  expectFailure(dir => appendFileSync(join(dir, '.github/workflows/ci.yml'), '\n# pull_request_target\n'), /pull_request_target/)
})

test('F3: CODEOWNERS must cover the sensitive folders', () => {
  expectFailure(dir => edit(dir, '.github/CODEOWNERS', text => text.replace('/hooks/ ', '/other/ ')), /does not cover \/hooks\//)
})

test('F3: CODEOWNERS must cover release.json', () => {
  expectFailure(dir => edit(dir, '.github/CODEOWNERS', text => text.replace('/release.json ', '/other.json ')), /does not cover \/release\.json/)
})

test('F4: the false manifest promise is refused', () => {
  expectFailure(dir => edit(dir, '.claude-plugin/plugin.json', text => text.replace('A small meter', 'Nothing shows during the wait. A small meter')), /says nothing shows/)
})

test('F4: the wrong button name is refused', () => {
  expectFailure(dir => appendFileSync(join(dir, 'README.md'), '\nშენახული მონაცემების წაშლა\n'), /button that does not exist/)
})

test('F5: a local path in the README is refused', () => {
  expectFailure(dir => appendFileSync(join(dir, 'README.md'), '\nD:\\somewhere\\else\n'), /local path/)
})

test('T10: the official address statement is required', () => {
  expectFailure(dir => edit(dir, 'README.md', text => text.replace('only official copy', 'copy')), /official address/)
})

test('T10: the "never asks" statement is required', () => {
  expectFailure(dir => edit(dir, 'README.md', text => text.replace('never asks for your card details or passwords', 'is nice')), /never asks/)
})

test('Links: a link to a missing file is refused', () => {
  expectFailure(dir => edit(dir, 'README.md', text => text.replace('](TERMS.md)', '](terms.md)')), /link to a missing file: terms\.md/)
})

test('Licence: all rights must stay reserved', () => {
  expectFailure(dir => edit(dir, 'LICENSE', text => text.replace('All rights reserved', 'MIT License')), /LICENSE/)
})

test('Files: a file the add-on reads must ship', () => {
  expectFailure(dir => rmSync(join(dir, 'TERMS-REHEARSAL.md')), /TERMS-REHEARSAL\.md: read by the add-on but missing/)
})

test('Licence: the pictures and name must stay excluded', () => {
  expectFailure(dir => edit(dir, 'LICENSE', text => text.replaceAll('image', 'nothing')), /LICENSE/)
})

test('Release: open values are refused', () => {
  // Plants its own blank, so it still passes once the real details are filled in.
  expectFailure(dir => appendFileSync(join(dir, 'TERMS.md'), '\nOperator: [ENTITY NAME]\n'), /TERMS\.md: \d+ open values/, '--release')
})

for (const file of ['TERMS-REHEARSAL.md', 'PRIVACY-REHEARSAL.md']) {
  test(`Release: open values in ${file} are refused`, () => {
    expectFailure(dir => appendFileSync(join(dir, file), '\nEnds on [DATE]\n'), new RegExp(`${file.replace('.', '\\.')}: \\d+ open values`), '--release')
  })

  test(`Release: a draft notice in ${file} is refused`, () => {
    expectFailure(dir => appendFileSync(join(dir, file), '\nDRAFT, not in force\n'), new RegExp(`${file.replace('.', '\\.')}: still marked as a draft`), '--release')
  })
}

// Today plus some days, as YYYY-MM-DD, so the release tests do not age.
const daysAhead = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

// A folder that would pass the release check, apart from what each test breaks.
function releaseReady(email, commits = 1) {
  const dir = copy()
  const run = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })

  for (const file of ['TERMS.md', 'TERMS.ka.md', 'PRIVACY.md', 'PRIVACY.ka.md', 'TERMS-REHEARSAL.md', 'PRIVACY-REHEARSAL.md']) writeFileSync(join(dir, file), 'Final text. [Link](PRIVACY.md)\n')
  setRelease(dir, data => ({ ...data, testEndDate: daysAhead(30) }))
  edit(dir, 'README.md', text => text.replaceAll('[OWNER]', 'owner'))
  edit(dir, 'RELEASING.md', text => text.replaceAll('[OWNER]', 'owner'))
  edit(dir, 'hooks/consent-text.ts', text => text.replaceAll('[OWNER]', 'owner'))
  run('init', '-q', '-b', 'main')
  run('add', '-A')

  for (let index = 0; index < commits; index += 1) {
    run('-c', 'user.name=Pauzza', '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', `Release ${index}`)
  }

  return dir
}

const NO_REPLY = '1+someone@users.noreply.github.com'

test('F5: a fresh one-commit repository with a no-reply address passes', () => {
  const dir = releaseReady(NO_REPLY)

  try {
    const result = guard(dir, '--release')

    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('F5: more than one commit is refused', () => {
  const dir = releaseReady(NO_REPLY, 2)

  try {
    const result = guard(dir, '--release')

    assert.equal(result.status, 1)
    assert.match(result.stderr, /one commit, found 2/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('F5: a personal address is refused', () => {
  const dir = releaseReady('person@example.test')

  try {
    const result = guard(dir, '--release')

    assert.equal(result.status, 1)
    assert.match(result.stderr, /no-reply/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
