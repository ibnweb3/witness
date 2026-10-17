// Fires at the exact second a new anonymous query-budget window opens, measures what queries cost,
// then checks the seeded data through the SAME functions the app uses. Everything is logged with timestamps.
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { str } from '@arkiv-network/sdk/attr'
import { eq } from '@arkiv-network/sdk/query'
import { http } from 'viem'
import { PROJECT } from '../src/config'
import { listAllowlist, listReports, listReportsBy, listTrustedReviews, reviewsFor } from '../src/lib/arkiv'
import { statusFor, type ReviewLite } from '../src/lib/verify'

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a)
let hdr = ''
const c = createPublicClient({ chain: tiramisu, transport: http(undefined, { retryCount: 0, onFetchResponse: r => { hdr = r.headers.get('ratelimit') ?? '' } }) })
const rem = () => Number(/remaining=(\d+)/.exec(hdr)?.[1] ?? NaN)
const resetS = () => Number(/reset=(\d+)/.exec(hdr)?.[1] ?? NaN)
const base = [eq('project', str(PROJECT)), eq('entity_type', str('report'))]
const probe = () => c.select({ key: true }).where(...base).limit(1).fetch()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 1. learn when the window ends, sleep until then, then hammer gently until a query succeeds.
try { await probe(); log('budget already available:', hdr) } catch { /* expected */ }
if (!Number.isNaN(resetS()) && resetS() > 2 && resetS() < 3700) {
  log('window ends in', resetS(), 's; sleeping until then')
  await sleep((resetS() - 1) * 1000)
}
for (let i = 0; ; i++) {
  try { await probe(); log('GOT BUDGET after', i, 'tries:', hdr); break } catch { await sleep(400) }
  if (i > 400) { log('gave up'); process.exit(1) }
}

// 2. cost model: remaining before/after for queries of growing size (stop early if the pool runs dry).
const step = async (name: string, f: () => Promise<{ entities: readonly unknown[] }>) => {
  const before = rem()
  try { const r = await f(); log(name.padEnd(36), 'cost', before - rem(), '| remaining', rem(), '|', r.entities.length, 'entities') } catch (e: any) { log(name.padEnd(36), 'FAILED', (e.details ?? e.shortMessage ?? e.message).toString().slice(0, 40), '| ratelimit', hdr); return false }
  return true
}
const q = (sel: any, limit: number) => () => c.select(sel).where(...base).limit(limit).fetch()
const plan: [string, () => Promise<any>][] = [
  ['key only, limit 5', q({ key: true }, 5)],
  ['key only, limit 50', q({ key: true }, 50)],
  ['key only, limit 200', q({ key: true }, 200)],
  ['attributes, limit 20', q({ key: true, attributes: true }, 20)],
  ['attributes+payload, limit 20', q({ key: true, attributes: true, payload: true }, 20)],
  ['attributes+payload, limit 200', q({ key: true, attributes: true, payload: true }, 200)],
]
for (const [n, f] of plan) if (!(await step(n, f))) break

// 3. the real app functions on the real data.
log('--- app functions on real data ---')
try {
  const allow = (await listAllowlist()).map(a => a.toLowerCase())
  log('allowlist:', allow.length, 'reviewers', allow.map(a => a.slice(0, 8)).join(' '))
  const reports = await listReports()
  const trusted = await listTrustedReviews(allow)
  log('reports:', reports.length, '| trusted reviews:', trusted.length)
  const by = new Map<string, ReviewLite[]>()
  for (const r of trusted) {
    const k = String((r.attributes as any).report_key.value)
    by.set(k, [...(by.get(k) ?? []), { creator: r.creator as string, verdict: String((r.attributes as any).verdict.value), at: Number((r.attributes as any).reviewed_ms.value) }])
  }
  for (const r of reports) {
    const a = r.attributes as any
    const st = statusFor(by.get(r.key as string) ?? [], new Set(allow))
    const p: any = (r as any).toJson()
    log(String(a.category.value).padEnd(14), (a.sealed.value ? 'SEALED' : String(p.title)).slice(0, 42).padEnd(42), '| owner', (r.owner as string).slice(0, 8), '| media', a.media_hash ? 'yes' : 'no', '| ->', st.status.toUpperCase(), `(${st.corroborated}c/${st.disputed}d)`)
  }
  // the forged review: created by the reporter wallet on the environment report
  const env = reports.find(r => (r.attributes as any).category.value === 'environment' && !(r.attributes as any).sealed.value && !(r.attributes as any).media_hash)
  if (env) {
    const all = await reviewsFor(env.key as `0x${string}`)
    for (const r of all) log('review on environment report: creator', (r.creator as string).slice(0, 8), 'allowlisted?', allow.includes((r.creator as string).toLowerCase()), '| verdict', (r.attributes as any).verdict.value)
  }
  const rep = reports[0] ? (reports[0].creator as string) : ''
  if (rep) log('profile query for', rep.slice(0, 8), '->', (await listReportsBy(rep)).length, 'reports')
} catch (e: any) { log('app check FAILED:', (e.details ?? e.shortMessage ?? e.message).toString().slice(0, 80)) }
log('done')
process.exit(0)
