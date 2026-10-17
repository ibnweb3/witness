import { ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { addr, bool, bytes32, key as keyAttr, str, u64 } from '@arkiv-network/sdk/attr'
import { BURN, PROJECT, REPORT_DAYS, REVIEWER_DAYS, REVIEW_DAYS } from '../config'
import { sha256Hex } from './crypto'
import { publicHttp } from './arkiv'

// Structural type so it works with the SDK wallet client in Node and in the browser.
type Wallet = Awaited<ReturnType<typeof import('@arkiv-network/sdk').createWalletClient>>

export type NewReport = {
  category: string; region: string; incidentMs: number
  payload: Record<string, unknown> // already sealed, or plaintext {v,sealed:false,title,body}
  sealed: boolean
  lock?: boolean // move ownership to the burn address so nobody (even the author) can delete it
  // Optional photo/video: only its SHA-256 fingerprint (and an optional author-supplied link) goes on Arkiv, never the file.
  media?: { hash: `0x${string}`; type: string; url?: string }
}

export async function createReport(w: Wallet, r: NewReport) {
  const bytes = jsonToPayload(r.payload) as Uint8Array<ArrayBuffer>
  const params = {
    payload: bytes,
    contentType: 'application/json' as const,
    attributes: {
      project: str(PROJECT), entity_type: str('report'),
      category: str(r.category), region: str(r.region),
      incident_ms: u64(r.incidentMs), posted_ms: u64(Date.now()),
      sealed: bool(r.sealed), content_hash: bytes32(await sha256Hex(bytes)),
      ...(r.media ? { media_hash: bytes32(r.media.hash), media_type: str(r.media.type), ...(r.media.url ? { media_url: str(r.media.url) } : {}) } : {}),
    },
    expires: ExpirationTime.fromDays(REPORT_DAYS),
    flags: { readonly: true, permissionlessExtension: true },
  }
  if (!r.lock) return w.createEntity(params)
  // Lock = create + transfer to burn in ONE atomic batch, using a predicted key + salt.
  const [pred] = await publicHttp.predictEntityKeys({ owner: w.account!.address, count: 1 })
  const res = await w.executeBatch({
    creates: [{ ...params, salt: pred.salt }],
    ownershipChanges: [{ entityKey: pred.key, newOwner: BURN }],
  })
  return { entityKey: res.createdEntities[0], txHash: res.txHash }
}

export const createReview = (w: Wallet, reportKey: `0x${string}`, verdict: 'corroborated' | 'disputed' | 'needs_more', note: string) =>
  w.createEntity({
    payload: jsonToPayload({ v: 1, note }),
    contentType: 'application/json',
    attributes: { project: str(PROJECT), entity_type: str('review'), report_key: keyAttr(reportKey), verdict: str(verdict), reviewed_ms: u64(Date.now()) },
    expires: ExpirationTime.fromDays(REVIEW_DAYS),
    flags: { readonly: true },
  })

export const createReviewer = (w: Wallet, reviewer: `0x${string}`, label: string) =>
  w.createEntity({
    payload: jsonToPayload({ v: 1, label }),
    contentType: 'application/json',
    attributes: { project: str(PROJECT), entity_type: str('reviewer'), reviewer: addr(reviewer), label: str(label) },
    expires: ExpirationTime.fromDays(REVIEWER_DAYS),
  })

/** Any wallet may call this on a report (permissionlessExtension). Sets a NEW expiry counted from now. */
export const extendReport = (w: Wallet, entityKey: `0x${string}`, days = REPORT_DAYS) =>
  w.extendEntity({ entityKey, expires: ExpirationTime.fromDays(days) })
