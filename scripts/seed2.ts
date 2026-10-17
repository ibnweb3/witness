// Second seed (SYNTHETIC data): a second reviewer wallet so "2 different reviewers" can happen, plus a report with a file fingerprint.
// Result: one Verified report (2 reviewers corroborate), one Disputed, one In review (the media report), the rest Unverified.
// Needs no chain queries (only transactions), so it works even while the anonymous query budget is spent.
import { appendFileSync, readFileSync } from 'node:fs'
import { createWalletClient, formatEther, http, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { publicHttp } from '../src/lib/arkiv'
import { balanceOf, wallet } from './lib'
import { createReport, createReview, createReviewer } from '../src/lib/write'
import { sha256Hex } from '../src/lib/crypto'
import { EXPLORER } from '../src/config'

// 1. A second reviewer wallet (key goes in the gitignored .env, never printed).
if (!process.env.REVIEWER2_KEY) {
  const k = generatePrivateKey()
  appendFileSync('.env', `REVIEWER2_KEY=${k}\n`)
  process.env.REVIEWER2_KEY = k
  console.log('generated REVIEWER2_KEY into .env')
}
const admin = wallet('ADMIN_KEY'), reporter = wallet('REPORTER_KEY'), reviewer1 = wallet('REVIEWER_KEY'), reviewer2 = wallet('REVIEWER2_KEY')
const r2 = reviewer2.account!.address
console.log('reviewer2 address:', r2)

// 2. Fund it a little from our own reporter test wallet (testnet GLM between throwaway app wallets).
if ((await balanceOf(r2)) < parseEther('0.1')) {
  const rep = createWalletClient({ chain: tiramisu, transport: http(), account: reporter.account! })
  const hash = await rep.sendTransaction({ to: r2, value: parseEther('0.5') })
  await publicHttp.waitForTransactionReceipt({ hash })
  console.log('funded reviewer2 with 0.5 GLM, tx', hash)
}
console.log('reviewer2 balance:', formatEther(await balanceOf(r2)), 'GLM')

// 3. Keys of the reports from the first seed (read from the evidence file, no queries).
const evidence = readFileSync('arkiv/evidence.md', 'utf8')
const keyOf = (label: string) => {
  const m = new RegExp(`\\| ${label.replace(/[()]/g, '\\$&')} \\| \`(0x[0-9a-f]{64})\``).exec(evidence)
  if (!m) throw new Error('missing in evidence.md: ' + label)
  return m[1] as `0x${string}`
}
const procurement = keyOf('report (procurement)'), publicSafety = keyOf('report (public_safety)')

const rows: string[] = []
const row = (what: string, key: string, tx: string) => rows.push(`| ${what} | \`${key}\` | [${tx.slice(0, 10)}…](${EXPLORER}/tx/${tx}) |`)

const rv = await createReviewer(admin, r2, 'Synthetic Reviewer B')
row('reviewer allowlist entry (B)', rv.entityKey, rv.txHash)

const a = await createReview(reviewer2, procurement, 'corroborated', 'Synthetic second reviewer agrees: record is consistent.')
row('trusted review B: corroborated (procurement) → Verified', a.entityKey, a.txHash)
const b = await createReview(reviewer2, publicSafety, 'disputed', 'Synthetic: reviewer B disputes this log.')
row('trusted review B: disputed (public_safety) → Disputed', b.entityKey, b.txHash)

// 4. A report with a file fingerprint. The file itself is only on the site as a downloadable sample.
const img = new Uint8Array(readFileSync('public/demo/synthetic-image.png')) as Uint8Array<ArrayBuffer>
const hash = await sha256Hex(img)
const media = await createReport(reporter, {
  category: 'environment', region: 'zone-south', incidentMs: Date.now() - 86_400_000, sealed: false,
  payload: { v: 1, sealed: false, title: 'Synthetic: sample photo with a fingerprint', body: 'Demo record for the file check. Download the sample image from this site and check it against this report, then try the tampered copy (one pixel changed) and see the mismatch.' },
  media: { hash, type: 'image/png', url: 'https://witness.ibnweb3lab.workers.dev/demo/synthetic-image.png' },
})
row('report with media fingerprint (sha256 ' + hash.slice(0, 10) + '…)', media.entityKey, media.txHash)
const c = await createReview(reviewer1, media.entityKey, 'corroborated', 'Synthetic: reviewer A corroborates the media record.')
row('trusted review A: corroborated (media) → In review', c.entityKey, c.txHash)

appendFileSync('arkiv/evidence.md',
  `\n## Second seed: second reviewer and a file fingerprint (synthetic)\n\n| Role | Address |\n|---|---|\n| reviewer B | ${r2} |\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n\nSample files on the site: /demo/synthetic-image.png (matches the media report) and /demo/synthetic-image-tampered.png (one pixel changed, does not match).\n`)
console.log('done. evidence appended.')
