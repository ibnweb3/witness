// Public configuration. Nothing secret lives here.
export const PROJECT = 'witness-reg-ibn26'
// Admin wallet that publishes the reviewer allowlist (public address).
export const ADMIN = '0xF86D262905d8C54E19e24734959976f0d1108B32' as const
// Ownership of a "sealed" report is moved here so nobody can delete it.
export const BURN = '0x000000000000000000000000000000000000dEaD' as const
export const REPORT_DAYS = 30
export const REVIEW_DAYS = 90
export const REVIEWER_DAYS = 180
export const BLOCKS_PER_DAY = 43_200n // 2 s blocks
export const EXPLORER = 'https://tiramisu.explorer.arkiv.network'
