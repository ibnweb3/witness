// Reads the seeded data through the SAME functions the app uses and prints what the UI will show.
// Uses ARKIV_RPC_URL (an Arkiv access key) automatically when set. Never prints the key.
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { http } from 'viem'
import { BURN } from '../src/config'
import { getHead, listAllowlist, listReports, listReportsBy, listTrustedReviews, reviewsFor } from '../src/lib/arkiv'
import { statusFor, type ReviewLite } from '../src/lib/verify'
import { sha256Hex } from '../src/lib/crypto'
import { readFileSync } from 'node:fs'

const log = (...a: unknown[]) => console.log(...a)
const t0 = Date.now()
const url = process.env.ARKIV_RPC_URL
log('RPC mode:', url ? 'access key' : 'anonymous public')

// one raw call so we can see how this RPC reports usage (header names and ratelimit values only)
if (url) {
  let seen: Record<string, string> = {}
  const c = createPublicClient({ chain: tiramisu, transport: http(url, { retryCount: 0, onFetchResponse: r => { seen = Object.fromEntries([...r.headers.entries()].filter(([k]) => /rate|limit|quota|cost|usage|retry/i.test(k))) } }) })
  await c.getBlockNumber()
  log('headers on a plain call:', JSON.stringify(seen))
}

log('head block:', String(await getHead()))
const allow = (await listAllowlist()).map(a => a.toLowerCase())
log('allowlist:', allow.length, 'reviewers:', allow.map(a => a.slice(0, 8)).join(' '))
const reports = await listReports()
const trusted = await listTrustedReviews(allow)
log('reports:', reports.length, '| trusted reviews:', trusted.length)

const by = new Map<string, ReviewLite[]>()
for (const r of trusted) {
  const a = r.attributes as any
  const k = String(a.report_key.value)
  by.set(k, [...(by.get(k) ?? []), { creator: r.creator as string, verdict: String(a.verdict.value), at: Number(a.reviewed_ms.value) }])
}
log('\nWhat the feed will show:')
for (const r of reports) {
  const a = r.attributes as any
  const st = statusFor(by.get(r.key as string) ?? [], new Set(allow))
  const p: any = (r as any).toJson()
  const locked = (r.owner as string).toLowerCase() === BURN.toLowerCase()
  log(' ', String(a.category.value).padEnd(14), (a.sealed.value ? 'SEALED (encrypted)' : String(p.title)).slice(0, 46).padEnd(46), st.status.toUpperCase().padEnd(10), `${st.corroborated}c/${st.disputed}d`, locked ? '| LOCKED (owner = burn)' : '', a.media_hash ? '| has media fingerprint' : '')
}

// the forged review: the reporter wallet reviewed the environment report but is not on the allowlist
const env = reports.find(r => (r.attributes as any).category.value === 'environment' && !(r.attributes as any).sealed.value && !(r.attributes as any).media_hash)
if (env) {
  log('\nReviews on the environment report (forged one expected to be ignored):')
  for (const r of await reviewsFor(env.key as `0x${string}`)) {
    const who = (r.creator as string).toLowerCase()
    log('  creator', (r.creator as string).slice(0, 10), '| verdict', (r.attributes as any).verdict.value, '| allowlisted:', allow.includes(who), allow.includes(who) ? '' : '=> IGNORED by the app')
  }
}

// the media fingerprint must match the sample file that is deployed with the site
const media = reports.find(r => (r.attributes as any).media_hash)
if (media) {
  const recorded = String((media.attributes as any).media_hash.value).toLowerCase()
  const local = await sha256Hex(new Uint8Array(readFileSync('public/demo/synthetic-image.png')) as Uint8Array<ArrayBuffer>)
  const tampered = await sha256Hex(new Uint8Array(readFileSync('public/demo/synthetic-image-tampered.png')) as Uint8Array<ArrayBuffer>)
  log('\nMedia fingerprint on-chain', recorded.slice(0, 14) + '…', '| sample matches:', local.toLowerCase() === recorded, '| tampered matches:', tampered.toLowerCase() === recorded)
}

// sealed report: decrypt with the demo key from evidence.md
const sealed = reports.find(r => (r.attributes as any).sealed.value)
const keyText = /Demo decryption key[^`]*`([^`]+)`/.exec(readFileSync('arkiv/evidence.md', 'utf8'))?.[1]
if (sealed && keyText) {
  const { importKey, open } = await import('../src/lib/crypto')
  const dec = await open((sealed as any).toJson(), await importKey(keyText))
  log('\nSealed report decrypts with the demo key to title:', JSON.stringify(dec.title))
}

const owner = reports[0] ? (reports[0].creator as string) : ''
if (owner) log('\nProfile query for', owner.slice(0, 10), '->', (await listReportsBy(owner)).length, 'reports')
log('\nall reads finished in', Date.now() - t0, 'ms')
