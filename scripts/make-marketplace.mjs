// Writes the marketplace repository's file, fixed to one exact commit of the add-on.
// Usage: node scripts/make-marketplace.mjs --repo OWNER/pauzza-addon --ref pauzza--v1.2.3 --sha <40 hex> --out DIR

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const option = name => {
  const at = process.argv.indexOf(`--${name}`)

  return at === -1 ? undefined : process.argv[at + 1]
}
const stop = message => {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

const repo = option('repo')
const ref = option('ref')
const sha = option('sha')
const out = option('out')
const { name, version } = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))

if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo ?? '')) stop('--repo must be OWNER/NAME')
if (ref !== `${name}--v${version}`) stop(`--ref must be ${name}--v${version}, matching plugin.json`)
if (!/^[0-9a-f]{40}$/.test(sha ?? '') || /^0+$/.test(sha)) stop('--sha must be the full 40-character commit')
if (out === undefined) stop('--out is required')

const marketplace = {
  name: 'pauzza',
  owner: { name: 'Pauzza' },
  description: 'The official Pauzza add-on.',
  plugins: [
    {
      name,
      description: 'Pauzza practice run with fictional test offers.',
      source: { source: 'github', repo, ref, sha },
    },
  ],
}

mkdirSync(join(out, '.claude-plugin'), { recursive: true })
writeFileSync(join(out, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`)
console.log(`Pinned ${name} ${version} to ${repo}@${sha}`)
