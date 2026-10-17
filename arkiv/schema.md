# Arkiv schema — WitNess

Network: Tiramisu testnet, chain ID 7738577. SDK: `@arkiv-network/sdk` 0.8.1.
Every entity carries `project = "witness-reg-ibn26"` so queries never mix with other apps' data.
**All data in this deployment is synthetic.** No real people, places, footage or personal data.

## Wallet roles
| Role | Purpose | Creates |
|---|---|---|
| admin | publishes and revokes the reviewer allowlist | `reviewer` |
| reporter | publishes reports (any wallet may) | `report` |
| reviewer | allowlisted wallet that vouches for reports | `review` |

Addresses are listed in `arkiv/evidence.md`.

## Entity types

### `report`
Creation flags: **`readonly`** (attributes and payload frozen) and **`permissionlessExtension`** (any wallet can extend its life).
Optional "seal": ownership is moved to a burn address in the same batch, so nobody, including the author, can delete it.
| Attribute | Type | Meaning |
|---|---|---|
| project | str | `witness-reg-ibn26` |
| entity_type | str | `report` |
| category | str | e.g. `procurement`, `public_safety`, `environment` |
| region | str | coarse synthetic region code |
| incident_ms | u64 | when the event happened (ms) — range-queryable |
| posted_ms | u64 | when it was posted (ms) |
| sealed | bool | payload is client-side encrypted |
| content_hash | bytes32 | sha-256 of the payload bytes |

Payload (`application/json`, <= 128 KiB): `{v:1, sealed:false, title, body}` or `{v:1, sealed:true, iv, ct}` (AES-GCM, key never leaves the browser; shared in a URL fragment).
Expiration: 30 days, extended by anyone (Lifetime Extension).

### `review`
Created by an allowlisted reviewer wallet. `readonly`. Never patched: a changed opinion is a new review.
| Attribute | Type | Meaning |
|---|---|---|
| project | str | |
| entity_type | str | `review` |
| report_key | key | the report being reviewed |
| verdict | str | `corroborated` / `disputed` / `needs_more` |
| reviewed_ms | u64 | |

Expiration: 90 days (outlives the 30-day report on purpose).
**Trust rule:** the app counts a review only if its `$creator` is on the allowlist. It never trusts `verdict` as proof of anything by itself.

### `reviewer`
Created by the admin wallet, one entity per allowlisted reviewer (no arrays in attributes).
| Attribute | Type | Meaning |
|---|---|---|
| project | str | |
| entity_type | str | `reviewer` |
| reviewer | addr | allowlisted wallet |
| label | str | display name (synthetic) |

Expiration: 180 days. Revoked by the admin deleting the entity. The app reads the list with `createdBy(admin)`.

## Queries the app runs
1. Feed: `project = str(P) AND entity_type = str('report')` + optional `category`, `region`, `incident_ms` range; cursor pagination; client sorts by `incident_ms`.
2. Allowlist: `project AND entity_type = 'reviewer'` + `createdBy(ADMIN)`.
3. Trusted reviews: `project AND entity_type = 'review' AND (report_key = key(K))` and `$creator IN allowlist` (built as `or(eq('$creator', addr(r)))`), plus a client-side re-check.
4. Expiring soon: `... AND $expiresAt < u64(head + 43200)` (about one day).
5. Live: `watchEntityEvents` over a WebSocket transport, no `fromBlock` (created + expiry-extended events).

## What stays off Arkiv on purpose
Decryption keys (in the URL fragment only), any media larger than 128 KiB (a report may reference an external file only by hash), reviewer real identities, and any real personal data.
