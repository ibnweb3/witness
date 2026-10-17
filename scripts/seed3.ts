// Third seed (SYNTHETIC): two reports that link to a neutral image hosted on Wikimedia (a "just an Example" placeholder).
// One records the correct fingerprint (the page should verify and show it); one records a different fingerprint
// (the page must refuse to show the image).
import { appendFileSync } from 'node:fs'
import { wallet } from './lib'
import { createReport } from '../src/lib/write'
import { EXPLORER } from '../src/config'

const URL_ = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/250px-Example.jpg'
const REAL = '0x8a97fcb45d6f8ed00ce66d5b5c3251bdf78daf17761fe0fcdd2cf4889bf0a498' as const // sha256 of that file's bytes
const WRONG = '0xbe11757b08b78585b7d6dd99a1025e814f00b0f3d6b69aadf64ce8f67c81055b' as const // sha256 of our own sample PNG instead

const reporter = wallet('REPORTER_KEY')
const rows: string[] = []
for (const [title, hash, note] of [
  ['Synthetic: image hosted elsewhere (fingerprint matches)', REAL, 'Demo record. The image is hosted on Wikimedia, not here. The page should load it after a click and confirm it matches the recorded fingerprint.'],
  ['Synthetic: link points to a different file (must be refused)', WRONG, 'Demo record. The recorded fingerprint belongs to a different file than the one at the link, so the page must refuse to show it.'],
] as const) {
  const r = await createReport(reporter, {
    category: 'other', region: 'zone-east', incidentMs: Date.now() - 2 * 86_400_000, sealed: false,
    payload: { v: 1, sealed: false, title, body: note },
    media: { hash, type: 'image/jpeg', url: URL_ },
  })
  rows.push(`| ${title} | \`${r.entityKey}\` | [${r.txHash.slice(0, 10)}…](${EXPLORER}/tx/${r.txHash}) |`)
  console.log(title, '->', r.entityKey)
}
appendFileSync('arkiv/evidence.md', `\n## Third seed: images linked from another host (synthetic)\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n`)
console.log('done. evidence appended.')
