// The council rule that turns allowlisted reviews into a status. Pure and chain-agnostic so it can be tested.
// Only reviews whose on-chain creator is on the allowlist count. Reviews are append-only, so each reviewer's
// LATEST verdict stands (a changed opinion is a newer review).
export type Status = 'verified' | 'disputed' | 'in_review' | 'unverified'
export type ReviewLite = { creator: string; verdict: string; at: number }

export const THRESHOLD = 2 // distinct allowlisted reviewers who must corroborate

export function statusFor(reviews: ReviewLite[], allow: Set<string>, threshold = THRESHOLD) {
  const latest = new Map<string, ReviewLite>()
  for (const r of reviews) {
    const who = r.creator.toLowerCase()
    if (!allow.has(who)) continue
    const prev = latest.get(who)
    if (!prev || r.at >= prev.at) latest.set(who, r)
  }
  let corroborated = 0, disputed = 0
  for (const r of latest.values()) {
    if (r.verdict === 'corroborated') corroborated++
    else if (r.verdict === 'disputed') disputed++
  }
  const reviewers = latest.size
  const status: Status = disputed > 0 ? 'disputed' : corroborated >= threshold ? 'verified' : reviewers > 0 ? 'in_review' : 'unverified'
  return { status, corroborated, disputed, reviewers, threshold }
}

export const STATUS_TEXT: Record<Status, string> = { verified: 'Verified', disputed: 'Disputed', in_review: 'In review', unverified: 'Unverified' }
export const STATUS_CLASS: Record<Status, string> = { verified: 'ok', disputed: 'bad', in_review: 'warn', unverified: '' }
export const STATUS_EXPLAIN: Record<Status, string> = {
  verified: 'At least 2 different allowlisted reviewers corroborate this report and none dispute it.',
  disputed: 'At least one allowlisted reviewer disputes this report.',
  in_review: 'Some allowlisted review exists, but fewer than 2 reviewers corroborate it so far.',
  unverified: 'No allowlisted reviewer has looked at this report yet. Treat it as a claim, not a finding.',
}
