import './style.css'
import { jsonToPayload } from '@arkiv-network/sdk'
import { ADMIN, BURN, EXPLORER, PROJECT, REPORT_DAYS } from './config'
import {
  clientFor, getHead, getReport, isBudgetError, listAllowlist, listReports, listTrustedReviews, reportKeys, reviewsFor, rpcMessage, watchFeed, type Entity,
} from './lib/arkiv'
import { importKey, newKey, open as openSealed, seal, sha256Hex } from './lib/crypto'
import { connectWallet } from './lib/wallet'
import { createReport, extendReport } from './lib/write'

// ---------- tiny DOM helper (never uses innerHTML: report content is untrusted) ----------
type Kid = Node | string | null | undefined | false
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k in el && !k.includes('-')) (el as any)[k] = v
    else el.setAttribute(k, String(v))
  }
  for (const kid of kids) if (kid) el.append(kid)
  return el
}
const $main = document.getElementById('main')!
const show = (...kids: Kid[]) => $main.replaceChildren(...(kids.filter(Boolean) as (Node | string)[]))
const $live = document.getElementById('live')!
const av = (e: any, k: string): any => e.attributes?.[k]?.value
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const dateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addrLink = (a: string) => h('a', { href: `${EXPLORER}/address/${a}`, target: '_blank', rel: 'noopener' }, h('code', {}, short(a)))
const txLink = (tx: string, label = 'View transaction') => h('a', { href: `${EXPLORER}/tx/${tx}`, target: '_blank', rel: 'noopener' }, label)
const CATEGORIES = ['procurement', 'public_safety', 'environment', 'public_health', 'other']
const REGIONS = ['zone-north', 'zone-south', 'zone-east', 'zone-west']

// ---------- shared chain state ----------
let head = 0n
let allow: string[] = []
// The public RPC gives each anonymous visitor a limited query budget, so every read goes through a small TTL cache.
const cache = new Map<string, { t: number; v: unknown }>()
async function cached<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttlMs) return hit.v as T
  const v = await f()
  cache.set(key, { t: Date.now(), v })
  return v
}
async function refreshState() {
  const s = await cached('state', 30_000, async () => { const [b, list] = await Promise.all([getHead(), listAllowlist()]); return { b, list } })
  head = s.b
  allow = s.list.map(a => a.toLowerCase())
}
function expiresIn(expiresAt: bigint) {
  const blocks = expiresAt - head
  if (blocks <= 0n) return 'expired'
  const hours = Number(blocks) * 2 / 3600
  return hours >= 48 ? `${Math.floor(hours / 24)} days left` : `${Math.max(1, Math.floor(hours))} h left`
}
const isLocked = (e: Entity) => (e.owner as string | undefined)?.toLowerCase() === BURN.toLowerCase()
const decode = (e: any): any => { try { return e.toJson() } catch { return null } }

// ---------- live events ----------
let onLive: (() => void) | undefined
let liveCount = 0
function startLive() {
  // The chain is shared by every Arkiv app and events cannot be filtered by project, so we must NOT call getEntity
  // per event (that hit the public RPC rate limit, HTTP 429). Instead: note that something happened, and at most
  // once every 10 s run ONE query for our report keys and compare with what we already know.
  const known = new Set<string>()
  let primed = false, dirty = false, timer: number | undefined
  const check = async () => {
    timer = undefined
    if (!dirty && primed) return
    dirty = false
    try {
      const keys = await reportKeys()
      const fresh = keys.filter(k => !known.has(k))
      keys.forEach(k => known.add(k))
      if (primed && fresh.length) { liveCount += fresh.length; $live.textContent = `Live · ${liveCount} new`; onLive?.() }
      primed = true
    } catch { /* rate limited or offline: try again on the next event */ }
  }
  void check()
  watchFeed({
    // Any event proves the push channel works (the chain is shared with other apps), so mark live on the first one.
    onAny: block => {
      $live.classList.add('on'); if (!liveCount) $live.textContent = `Live · block ${block}`
      dirty = true; timer ??= window.setTimeout(check, 10_000)
    },
    onError: () => { $live.classList.remove('on'); $live.textContent = 'Reconnecting…' },
  })
  $live.textContent = 'Connecting…'
}

// ---------- views ----------
function setNav(name: string) {
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach(a => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current')
  })
}

let searchQ = ''
let rerender: (() => void) | undefined
const label = (c: string) => c.replace('_', ' ')
const titleOf = (r: Entity) => (av(r, 'sealed') === true ? 'Sealed report (encrypted)' : (decode(r)?.title ?? 'Untitled'))

function card(r: Entity, n: number, size: 'hero' | 'mid' | 'small') {
  const cat = String(av(r, 'category'))
  return h('a', { class: `card-art ${size} cat-${cat}`, href: `#/r/${r.key}` },
    h('span', { class: 'shade', 'aria-hidden': 'true' }),
    h('span', { class: 'cap' },
      h('span', { class: 'tag' }, label(cat)),
      h('span', { class: 'ttl' }, titleOf(r)),
      h('span', { class: 'badges' },
        av(r, 'sealed') === true && h('span', { class: 'badge' }, 'encrypted'),
        isLocked(r) && h('span', { class: 'badge' }, 'locked'),
        n > 0 && h('span', { class: 'badge ok' }, `${n} trusted review${n > 1 ? 's' : ''}`)),
      h('span', { class: 'by' }, `By ${short(r.creator as string)} / ${dateStr(Number(av(r, 'incident_ms')))} / ${expiresIn(r.expiresAt as bigint)}`)))
}
const thumb = (r: Entity) => h('span', { class: `thumb art cat-${av(r, 'category')}`, 'aria-hidden': 'true' })
const sideItem = (r: Entity, note: string) => h('a', { class: 'rp', href: `#/r/${r.key}` }, thumb(r),
  h('span', {}, h('span', { class: 't' }, titleOf(r)), h('span', { class: 'd' }, note)))

async function feedView() {
  setNav('feed'); onLive = undefined
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const f = { category: params.get('c') ?? '', region: params.get('r') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' }
  const active = !!(f.category || f.region || f.from || f.to)
  const sel = (id: string, text: string, opts: string[], cur: string) =>
    h('label', {}, text, h('select', { id, name: id }, h('option', { value: '' }, 'All'), ...opts.map(o => h('option', { value: o, selected: o === cur }, label(o)))))
  const form = h('form', { class: 'filters', onsubmit: (ev: Event) => {
    ev.preventDefault()
    const d = new FormData(ev.target as HTMLFormElement)
    const q = new URLSearchParams()
    for (const [k, p] of [['c', 'category'], ['r', 'region'], ['from', 'from'], ['to', 'to']] as const) { const v = String(d.get(p) ?? ''); if (v) q.set(k, v) }
    location.hash = '#/' + (q.size ? '?' + q : '')
  } },
    sel('category', 'Category', CATEGORIES, f.category), sel('region', 'Region', REGIONS, f.region),
    h('label', {}, 'Incident from', h('input', { type: 'date', name: 'from', value: f.from })),
    h('label', {}, 'to', h('input', { type: 'date', name: 'to', value: f.to })),
    h('button', { type: 'submit' }, 'Apply'))
  const out = h('div', { 'aria-live': 'polite' })
  show(
    h('h1', { class: 'sr' }, 'Reports'),
    h('p', { class: 'tagline' }, 'A record no one can switch off. Reports are frozen when posted and read straight from the network. A review counts only when its on-chain creator is a reviewer wallet.'),
    h('details', { class: 'filterbar', open: active }, h('summary', {}, active ? 'Filters (active)' : 'Filters'), form, active ? h('a', { href: '#/' }, 'Clear filters') : null),
    out)

  let data: { reports: Entity[]; counts: Map<string, number> } | null = null
  const render = () => {
    if (!data) return
    const q = searchQ.trim().toLowerCase()
    const hay = (r: Entity) => [av(r, 'category'), av(r, 'region'), av(r, 'sealed') === true ? '' : (decode(r)?.title ?? '')].join(' ').toLowerCase()
    const rs = q ? data.reports.filter(r => hay(r).includes(q)) : data.reports
    const n = (r: Entity) => data!.counts.get(r.key as string) ?? 0
    if (!rs.length) {
      out.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, q ? `Nothing matches “${searchQ}”. Sealed reports are not searchable by title.` : 'No reports match these filters yet.'),
        q ? h('button', { onclick: () => { searchQ = ''; (document.getElementById('q') as HTMLInputElement).value = ''; render() } }, 'Clear search') : h('a', { class: 'btn', href: '#/post' }, 'Post the first report')))
      return
    }
    if (active || q) {
      out.replaceChildren(h('p', { class: 'count' }, `${rs.length} report${rs.length > 1 ? 's' : ''}${q ? ` matching “${searchQ}”` : ''}`), h('div', { class: 'grid3' }, ...rs.map(r => card(r, n(r), 'mid'))))
      return
    }
    const heroes = rs.slice(0, 3), rest = rs.slice(3)
    const hero = h('div', { class: `hero-grid${heroes.length === 1 ? ' one' : ''}` },
      card(heroes[0], n(heroes[0]), 'hero'), ...heroes.slice(1).map(r => card(r, n(r), 'small')))
    const sections: Node[] = []
    for (const cat of CATEGORIES) {
      const g = rest.filter(r => av(r, 'category') === cat)
      if (!g.length) continue
      sections.push(h('div', { class: 'sec' }, h('span', { class: 'lab' }, label(cat)), h('span', { class: 'line' }), h('a', { href: `#/?c=${cat}` }, 'More posts')),
        h('div', { class: 'grid2' }, ...g.slice(0, 4).map(r => card(r, n(r), 'mid'))))
    }
    const postedMs = (r: Entity) => Number(av(r, 'posted_ms') ?? 0)
    const recent = [...rs].sort((a, b) => postedMs(b) - postedMs(a)).slice(0, 5)
    const soon = [...rs].sort((a, b) => Number((a.expiresAt as bigint) - (b.expiresAt as bigint))).slice(0, 4)
    out.replaceChildren(hero, h('div', { class: 'cols' },
      h('div', {}, ...(sections.length ? sections : [h('p', { class: 'count' }, 'That is every report so far.')])),
      h('aside', { class: 'side', 'aria-label': 'Sidebar' },
        h('div', { class: 'blk' }, h('h3', {}, 'Recent posts'), ...recent.map(r => sideItem(r, dateStr(postedMs(r))))),
        h('div', { class: 'blk' }, h('h3', {}, 'Expiring soon'), ...soon.map(r => sideItem(r, expiresIn(r.expiresAt as bigint)))))))
  }
  rerender = render

  const load = async () => {
    out.replaceChildren(h('div', { class: 'hero-grid' }, h('div', { class: 'skeleton big hero' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })))
    try {
      if (import.meta.env.DEV && location.search.includes('mock')) { head = 990_000n; data = (await import('./dev-mock')).mockReports(); render(); return } // layout check only, no network
      await refreshState()
      const { reports, trusted } = await cached('feed:' + [f.category, f.region, f.from, f.to].join('|'), 45_000, async () => {
        const [reports, trusted] = await Promise.all([
          listReports({
            category: f.category || undefined, region: f.region || undefined,
            fromMs: f.from ? Date.parse(f.from + 'T00:00:00Z') : undefined,
            toMs: f.to ? Date.parse(f.to + 'T00:00:00Z') + 86_399_999 : undefined,
          }),
          listTrustedReviews(allow),
        ])
        return { reports, trusted }
      })
      const counts = new Map<string, number>()
      for (const r of trusted) { const k = av(r, 'report_key'); counts.set(k, (counts.get(k) ?? 0) + 1) }
      data = { reports, counts }
      render()
    } catch (e: any) {
      out.replaceChildren(h('div', { class: 'empty' }, h('p', {}, rpcMessage(e)), h('button', { onclick: () => { cache.clear(); load() } }, 'Try again')))
    }
  }
  let t: number | undefined
  onLive = () => { cache.clear(); clearTimeout(t); t = window.setTimeout(load, 400) }
  await load()
}

async function detailView(key: `0x${string}`, keyText?: string) {
  setNav('feed'); onLive = undefined
  $main.replaceChildren(h('a', { href: '#/' }, '← All reports'), h('div', { class: 'skeleton' }))
  let e: any
  try { await refreshState(); e = await cached('e:' + key, 45_000, () => getReport(key)) } catch (err) {
    if (isBudgetError(err)) {
      show(h('a', { href: '#/' }, '← All reports'), h('h1', {}, 'Please try again shortly'), h('p', { class: 'lede' }, rpcMessage(err)),
        h('button', { onclick: () => { cache.clear(); detailView(key, keyText) } }, 'Try again'))
      return
    }
    $main.replaceChildren(h('a', { href: '#/' }, '← All reports'), h('h1', {}, 'Not found'),
      h('p', { class: 'lede' }, 'This report has expired or never existed. An expired report leaves the query surface, but its creation transaction stays on-chain.'))
    return
  }
  const p = decode(e); const sealed = !!p?.sealed
  let title = p?.title ?? 'Untitled', body: string = p?.body ?? ''
  let keyPrompt: Node | null = null
  if (sealed) {
    title = 'Sealed report'; body = ''
    if (keyText) {
      try { const o = await openSealed(p, await importKey(keyText)); title = o.title; body = o.body } catch { body = 'Could not decrypt: the key is wrong.' }
    } else {
      const input = h('input', { name: 'k', type: 'text', placeholder: 'Decryption key', autocomplete: 'off', spellcheck: false, required: true })
      keyPrompt = h('form', { class: 'row', onsubmit: (ev: Event) => { ev.preventDefault(); location.hash = `#/r/${key}/${encodeURIComponent(input.value.trim())}` } },
        h('label', {}, 'This report is encrypted. Paste its key (it is never sent to any server).', input), h('button', { type: 'submit' }, 'Decrypt'))
    }
  }
  const hashNow = await sha256Hex(e.payload as Uint8Array<ArrayBuffer>)
  const hashOk = hashNow.toLowerCase() === String(av(e, 'content_hash')).toLowerCase()
  const msg = h('p', { class: 'msg', role: 'status' })
  const extendBtn = h('button', { class: 'ghost', onclick: async () => {
    extendBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'Waiting for your wallet…'
    try {
      const w = await connectWallet()
      const r = await extendReport(w, key, REPORT_DAYS)
      msg.className = 'msg ok'; msg.replaceChildren(`Extended to block ${r.expiresAt}. `, txLink(r.txHash))
    } catch (err: any) { msg.className = 'msg err'; msg.textContent = err?.shortMessage ?? err?.message ?? String(err); extendBtn.disabled = false }
  } }, `Keep this alive (${REPORT_DAYS} days)`)

  const all = await cached('rv:' + key, 45_000, () => reviewsFor(key))
  const trusted = all.filter(r => allow.includes((r.creator as string).toLowerCase()))
  const ignored = all.filter(r => !allow.includes((r.creator as string).toLowerCase()))
  const reviewCard = (r: any, ok: boolean) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: `chip ${ok ? 'ok' : 'bad'}` }, String(av(r, 'verdict')).replace('_', ' ')), 'by ', addrLink(r.creator as string),
      !ok && h('span', { class: 'chip bad' }, 'ignored: creator not on allowlist')),
    h('p', {}, decode(r)?.note ?? ''))

  show(
    h('a', { href: '#/' }, '← All reports'),
    h('h1', {}, title),
    h('p', { class: 'meta' }, h('span', {}, String(av(e, 'category')).replace('_', ' ')), h('span', {}, String(av(e, 'region'))), h('span', {}, 'incident ' + dateStr(Number(av(e, 'incident_ms')))), h('span', {}, expiresIn(e.expiresAt))),
    keyPrompt, body ? h('div', { class: 'card pre' }, body) : null,
    h('h2', {}, 'Why you can trust what you see'),
    h('div', { class: 'card' }, h('dl', { class: 'kv' },
      h('dt', {}, 'Creator'), h('dd', {}, addrLink(e.creator), ' fixed forever, not a field anyone typed'),
      h('dt', {}, 'Owner'), h('dd', {}, addrLink(e.owner), isLocked(e) ? ' burn address: nobody, not even the author, can delete this' : ' the owner can delete this record'),
      h('dt', {}, 'Frozen'), h('dd', {}, e.creationFlags?.readonly ? 'Yes. Content and attributes cannot be edited.' : 'No'),
      h('dt', {}, 'Anyone can extend'), h('dd', {}, e.creationFlags?.permissionlessExtension ? 'Yes. Any wallet can keep it alive.' : 'No'),
      h('dt', {}, 'Content hash'), h('dd', {}, h('code', {}, String(av(e, 'content_hash'))), ' ', h('span', { class: `chip ${hashOk ? 'ok' : 'bad'}` }, hashOk ? 'matches payload (checked in your browser)' : 'MISMATCH')),
      h('dt', {}, 'Entity key'), h('dd', {}, h('code', {}, key)))),
    h('h2', {}, `Trusted reviews (${trusted.length})`),
    trusted.length ? h('div', {}, ...trusted.map(r => reviewCard(r, true))) : h('p', { class: 'lede' }, 'No review from an allowlisted wallet yet.'),
    ignored.length ? h('details', {}, h('summary', {}, `${ignored.length} review${ignored.length > 1 ? 's' : ''} ignored`), ...ignored.map(r => reviewCard(r, false))) : null,
    h('h2', {}, 'Keep it alive'),
    h('p', { class: 'lede' }, 'Reports expire. Because this one allows permissionless extension, anyone with a wallet and a little test GLM can renew it. The author does not have to be around.'),
    extendBtn, msg)
}

async function postView() {
  setNav('post'); onLive = undefined
  const msg = h('p', { class: 'msg', role: 'status' })
  const sel = (name: string, label: string, opts: string[]) => h('label', {}, label, h('select', { name, required: true }, ...opts.map(o => h('option', { value: o }, o.replace('_', ' ')))))
  const submit = h('button', { type: 'submit' }, 'Post report')
  const form = h('form', { class: 'grid', onsubmit: async (ev: Event) => {
    ev.preventDefault()
    const d = new FormData(form)
    const title = String(d.get('title')).trim(), body = String(d.get('body')).trim()
    const wantSeal = d.get('seal') === 'on', lock = d.get('lock') === 'on'
    submit.disabled = true; msg.className = 'msg'; msg.textContent = 'Preparing…'
    try {
      let payload: Record<string, unknown> = { v: 1, sealed: false, title, body }
      let keyText = ''
      if (wantSeal) { const k = await newKey(); keyText = k.keyText; payload = await seal({ title, body }, k.key) }
      if (jsonToPayload(payload).length > 128 * 1024) throw new Error('Too large: a payload is limited to 128 KiB.')
      msg.textContent = 'Waiting for your wallet…'
      const w = await connectWallet()
      msg.textContent = 'Sending transaction…'
      const r = await createReport(w, { category: String(d.get('category')), region: String(d.get('region')), incidentMs: Date.parse(String(d.get('incident')) + 'T00:00:00Z'), payload, sealed: wantSeal, lock })
      const link = `${location.origin}${location.pathname}#/r/${r.entityKey}${keyText ? '/' + keyText : ''}`
      msg.className = 'msg ok'
      msg.replaceChildren(...([ 'Posted. ', txLink(r.txHash), ' · ', h('a', { href: `#/r/${r.entityKey}${keyText ? '/' + keyText : ''}` }, 'Open report'),
        keyText ? h('div', { class: 'card' }, h('p', {}, 'Save this share link now. The decryption key is in it and is not stored anywhere else:'), h('code', {}, link)) : null ].filter(Boolean) as (Node | string)[]))
    } catch (err: any) { msg.className = 'msg err'; msg.textContent = err?.shortMessage ?? err?.message ?? String(err); submit.disabled = false }
  } },
    sel('category', 'Category', CATEGORIES), sel('region', 'Region', REGIONS),
    h('label', {}, 'Incident date', h('input', { type: 'date', name: 'incident', required: true, max: dateStr(Date.now()) })),
    h('label', {}, 'Title', h('input', { type: 'text', name: 'title', required: true, maxlength: 140, autocomplete: 'off' })),
    h('label', {}, 'Details', h('textarea', { name: 'body', required: true, maxlength: 20000 })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'seal' }), h('span', {}, 'Encrypt in my browser. Only people with the link’s key can read it. Category, region and dates stay public.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'lock' }), h('span', {}, 'Lock it. Ownership moves to a burn address so nobody, including you, can ever delete it. You cannot undo this.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'demo', required: true }), h('span', {}, 'I understand this is a public testnet demo. I will post synthetic content only: no real people, places, footage or personal data.')),
    submit, msg)
  $main.replaceChildren(h('h1', {}, 'Post a report'),
    h('p', { class: 'lede' }, `Needs a browser wallet with a little test GLM on Tiramisu. Everything on Arkiv is public: the wallet address that posts is visible and can be traced. This tool does not make you anonymous. A report lives ${REPORT_DAYS} days unless someone extends it.`), form)
}

async function proofView() {
  setNav('proof'); onLive = undefined
  const out = h('pre', { class: 'code', 'aria-live': 'polite' }, 'Press the button to run it.')
  const rpc = h('input', { type: 'url', name: 'rpc', value: 'https://rpc.tiramisu.db-chain.testnet.arkiv.network', autocomplete: 'off', spellcheck: false, required: true, style: 'width:100%' })
  const q = `project = str('${PROJECT}') AND entity_type = str('report')`
  const run = h('button', { onclick: async () => {
    run.disabled = true; out.textContent = 'Querying…'
    try {
      const c = clientFor(rpc.value.trim())
      const [block, res] = await Promise.all([c.getBlockNumber(), c.query(q, { select: { key: true, creator: true }, limit: 200 })])
      out.textContent = `RPC:   ${rpc.value.trim()}\nblock: ${block}\nquery: ${q}\nmatched ${res.entities.length} report(s)\n\n` + res.entities.slice(0, 20).map(x => `${x.key}  creator ${x.creator}`).join('\n')
    } catch (err: any) { out.textContent = 'Failed: ' + (err?.shortMessage ?? err?.message ?? err) } finally { run.disabled = false }
  } }, 'Run this query from my browser')
  let reviewers: HTMLElement = h('p', {}, 'Loading…')
  $main.replaceChildren(h('h1', {}, 'Proof, in one page'),
    h('p', { class: 'lede' }, 'You do not have to trust this website. Everything it shows can be read straight from the network, and you can check the one rule that matters: who is allowed to vouch.'),
    h('h2', {}, '1. Read it without our servers'),
    h('p', {}, 'This page talks to the public Arkiv RPC from your browser. Switch our site off and the same query still works from any machine, or point it at a different RPC:'),
    h('label', {}, 'RPC URL', rpc), h('pre', { class: 'code' }, q), run, out,
    h('p', {}, 'The same thing from a terminal, using the SDK:'),
    h('pre', { class: 'code' }, `import { createPublicClient } from "@arkiv-network/sdk"\nimport { tiramisu } from "@arkiv-network/sdk/chains"\nimport { http } from "viem"\n\nconst c = createPublicClient({ chain: tiramisu, transport: http() })\nconst r = await c.query("${q}", { select: { key: true }, limit: 200 })\nconsole.log(r.entities.length)`),
    h('h2', {}, '2. Who is allowed to vouch'),
    h('p', {}, 'The admin wallet publishes the reviewer allowlist as entities. This app counts a review only when its immutable on-chain creator is on that list, never because a field says "verified". Admin: ', addrLink(ADMIN)), reviewers,
    h('h2', {}, '3. What this does not do'),
    h('ul', {},
      h('li', {}, 'It does not make anyone anonymous. The posting wallet is public and a funding transaction can link wallets.'),
      h('li', {}, 'It does not prove a report is true. It makes it harder to erase or rewrite and shows who vouched.'),
      h('li', {}, 'A government could block the public RPC address, as websites are blocked. The data lives on the network and can be read through any RPC, but the RPC must be reachable.'),
      h('li', {}, 'Writing needs internet too. In a blackout nobody can post.'),
      h('li', {}, 'Reports expire unless extended. An expired report leaves the query surface; its creation transaction stays on-chain.'),
      h('li', {}, 'Arkiv documents a keccak Merkle-Patricia state root readable with eth_getProof. This UI does not verify proofs itself.')))
  try {
    await refreshState()
    const rs: HTMLElement = allow.length ? h('ul', {}, ...allow.map(a => h('li', {}, addrLink(a)))) : h('p', {}, 'No reviewers published yet.')
    reviewers.replaceWith(rs); reviewers = rs
  } catch { /* network error: leave placeholder */ }
}

async function aboutView() {
  setNav('about'); onLive = undefined
  const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text)
  show(h('div', { class: 'about' },
    h('h1', {}, 'Why WitNess exists'),
    h('p', { class: 'lede' }, 'A record is only as safe as the server that holds it.'),
    h('p', {}, 'In October 2020, young Nigerians filmed and streamed what was happening at the Lekki Toll Gate during the #EndSARS protests. Afterward, what happened there was disputed, and the evidence sat on platforms and servers other people controlled.'),
    h('figure', { class: 'photo' },
      h('img', {
        src: './img/endsars-lagos.jpg', width: 1024, height: 681, loading: 'lazy',
        alt: 'Black-and-white photo of a large crowd at a street protest in Lagos. One person stands on a roadside kiosk holding a flag.',
      }),
      h('figcaption', {},
        'Protesters at the endSARS protest in Lagos, Nigeria. Photo by ',
        ext('https://commons.wikimedia.org/wiki/File:Protesters_at_the_endSARS_protest_in_Lagos,_Nigeria_71.jpg', 'Kaizenify'),
        ', ', ext('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0'), ', via Wikimedia Commons. Shown unmodified, as background only. We have not confirmed where in Lagos it was taken, and it is not evidence of any event described on this site.')),
    h('p', {}, 'In June 2021, Twitter was suspended nationwide in Nigeria for about seven months. In Gaza, restricted press access and repeated communications blackouts leave documentation scattered and contested.'),
    h('p', {}, 'Different places, same gap. WitNess is a small, honest answer to one part of it.'),
    h('h2', {}, 'What WitNess does'),
    h('ul', {},
      h('li', {}, 'Reports are frozen when posted, so their content cannot be edited afterward.'),
      h('li', {}, 'Anyone can keep a report alive, so it does not depend on its author.'),
      h('li', {}, 'A review counts only when its on-chain creator is a reviewer wallet, never because a field says “verified”.'),
      h('li', {}, 'Reads go straight from your browser to the network, with no server of ours in the path.')),
    h('p', {}, 'It does not make anyone anonymous and it does not prove a report is true. The limits are listed on the ', h('a', { href: '#/proof' }, 'Proof page'), '.'),
    h('p', { class: 'meta' }, 'Every report on this site is synthetic demo data.')))
}

// ---------- router ----------
async function route() {
  rerender = undefined
  const hash = location.hash || '#/'
  window.scrollTo(0, 0)
  try {
    const m = hash.match(/^#\/r\/(0x[0-9a-fA-F]{64})(?:\/([^?]+))?/)
    if (m) await detailView(m[1] as `0x${string}`, m[2] ? decodeURIComponent(m[2]) : undefined)
    else if (hash.startsWith('#/post')) await postView()
    else if (hash.startsWith('#/proof')) await proofView()
    else if (hash.startsWith('#/about')) await aboutView()
    else await feedView()
  } catch (e: any) {
    $main.replaceChildren(h('div', { class: 'empty' }, h('p', {}, rpcMessage(e)), h('a', { class: 'btn', href: '#/' }, 'Back to reports')))
  }
}
function wireChrome() {
  const root = document.documentElement
  const themeBtn = document.getElementById('theme')!
  const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches)
  const syncTheme = () => themeBtn.setAttribute('aria-label', dark() ? 'Switch to light theme' : 'Switch to dark theme')
  themeBtn.addEventListener('click', () => {
    root.classList.add('no-anim') // a theme swap must not animate
    root.dataset.theme = dark() ? 'light' : 'dark'
    try { localStorage.setItem('theme', root.dataset.theme) } catch { /* storage blocked */ }
    syncTheme()
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-anim')))
  })
  syncTheme()

  const drawer = document.getElementById('drawer')!
  const menu = document.getElementById('menu')!
  drawer.replaceChildren(...CATEGORIES.map(c => h('a', { href: `#/?c=${c}` }, label(c))), h('a', { href: '#/post' }, 'Post a report'), h('a', { href: '#/proof' }, 'Proof'))
  const setDrawer = (openIt: boolean) => { drawer.hidden = !openIt; menu.setAttribute('aria-expanded', String(openIt)); menu.setAttribute('aria-label', openIt ? 'Close menu' : 'Open menu') }
  menu.addEventListener('click', () => setDrawer(drawer.hidden === true))

  const bar = document.getElementById('searchbar') as HTMLFormElement
  const q = document.getElementById('q') as HTMLInputElement
  const searchBtn = document.getElementById('search')!
  const setSearch = (openIt: boolean) => {
    bar.hidden = !openIt; searchBtn.setAttribute('aria-expanded', String(openIt))
    if (openIt && matchMedia('(hover: hover)').matches) q.focus() // never autofocus on touch
  }
  searchBtn.addEventListener('click', () => setSearch(bar.hidden === true))
  bar.addEventListener('submit', ev => ev.preventDefault())
  q.addEventListener('input', () => {
    searchQ = q.value
    if (rerender) rerender(); else location.hash = '#/'
  })
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape') { setDrawer(false); if (!bar.hidden) setSearch(false) } })
  window.addEventListener('hashchange', () => setDrawer(false))
}
wireChrome()
window.addEventListener('hashchange', route)
route()
startLive()
