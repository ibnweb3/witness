// Fifth seed (SYNTHETIC): a report about a short test video. Arkiv stores only the video's SHA-256 fingerprint, a link to where it is hosted,
// and one still frame from it as the preview picture. Both reviewers corroborate it, so it is Verified and its still frame shows on the homepage card.
// The video is a generated test pattern (colour bars with a timecode): no people, no places.
import { appendFileSync, readFileSync } from 'node:fs'
import { wallet } from './lib'
import { createReport, createReview } from '../src/lib/write'
import { sha256Hex } from '../src/lib/crypto'
import { EXPLORER } from '../src/config'

const video = new Uint8Array(readFileSync('public/demo/synthetic-video.webm')) as Uint8Array<ArrayBuffer>
const frame = readFileSync('public/demo/synthetic-video-poster.jpg')
const hash = await sha256Hex(video)
console.log('video', video.length, 'bytes, fingerprint', hash.slice(0, 14) + '…; still frame', frame.length, 'bytes')

const reporter = wallet('REPORTER_KEY'), a = wallet('REVIEWER_KEY'), b = wallet('REVIEWER2_KEY')
const rows: string[] = []
const row = (what: string, key: string, tx: string) => rows.push(`| ${what} | \`${key}\` | [${tx.slice(0, 10)}…](${EXPLORER}/tx/${tx}) |`)

const r = await createReport(reporter, {
  category: 'public_safety', region: 'zone-east', incidentMs: Date.now() - 86_400_000, sealed: false,
  payload: { v: 1, sealed: false, title: 'Synthetic: video report (verified)', body: 'Demo record about a short test video. Arkiv stores only the video\'s fingerprint, a link to where it is hosted, and one still frame from it. Use "Load the video" on this page to play it from the link, and check it against the fingerprint.', preview: { type: 'image/jpeg', b64: frame.toString('base64'), w: 320, h: 200 } },
  media: { hash, type: 'video/webm', url: 'https://witness.ibnweb3lab.workers.dev/demo/synthetic-video.webm' },
})
row('report with a video fingerprint, link and still frame', r.entityKey, r.txHash)
for (const [w, note] of [[a, 'Synthetic: reviewer A corroborates the video report.'], [b, 'Synthetic: reviewer B corroborates the video report.']] as const) {
  const rv = await createReview(w, r.entityKey as `0x${string}`, 'corroborated', note)
  row('review: corroborated → Verified', rv.entityKey, rv.txHash)
}
appendFileSync('arkiv/evidence.md', `\n## Fifth seed: a video report (synthetic)\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n\nSample files on the site: /demo/synthetic-video.webm (4 s test pattern, matches the recorded fingerprint) and /demo/synthetic-video-poster.jpg (the still frame stored in the report).\n`)
console.log('done. evidence appended. key', r.entityKey)
