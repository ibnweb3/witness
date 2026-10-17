import assert from 'node:assert/strict'
import { statusFor, type ReviewLite } from '../src/lib/verify'

const A = '0xAaaa000000000000000000000000000000000001', B = '0xBbbb000000000000000000000000000000000002', X = '0xDead000000000000000000000000000000000003'
const allow = new Set([A.toLowerCase(), B.toLowerCase()])
const r = (creator: string, verdict: string, at: number): ReviewLite => ({ creator, verdict, at })

assert.equal(statusFor([], allow).status, 'unverified')
assert.equal(statusFor([r(X, 'corroborated', 1), r(X, 'corroborated', 2)], allow).status, 'unverified', 'non-allowlisted reviews never count')
assert.equal(statusFor([r(A, 'corroborated', 1)], allow).status, 'in_review')
assert.equal(statusFor([r(A, 'corroborated', 1), r(A, 'corroborated', 2)], allow).status, 'in_review', 'one reviewer twice is still one reviewer')
assert.equal(statusFor([r(A, 'corroborated', 1), r(B, 'corroborated', 2)], allow).status, 'verified')
assert.equal(statusFor([r(A, 'corroborated', 1), r(B, 'corroborated', 2), r(X, 'disputed', 3)], allow).status, 'verified', 'a forged dispute from outside the allowlist is ignored')
assert.equal(statusFor([r(A, 'corroborated', 1), r(B, 'disputed', 2)], allow).status, 'disputed')
assert.equal(statusFor([r(A, 'corroborated', 1), r(B, 'disputed', 2), r(B, 'corroborated', 3)], allow).status, 'verified', 'latest verdict per reviewer stands')
assert.equal(statusFor([r(A, 'disputed', 1), r(A, 'needs_more', 2)], allow).status, 'in_review', 'a retracted dispute no longer blocks')
assert.equal(statusFor([r(A.toUpperCase().replace('0X', '0x'), 'corroborated', 1), r(B, 'corroborated', 2)], allow).status, 'verified', 'address case does not matter')
console.log('verify rule: all assertions passed')
