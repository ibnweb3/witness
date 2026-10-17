import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { addr, key as keyAttr, str, u64 } from '@arkiv-network/sdk/attr'
import { and, eq, gte, lte, lt, or } from '@arkiv-network/sdk/query'
import { http, webSocket } from 'viem'
import { ADMIN, BLOCKS_PER_DAY, PROJECT } from '../config'

// Optional Arkiv access key, as a full RPC URL: https://rpc.tiramisu.db-chain.testnet.arkiv.network/<key>.
// A key has its own monthly quota, unlike the shared anonymous budget. In the browser it comes from VITE_ARKIV_RPC at
// build time (so it is visible in the page's network requests: use a key restricted to this site's origin);
// in Node scripts it comes from ARKIV_RPC_URL.
const KEYED_URL: string | undefined =
  import.meta.env?.VITE_ARKIV_RPC || (typeof process !== 'undefined' ? process.env?.ARKIV_RPC_URL : undefined) || undefined

// retryCount 1: the public RPC answers 429 immediately when a budget is spent,
// and viem's default of 3 retries with backoff only makes the page hang.
const anon = createPublicClient({ chain: tiramisu, transport: http(undefined, { retryCount: 1 }) })
const keyed = KEYED_URL ? createPublicClient({ chain: tiramisu, transport: http(KEYED_URL, { retryCount: 1 }) }) : undefined
/** The client every read goes through: the keyed one when configured, otherwise the anonymous public RPC. */
export const publicHttp = (keyed ?? anon) as typeof anon
// WebSocket client for live events (no fromBlock, so it is a push subscription).
let ws: ReturnType<typeof createPublicClient> | undefined
export const publicWs = () => (ws ??= createPublicClient({ chain: tiramisu, transport: webSocket() }))

export function clientFor(rpcUrl: string) {
  return createPublicClient({ chain: tiramisu, transport: http(rpcUrl, { retryCount: 1 }) })
}

// If a keyed client is the primary, the anonymous public RPC is the backup (and the other way round is not needed).
const fallback = keyed ? anon : undefined

/** True when the RPC refused because of rate limits or the anonymous query budget. */
export const isBudgetError = (e: any) =>
  /429|ANON_COST_LIMITED|budget exhausted|too many requests/i.test([e?.message, e?.details, e?.shortMessage, e?.status].filter(Boolean).join(' '))

export const rpcMessage = (e: any) =>
  isBudgetError(e)
    ? 'The public Arkiv network is rate-limiting anonymous queries right now (a free query budget that resets about every hour). Please try again in a few minutes.'
    : 'Could not reach the network: ' + (e?.shortMessage ?? e?.message ?? e)

async function viaRpc<T>(f: (c: typeof publicHttp) => Promise<T>): Promise<T> {
  try { return await f(publicHttp) } catch (e) {
    if (fallback && isBudgetError(e)) return f(fallback as typeof publicHttp)
    throw e
  }
}

const base = (type: string) => [eq('project', str(PROJECT)), eq('entity_type', str(type))]
const FIELDS = { key: true, creator: true, owner: true, createdAt: true, expiresAt: true, creationFlags: true, attributes: true, payload: true } as const

export type Entity = Awaited<ReturnType<typeof firstPage>>['entities'][number]
const firstPage = () => publicHttp.select(FIELDS).where(...base('report')).limit(1).fetch()

export type ReportFilter = { category?: string; region?: string; fromMs?: number; toMs?: number }

export const getHead = () => viaRpc(c => c.getBlockNumber())
export const getReport = (key: `0x${string}`) => viaRpc(c => c.getEntity(key))

export async function listAllowlist(): Promise<string[]> {
  const page = await viaRpc(c => c.select({ attributes: true }).where(...base('reviewer')).createdBy(ADMIN).limit(200).fetch())
  return page.entities.flatMap(e => (e.attributes.reviewer?.type === 'addr' ? [e.attributes.reviewer.value as string] : []))
}

export async function listReports(f: ReportFilter = {}, max = 200) {
  const preds = [...base('report')]
  if (f.category) preds.push(eq('category', str(f.category)))
  if (f.region) preds.push(eq('region', str(f.region)))
  if (f.fromMs !== undefined) preds.push(gte('incident_ms', u64(f.fromMs)))
  if (f.toMs !== undefined) preds.push(lte('incident_ms', u64(f.toMs)))
  const out: Entity[] = await viaRpc(async c => {
    const acc: Entity[] = []
    for await (const e of c.select(FIELDS).where(and(preds)).limit(200)) {
      acc.push(e)
      if (acc.length >= max) break
    }
    return acc
  })
  const ms = (e: Entity) => { const a = e.attributes.incident_ms; return a?.type === 'u64' ? Number(a.value) : 0 }
  return out.sort((a, b) => ms(b) - ms(a)) // node returns newest-created first; sort by incident date client-side
}

/** Reviews whose on-chain creator is on the allowlist. A review from anyone else is never returned. */
export async function listTrustedReviews(allowlist: string[]) {
  if (!allowlist.length) return []
  const creators = or(allowlist.map(a => eq('$creator', addr(a as `0x${string}`))))
  const page = await viaRpc(c => c.select({ key: true, creator: true, attributes: true, createdAt: true }).where(...base('review')).where(creators).limit(200).fetch())
  const ok = new Set(allowlist.map(a => a.toLowerCase()))
  return page.entities.filter(e => ok.has((e.creator as string).toLowerCase())) // client-side re-check
}

/** Every review pointing at a report, whoever created it. The caller splits trusted vs ignored by allowlist. */
export async function reviewsFor(reportKey: `0x${string}`) {
  const page = await viaRpc(c => c.select({ key: true, creator: true, attributes: true, payload: true }).where(...base('review'), eq('report_key', keyAttr(reportKey))).limit(200).fetch())
  return page.entities
}

export async function expiringSoon(maxReports = 200) {
  const head = await getHead()
  const page = await viaRpc(c => c.select({ key: true, expiresAt: true }).where(...base('report')).where(lt('$expiresAt', u64(head + BLOCKS_PER_DAY))).limit(maxReports).fetch())
  return { head, entities: page.entities }
}

/** Keys of all our reports (one cheap query). Used to detect new posts without a request per chain event. */
export async function reportKeys(): Promise<string[]> {
  const page = await viaRpc(c => c.select({ key: true }).where(...base('report')).limit(200).fetch())
  return page.entities.map(e => e.key as string)
}

export function watchFeed(h: { onAny?: (blockNumber: bigint) => void; onCreated?: (key: `0x${string}`) => void; onExtended?: (key: `0x${string}`, expiresAt: bigint) => void; onError?: (e: Error) => void }) {
  return publicWs().watchEntityEvents({
    onEvent: ev => h.onAny?.(ev.blockNumber),
    onEntityCreated: ev => h.onCreated?.(ev.entityKey),
    onExpiryExtended: ev => h.onExtended?.(ev.entityKey, ev.expiresAt),
    onError: h.onError,
  })
}

/** Every report created by one wallet (a profile is just a `$creator` filter). Newest posted first. */
export async function listReportsBy(address: string, max = 200) {
  const out: Entity[] = await viaRpc(async c => {
    const acc: Entity[] = []
    for await (const e of c.select(FIELDS).where(...base('report')).createdBy(address as `0x${string}`).limit(200)) {
      acc.push(e)
      if (acc.length >= max) break
    }
    return acc
  })
  const posted = (e: Entity) => { const a = e.attributes.posted_ms; return a?.type === 'u64' ? Number(a.value) : 0 }
  return out.sort((a, b) => posted(b) - posted(a))
}
