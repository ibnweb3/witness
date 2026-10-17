// Measures the anonymous query-budget cost of each query the app runs.
// The public RPC answers arkiv_query with a `ratelimit: limit=…, remaining=…, reset=…` header; cost = drop in `remaining`.
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { addr, key as keyAttr, str } from '@arkiv-network/sdk/attr'
import { eq, or } from '@arkiv-network/sdk/query'
import { http } from 'viem'
import { ADMIN, PROJECT } from '../src/config'

let last = ''
const c = createPublicClient({ chain: tiramisu, transport: http(undefined, { retryCount: 0, onFetchResponse: r => { last = r.headers.get('ratelimit') ?? '' } }) })
const remaining = () => Number(/remaining=(\d+)/.exec(last)?.[1] ?? NaN)
const base = (t: string) => [eq('project', str(PROJECT)), eq('entity_type', str(t))]
const FIELDS = { key: true, creator: true, owner: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true, payload: true } as const

// wait until the budget is back
for (;;) {
  try { await c.select({ key: true }).where(...base('report')).limit(1).fetch(); break } catch (e: any) {
    console.log(new Date().toISOString().slice(11, 19), 'still limited:', last || e.shortMessage)
    await new Promise(r => setTimeout(r, 30_000))
  }
}
console.log('budget available:', last)
const step = async (name: string, f: () => Promise<unknown>) => {
  const before = remaining(); const t0 = Date.now(); const res: any = await f(); const after = remaining()
  console.log(name.padEnd(34), 'cost', before - after, '| remaining', after, '|', res?.entities ? res.entities.length + ' entities' : '', Date.now() - t0, 'ms')
  return res
}
const reports = await step('feed (all fields incl payload)', () => c.select(FIELDS).where(...base('report')).limit(200).fetch())
const key = reports.entities[0]?.key
await step('allowlist (createdBy admin)', () => c.select({ attributes: true }).where(...base('reviewer')).createdBy(ADMIN).limit(200).fetch())
const allow = (await c.select({ attributes: true }).where(...base('reviewer')).createdBy(ADMIN).limit(200).fetch()).entities.map(e => e.attributes.reviewer?.value as `0x${string}`)
await step('trusted reviews ($creator in list)', () => c.select({ key: true, creator: true, attributes: true, createdAt: true }).where(...base('review')).where(or(allow.map(a => eq('$creator', addr(a))))).limit(200).fetch())
await step('reviews for one report (+payload)', () => c.select({ key: true, creator: true, attributes: true, payload: true }).where(...base('review'), eq('report_key', keyAttr(key))).limit(200).fetch())
await step('report keys only', () => c.select({ key: true }).where(...base('report')).limit(200).fetch())
await step('getEntity (one report)', () => c.getEntity(key))
console.log('done')
process.exit(0)
