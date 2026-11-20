// The release check for add-on 0.21.0, the launch version (slots design,
// section 10). It fails while any rehearsal value is still in the add-on's
// folder, and lists each one. Run it before a release; it reads files only.
//
// Usage: node scripts/release-gate.mjs . (public copy), or node addon/release-gate.mjs [plugin folder] (company checkout)
// The folder defaults to addon/pauza-test beside this script.
// Exit 0: no rehearsal value left. Exit 1: the list of what is left.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The rehearsal's values. Each must be replaced by the launch value before
// 0.21.0 is released (the Stage B work).
const REHEARSAL_END_DATE = '2026-11-25'
const REHEARSAL_VERSIONS = [
  ['CONNECT_WORDING_VERSION', 'stage-2-test-0.1', 'the Connect wording version'],
  ['CONNECT_TERMS_VERSION', '0.1', 'the Connect Terms version'],
  ['CONNECT_PRIVACY_VERSION', '0.1', 'the Connect Privacy version'],
]
const DRAFT_MARKER = 'DRAFT for Legal'
// Every rehearsal-only text carries one of these markers: at the end of its
// line in hooks/ (a comment), or after it in a Markdown file (an HTML comment,
// which the add-on removes before showing a document). The manifest cannot
// hold a comment, so its description is checked for rehearsal words directly.
const CODE_MARKER = /\/\/ REHEARSAL-WORDING$/
const DOC_MARKER = '<!-- REHEARSAL-WORDING -->'
const REHEARSAL_DESCRIPTION = /practice run|fictional|made[- ]up|test (offers|codes|rewards|version)/i

// Line endings are made plain first, so a Windows checkout reads the same.
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

// Every rehearsal value still in `folder`, as plain sentences. A file that
// cannot be read counts as one: the check never passes by not looking.
export function rehearsalValues(folder) {
  const left = []
  const attempt = (name, check) => {
    let text

    try {
      text = read(join(folder, name))
    } catch {
      left.push(`${name}: cannot be read`)

      return
    }

    check(text)
  }

  attempt('release.json', text => {
    let end

    try {
      end = JSON.parse(text)?.testEndDate
    } catch {
      left.push('release.json: does not parse')

      return
    }

    if (end === REHEARSAL_END_DATE) {
      left.push(`release.json: testEndDate is still the rehearsal's ${REHEARSAL_END_DATE}; the launch end-date handling must replace it`)
    }
  })

  attempt('hooks/connect-text.ts', text => {
    for (const [name, value, what] of REHEARSAL_VERSIONS) {
      const found = text.match(new RegExp(`^export const ${name} = '([^']*)'$`, 'm'))?.[1]

      if (found === undefined) {
        left.push(`hooks/connect-text.ts: ${name} (${what}) is missing`)
      } else if (found === value) {
        left.push(`hooks/connect-text.ts: ${name} is still the rehearsal's '${value}' (${what}); Legal's launch version replaces it`)
      }
    }
  })

  attempt('PRIVACY.md', text => {
    if (text.includes(DRAFT_MARKER)) {
      left.push(`PRIVACY.md: still holds the "${DRAFT_MARKER}" text; Legal's wording of the limit-prize points replaces it`)
    }
  })

  // Rehearsal wording, marked line by line.
  const marked = (name, lines, isMarked) => {
    const at = lines.flatMap((line, index) => (isMarked(line) ? [index + 1] : []))

    if (at.length > 0) {
      left.push(`${name}: rehearsal wording still marked on line${at.length === 1 ? '' : 's'} ${at.join(', ')}`)
    }
  }
  const list = path => {
    try {
      return readdirSync(join(folder, path)).sort()
    } catch {
      left.push(`${path === '.' ? 'the folder' : `${path}/`}: cannot be listed`)

      return []
    }
  }

  for (const name of list('hooks').filter(file => /\.tsx?$/.test(file))) {
    attempt(`hooks/${name}`, text => marked(`hooks/${name}`, text.split('\n'), line => CODE_MARKER.test(line)))
  }

  for (const name of list('.').filter(file => file.endsWith('.md'))) {
    attempt(name, text => marked(name, text.split('\n'), line => line.includes(DOC_MARKER)))
  }

  attempt('.claude-plugin/plugin.json', text => {
    let description

    try {
      description = JSON.parse(text)?.description
    } catch {
      left.push('.claude-plugin/plugin.json: does not parse')

      return
    }

    if (typeof description !== 'string' || REHEARSAL_DESCRIPTION.test(description)) {
      left.push('.claude-plugin/plugin.json: the description is still the rehearsal one ("practice run", "fictional test rewards", "test offers and test codes")')
    }
  })

  return left
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const folder = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'pauza-test'))
  const left = rehearsalValues(folder)

  if (left.length > 0) {
    console.error(`Not ready to release: ${left.length} rehearsal value${left.length === 1 ? '' : 's'} left in ${folder}`)

    for (const item of left) {
      console.error(`- ${item}`)
    }

    process.exit(1)
  }

  console.log(`Ready: no rehearsal value left in ${folder}`)
}
