// Seeds SYNTHETIC data on Tiramisu: allowlist, reports (plain, sealed, locked), trusted reviews, and one forged review.
import { appendFileSync, writeFileSync } from 'node:fs'
import { formatEther } from 'viem'
import { balanceOf, wallet } from './lib'
import { createReport, createReview, createReviewer } from '../src/lib/write'
import { newKey, seal } from '../src/lib/crypto'
import { EXPLORER } from '../src/config'

const admin = wallet('ADMIN_KEY'), reporter = wallet('REPORTER_KEY'), reviewer = wallet('REVIEWER_KEY')
for (const [n, w] of [['admin', admin], ['reporter', reporter], ['reviewer', reviewer]] as const) {
  const b = await balanceOf(w.account!.address)
  if (b === 0n) throw new Error(`${n} ${w.account!.address} has 0 GLM — fund it first`)
  console.log(n, formatEther(b), 'GLM')
}
const log: string[] = ['# On-chain evidence (Tiramisu)\n', `Generated ${new Date().toISOString()}. All data synthetic.\n`,
  '| Role | Address |\n|---|---|', `| admin | ${admin.account!.address} |`, `| reporter | ${reporter.account!.address} |`, `| reviewer | ${reviewer.account!.address} |\n`,
  '| What | Entity key | Tx |\n|---|---|---|']
const row = (what: string, key: string, tx: string) => log.push(`| ${what} | \`${key}\` | [${tx.slice(0, 10)}…](${EXPLORER}/tx/${tx}) |`)
const day = 86_400_000, now = Date.now()

const rv = await createReviewer(admin, reviewer.account!.address, 'Synthetic Reviewer A')
row('reviewer allowlist entry', rv.entityKey, rv.txHash)

const specs = [
  { category: 'procurement', region: 'zone-north', ago: 3, title: 'Synthetic: inflated contract notice', body: 'Demo record. A made-up contract notice lists a unit price far above the published market range.' },
  { category: 'public_safety', region: 'zone-east', ago: 6, title: 'Synthetic: road closure log', body: 'Demo record. A made-up log of road closures with timestamps from three imaginary observers.' },
  { category: 'environment', region: 'zone-south', ago: 10, title: 'Synthetic: river sampling note', body: 'Demo record. A made-up water sampling note with fictional readings.' },
]
const keys: `0x${string}`[] = []
for (const s of specs) {
  const r = await createReport(reporter, { category: s.category, region: s.region, incidentMs: now - s.ago * day, sealed: false, payload: { v: 1, sealed: false, title: s.title, body: s.body } })
  keys.push(r.entityKey); row(`report (${s.category})`, r.entityKey, r.txHash)
}
// Sealed (encrypted) report: the demo key is printed so judges can open it.
const { key, keyText } = await newKey()
const sealedPayload = await seal({ title: 'Synthetic: sealed field report', body: 'Demo record, decrypted in the browser only. Fictional content.' }, key)
const sr = await createReport(reporter, { category: 'public_safety', region: 'zone-west', incidentMs: now - 2 * day, sealed: true, payload: sealedPayload })
row('report (SEALED, encrypted)', sr.entityKey, sr.txHash)
// Locked report: ownership moved to the burn address in the same batch.
const lr = await createReport(reporter, { category: 'procurement', region: 'zone-north', incidentMs: now - 1 * day, sealed: false, lock: true, payload: { v: 1, sealed: false, title: 'Synthetic: locked record (undeletable)', body: 'Demo record whose owner is the burn address, so not even its author can delete it.' } })
keys.push(lr.entityKey); row('report (LOCKED, owner = burn)', lr.entityKey, lr.txHash)

const a = await createReview(reviewer, keys[0], 'corroborated', 'Synthetic review by an allowlisted wallet.')
row('trusted review (allowlisted)', a.entityKey, a.txHash)
const b = await createReview(reviewer, keys[1], 'needs_more', 'Synthetic: needs another observer.')
row('trusted review (allowlisted)', b.entityKey, b.txHash)
// Attacker: same project attribute, not on the allowlist. The app must ignore it.
const f = await createReview(reporter, keys[2], 'corroborated', 'FORGED: not an allowlisted creator.')
row('FORGED review (not allowlisted)', f.entityKey, f.txHash)

writeFileSync('arkiv/evidence.md', log.join('\n') + '\n')
appendFileSync('arkiv/evidence.md', `\nDemo decryption key for the sealed report (synthetic): \`${keyText}\`\nSealed report key: \`${sr.entityKey}\`\n`)
console.log('done. evidence written to arkiv/evidence.md')
