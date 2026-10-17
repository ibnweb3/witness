// Fourth seed (SYNTHETIC): reports that carry a small preview image inside the payload (the Arkiv team confirmed this is allowed).
// 1) corroborated by both reviewers, so it is Verified and its picture shows on the homepage card;
// 2) not reviewed, so it stays Unverified and its picture is hidden until a reader chooses to show it.
// The picture is our own synthetic sample (a chart-like graphic with no people or places).
import { appendFileSync, readFileSync } from 'node:fs'
import { wallet } from './lib'
import { createReport, createReview } from '../src/lib/write'
import { sha256Hex } from '../src/lib/crypto'
import { EXPLORER } from '../src/config'

const png = new Uint8Array(readFileSync('public/demo/synthetic-image.png')) as Uint8Array<ArrayBuffer>
const preview = { type: 'image/png', b64: Buffer.from(png).toString('base64'), w: 320, h: 200 }
const hash = await sha256Hex(png)
console.log('preview', png.length, 'bytes, base64', preview.b64.length, 'chars')

const reporter = wallet('REPORTER_KEY'), a = wallet('REVIEWER_KEY'), b = wallet('REVIEWER2_KEY')
const rows: string[] = []
const row = (what: string, key: string, tx: string) => rows.push(`| ${what} | \`${key}\` | [${tx.slice(0, 10)}…](${EXPLORER}/tx/${tx}) |`)

const mk = async (title: string, body: string, category: string) => {
  const r = await createReport(reporter, {
    category, region: 'zone-west', incidentMs: Date.now() - 86_400_000, sealed: false,
    payload: { v: 1, sealed: false, title, body, preview },
    media: { hash, type: 'image/png' },
  })
  row(title, r.entityKey, r.txHash)
  return r.entityKey as `0x${string}`
}

const verified = await mk('Synthetic: report with a picture (verified)', 'Demo record with a small preview image stored inside the report. Two reviewers corroborated it, so its picture appears on the homepage card.', 'environment')
for (const [w, note] of [[a, 'Synthetic: reviewer A corroborates the picture report.'], [b, 'Synthetic: reviewer B corroborates the picture report.']] as const) {
  const r = await createReview(w, verified, 'corroborated', note)
  row('review: corroborated → Verified', r.entityKey, r.txHash)
}
await mk('Synthetic: report with a picture (not reviewed)', 'Demo record with a preview image, but no reviewer has looked at it, so the picture stays hidden until a reader chooses to show it.', 'public_health')

appendFileSync('arkiv/evidence.md', `\n## Fourth seed: reports with an embedded preview image (synthetic)\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n`)
console.log('done. evidence appended.')
