# Arkiv schema — WitNess

Network: Tiramisu testnet, chain ID 7738577. SDK: `@arkiv-network/sdk` 0.8.1.
Every entity carries `project = "witness-reg-ibn26"` so queries never mix with other apps' data.
**Demo data is synthetic, or short sample news summaries** (written for this demo, no private individuals named, no news photos) that carry their original source in the payload. No real personal data.

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
| media_hash | bytes32 | optional: sha-256 of an attached photo or video file (the original file is never stored on Arkiv; see `preview` in the payload for the optional small copy) |
| media_type | str | optional: MIME type of that file, e.g. `image/png` |
| media_url | str | optional: https link to where the author hosts the file (up to 128 bytes). Never loaded automatically: a reader can click to load an image, or to play a video (MP4 or WebM) |

Payload (`application/json`, <= 128 KiB): `{v:1, sealed:false, title, body, preview?, source?}` or `{v:1, sealed:true, iv, ct}`. The optional `source` is `{publisher, title, url, published, retrieved}` for a sample news item: only an `https` link is kept and it is shown as a link on the report page; the summary in `body` is our own wording, not the article. The optional `preview` is `{type: image/jpeg|png|webp, b64, w, h}`: a small copy of an attached image (about 60 KB, re-drawn in the browser so location data is dropped), or, for an attached video, one still frame taken in the browser. It is stored with the report; the video itself never is. The Arkiv team confirmed that putting a photo in the payload is allowed. For an encrypted report the preview is inside the ciphertext. The app renders a preview only if it is a plain raster image in plain base64. On the homepage a preview is sharp only once the report is Verified and blurred (and labelled) while it is unverified; on the report page an unverified preview is blurred until the reader clicks, and a disputed report's preview is hidden until asked for and carries a warning (AES-GCM, key never leaves the browser; shared in a URL fragment).
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

### Verification status (computed by the app, not stored)
A report is shown as **Verified** when at least 2 different allowlisted reviewers have corroborated it and none dispute it. Each reviewer's latest verdict stands (reviews are append-only, so a changed opinion is a newer review). **Disputed** if any allowlisted reviewer disputes. **In review** if some allowlisted review exists but fewer than 2 corroborate. **Unverified** otherwise, which is the default for every new report. This is a rule the app applies when it reads the data. Arkiv has no smart contracts, so the chain does not enforce it; anyone can recompute it from the public entities. Tested in `scripts/verify-test.ts`.

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
1. Feed: `project = str(P) AND entity_type = str('report')` + optional `category`, `region`, `incident_ms` range; cursor pagination; client sorts by `posted_ms` (newest posted first).
2. Allowlist: `project AND entity_type = 'reviewer'` + `createdBy(ADMIN)`.
3. Trusted reviews: `project AND entity_type = 'review' AND (report_key = key(K))` and `$creator IN allowlist` (built as `or(eq('$creator', addr(r)))`), plus a client-side re-check.
4. Profile: `project AND entity_type = 'report'` with `createdBy(address)`, newest posted first (client-side sort).
5. Expiring soon: `... AND $expiresAt < u64(head + 43200)` (about one day).
6. Live: `watchEntityEvents` over a WebSocket transport, no `fromBlock` (created + expiry-extended events).

## What stays off Arkiv on purpose
Decryption keys (in the URL fragment only), full-size photo and video files (only their SHA-256 fingerprint is recorded, plus an optional small preview in the payload), reviewer real identities, and any real personal data.
