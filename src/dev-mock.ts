// DEV ONLY (loaded via `import.meta.env.DEV` and `?mock`): fake entities to check layout before the wallets are funded.
// Never shipped: the dynamic import is dead code in production builds.
import type { Entity } from './lib/arkiv'

const cats = ['procurement', 'public_safety', 'environment', 'public_health', 'other']
const titles = ['Synthetic: inflated contract notice', 'Synthetic: road closure log', 'Synthetic: river sampling note', 'Synthetic: clinic stock count', 'Synthetic: tender timeline mismatch', 'Synthetic: bridge inspection record', 'Synthetic: air quality readings', 'Synthetic: ward supply delivery log']
const hex = (n: number) => '0x' + n.toString(16).padStart(64, '0')

export function mockReports(): { reports: Entity[]; counts: Map<string, number> } {
  const now = Date.now()
  const reports = titles.map((t, i) => {
    const sealed = i === 2
    const payload = sealed ? { v: 1, sealed: true, iv: '', ct: '' } : { v: 1, sealed: false, title: t, body: 'Synthetic demo body.' }
    return {
      key: hex(i + 1),
      creator: '0x5d3195C284c27e4e2fC045b5D9eB83959152a088',
      owner: i === 4 ? '0x000000000000000000000000000000000000dEaD' : '0x5d3195C284c27e4e2fC045b5D9eB83959152a088',
      expiresAt: 1_000_000n + BigInt(i) * 20_000n,
      creationFlags: { readonly: true, permissionlessExtension: true },
      attributes: {
        category: { type: 'str', value: cats[i % cats.length] },
        region: { type: 'str', value: 'zone-north' },
        incident_ms: { type: 'u64', value: BigInt(now - i * 86_400_000) },
        posted_ms: { type: 'u64', value: BigInt(now - i * 3_600_000) },
        sealed: { type: 'bool', value: sealed },
      },
      toJson: () => payload,
    } as unknown as Entity
  })
  const counts = new Map<string, number>([[hex(1), 2], [hex(2), 1]])
  return { reports, counts }
}
