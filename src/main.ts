import './style.css'
import { jsonToPayload } from '@arkiv-network/sdk'
import { ADMIN, BURN, EXPLORER, PROJECT, REPORT_DAYS } from './config'
import {
  clientFor, getHead, getReport, isBudgetError, listAllowlist, listReports, listReportsBy, listTrustedReviews, publicHttp, reportKeys, reviewsFor, rpcMessage, watchFeed, type Entity,
} from './lib/arkiv'
import { hashFile, importKey, newKey, open as openSealed, seal, sha256Hex } from './lib/crypto'
import { previewSrc, shrinkImage, videoPoster, type Preview } from './lib/image'
import { STATUS_CLASS, STATUS_EXPLAIN, STATUS_TEXT, statusFor, type ReviewLite, type Status } from './lib/verify'
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
const REGIONS = ['zone-north', 'zone-south', 'zone-east', 'zone-west', 'global', 'europe']

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
const toLite = (e: any): ReviewLite => ({ creator: e.creator as string, verdict: String(av(e, 'verdict')), at: Number(av(e, 'reviewed_ms') ?? 0) })
const groupReviews = (trusted: any[]) => {
  const m = new Map<string, ReviewLite[]>()
  for (const r of trusted) { const k = String(av(r, 'report_key')); const list = m.get(k) ?? []; list.push(toLite(r)); m.set(k, list) }
  return m
}
const statusOf = (m: Map<string, ReviewLite[]>, key: string): Status => statusFor(m.get(key) ?? [], new Set(allow)).status
/** A news source attached to a sample report. Reports are written by strangers, so every field is checked and only an https link is kept. */
const sourceOf = (x: any): { publisher: string; title: string; url: string; published: string; retrieved: string; image: { credit: string; license: string; url: string } | null } | null => {
  if (!x || typeof x !== 'object') return null
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
  const publisher = str(x.publisher, 80), title = str(x.title, 240), url = typeof x.url === 'string' ? safeHttps(x.url) : null
  if (!publisher || !title || !url) return null
  const im = x.image && typeof x.image === 'object' ? x.image : null
  const image = im && str(im.credit, 220) && str(im.license, 40) && typeof im.url === 'string' && safeHttps(im.url) ? { credit: im.credit as string, license: im.license as string, url: safeHttps(im.url)! } : null
  return { publisher, title, url, published: str(x.published, 20) ?? '', retrieved: str(x.retrieved, 20) ?? '', image }
}
const safeHttps = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null } catch { return null } }
/** The wallet already connected to this page, without prompting. */
const connectedAddress = async (): Promise<string | null> => {
  try { const a = (await (window as any).ethereum?.request({ method: 'eth_accounts' })) as string[] | undefined; return a?.[0] ?? null } catch { return null }
}

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

function card(r: Entity, st: Status, size: 'hero' | 'mid' | 'small') {
  const cat = String(av(r, 'category'))
  // A stranger's picture is sharp on the homepage only once the council has verified the report. Until then it is
  // blurred (so the post is visibly there), and a disputed report's picture is not shown at all.
  const img = st === 'disputed' ? null : previewSrc(decode(r)?.preview)
  const clear = st === 'verified'
  const el = h('a', { class: `card-art ${size} cat-${cat}${img ? ' has-img' : ''}`, href: `#/r/${r.key}` },
    h('span', { class: 'shade', 'aria-hidden': 'true' }),
    h('span', { class: 'cap' },
      h('span', { class: 'tag' }, label(cat)),
      h('span', { class: 'ttl' }, titleOf(r)),
      h('span', { class: 'badges' },
        av(r, 'sealed') === true && h('span', { class: 'badge' }, 'encrypted'),
        isLocked(r) && h('span', { class: 'badge' }, 'locked'),
        h('span', { class: `badge ${STATUS_CLASS[st]}` }, STATUS_TEXT[st]),
        img && !clear ? h('span', { class: 'badge' }, 'image blurred until verified') : null,
        sourceOf(decode(r)?.source) ? h('span', { class: 'badge' }, 'News · ' + sourceOf(decode(r)?.source)!.publisher.slice(0, 26)) : null,
        av(r, 'media_hash') ? h('span', { class: 'badge' }, 'file fingerprint') : null),
      h('span', { class: 'by' }, `By ${short(r.creator as string)} / ${dateStr(Number(av(r, 'incident_ms')))} / ${expiresIn(r.expiresAt as bigint)}`)))
  if (img && clear) { el.style.backgroundImage = `url("${img}")`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center' }
  if (img && !clear) { const bg = h('span', { class: 'bg-blur', 'aria-hidden': 'true' }); bg.style.backgroundImage = `url("${img}")`; el.prepend(bg) }
  return el
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
    h('section', { class: 'witness-hero', 'aria-label': 'About WitNess' },
      h('div', { class: 'wh-copy' },
        h('p', { class: 'wh-kicker' }, 'WitNess · built on Arkiv'),
        h('p', { class: 'wh-title' }, 'A record no one can switch off.'),
        h('p', { class: 'wh-sub' }, 'Reports are frozen when posted and read straight from the network. A report counts as verified only when reviewers on a public list vouch for it, and a review from anyone else is ignored.'),
        h('ul', { class: 'wh-points' },
          h('li', {}, h('b', {}, 'Frozen when posted.'), ' Nobody can edit a report afterward.'),
          h('li', {}, h('b', {}, 'Vouched for in public.'), ' Two reviewers from an open list must agree.'),
          h('li', {}, h('b', {}, 'Read from the chain.'), ' No server of ours sits in the path.'))),
      h('figure', { class: 'wh-fig' },
        h('img', { class: 'wh-photo', src: './img/witness-bg.jpg', width: 408, height: 612, decoding: 'async', alt: 'A man raising his right hand and swearing an oath as a witness in a courtroom' }),
        h('figcaption', {}, 'The oath is spoken. The record keeps it.'))),
    h('details', { class: 'filterbar', open: active }, h('summary', {}, active ? 'Filters (active)' : 'Filters'), form, active ? h('a', { href: '#/' }, 'Clear filters') : null),
    out)

  let data: { reports: Entity[]; reviews: Map<string, ReviewLite[]> } | null = null
  const render = () => {
    if (!data) return
    const q = searchQ.trim().toLowerCase()
    const hay = (r: Entity) => [av(r, 'category'), av(r, 'region'), av(r, 'sealed') === true ? '' : (decode(r)?.title ?? '')].join(' ').toLowerCase()
    const rs = q ? data.reports.filter(r => hay(r).includes(q)) : data.reports
    const n = (r: Entity): Status => statusOf(data!.reviews, r.key as string)
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
      if (import.meta.env.DEV && location.search.includes('mock')) { head = 990_000n; const m = (await import('./dev-mock')).mockReports(); allow = m.allow; data = { reports: m.reports, reviews: m.reviews }; render(); return } // layout check only, no network
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
      data = { reports, reviews: groupReviews(trusted) }
      render()
    } catch (e: any) {
      out.replaceChildren(h('div', { class: 'empty' }, h('p', {}, rpcMessage(e)), h('button', { onclick: () => { cache.clear(); load() } }, 'Try again')))
    }
  }
  let t: number | undefined
  onLive = () => { cache.clear(); clearTimeout(t); t = window.setTimeout(load, 400) }
  await load()
}

/** Downloads a file but gives up past `limit` bytes. Needs the host to allow cross-site reads. */
async function fetchLimited(url: string, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  if (Number(res.headers.get('content-length') ?? 0) > limit) { void res.body?.cancel(); throw new Error('too large') }
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) { void reader.cancel(); throw new Error('too large') }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

function previewCard(src: string, status: Status, hasFingerprint: boolean, isVideo: boolean) {
  const slot = h('div', { class: 'preview-slot' })
  const alt = isVideo ? 'Still frame from the video stored in this report' : 'Preview image stored in this report'
  let btn: HTMLElement | null = null
  let note: string
  if (status === 'verified') {
    note = 'Stored on Arkiv with this report, which at least two reviewers have corroborated.'
    slot.replaceChildren(h('img', { src, class: 'remote-img', alt }))
  } else if (status === 'disputed') {
    note = 'A reviewer disputes this report, so treat the picture with caution. It is hidden until you choose to show it.'
    btn = h('button', { class: 'ghost', onclick: () => { slot.replaceChildren(h('img', { src, class: 'remote-img', alt })); btn?.remove() } }, 'Show the image anyway')
  } else {
    note = 'This report is not verified, so the picture is blurred until you choose to reveal it.'
    const img = h('img', { src, class: 'remote-img blurred', alt })
    slot.replaceChildren(img)
    btn = h('button', { class: 'ghost', onclick: () => { img.classList.remove('blurred'); btn?.remove() } }, 'Click to reveal the picture')
  }
  return h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, isVideo ? 'Still frame from the video' : 'Preview image'),
    h('p', { class: 'lede', style: 'margin:0 0 10px' }, note + (isVideo ? ' This is one still frame taken from the video, not the video itself.' : ' It is a shrunk copy with location data removed.') + (hasFingerprint ? ' The fingerprint below belongs to the original file.' : '')),
    btn, slot)
}

function mediaCard(hash: string, type: string, url: string | null) {
  const out = h('p', { class: 'msg', role: 'status' }, 'Choose the file you were given to compare it with this record.')
  const preview = h('div', { class: 'preview' })
  let blobUrl = ''
  const input = h('input', { type: 'file', accept: 'image/*,video/*', 'aria-label': 'File to check', onchange: async () => {
    const f = input.files?.[0]
    if (!f) return
    preview.replaceChildren()
    if (f.size > 100 * 1024 * 1024) { out.className = 'msg err'; out.textContent = 'That file is over 100 MB, too large to fingerprint in the browser.'; return }
    out.className = 'msg'; out.textContent = 'Fingerprinting in your browser…'
    const got = await hashFile(f)
    const ok = got.toLowerCase() === hash.toLowerCase()
    out.className = 'msg ' + (ok ? 'ok' : 'err')
    out.replaceChildren(ok ? '✔ Match. This file is byte-for-byte the one recorded on this report.' : '✘ No match. This is not the file recorded here. Any change at all, even one pixel, changes the fingerprint.', h('code', { class: 'hashline' }, 'your file: ' + got))
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    if (f.type.startsWith('image/')) { blobUrl = URL.createObjectURL(f); preview.replaceChildren(h('img', { src: blobUrl, alt: 'Preview of the file you chose' })) }
  } })
  // Optional: show the image from the author's own https link, only after a click, and only if it matches the fingerprint
  // (when the host allows us to read it). Raster types only, so nothing executable is ever rendered.
  const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']
  let remoteBlock: Node | null = null
  let videoBlock: Node | null = null
  if (url && RASTER.includes(type)) {
    const host = new URL(url).host
    const slot = h('div', { class: 'remote' })
    const btn = h('button', { class: 'ghost', onclick: async () => {
      btn.disabled = true
      slot.replaceChildren(h('p', { class: 'msg' }, `Loading from ${host}…`))
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const buf = await res.arrayBuffer()
        if (buf.byteLength > 25 * 1024 * 1024) throw new Error('too large')
        const got = await sha256Hex(new Uint8Array(buf))
        if (got.toLowerCase() === hash.toLowerCase()) {
          const src = URL.createObjectURL(new Blob([buf], { type }))
          slot.replaceChildren(h('p', { class: 'msg ok' }, '✔ Loaded from the author’s link, and it matches the recorded fingerprint.'),
            h('img', { src, class: 'remote-img', alt: 'Image from the author’s link, verified against the recorded fingerprint' }))
        } else {
          slot.replaceChildren(h('p', { class: 'msg err' }, '✘ The file at that link is NOT the one recorded on this report (its fingerprint differs), so it is not shown.'),
            h('code', { class: 'hashline' }, 'found: ' + got))
        }
      } catch {
        // The host may block cross-site reads or be down: show it as a plain image, clearly marked unchecked.
        slot.replaceChildren(h('p', { class: 'msg' }, 'This host does not let us check the image against the fingerprint, so it is shown unchecked. Download it and use “Check a file” to be sure.'),
          h('img', { src: url, class: 'remote-img', referrerPolicy: 'no-referrer', alt: 'Image from the author’s link (not checked against the fingerprint)',
            onerror: () => slot.replaceChildren(h('p', { class: 'msg err' }, 'The image could not be loaded from that link.')) }))
      }
    } }, 'Load the image from the author’s link')
    remoteBlock = h('div', {},
      h('p', { class: 'lede', style: 'margin:12px 0 8px' }, `Optional: load the image from ${host}, the host the author chose. Nothing loads until you click, that host will see your IP address, and we have not reviewed it.`),
      btn, slot)
  }
  // Optional: play a video from the author's own https link, only after a click (mp4/webm only). The host sees the viewer's IP.
  if (url && ['video/mp4', 'video/webm'].includes(type)) {
    const host = new URL(url).host
    const slot = h('div', { class: 'remote' })
    const out = h('p', { class: 'msg', role: 'status' })
    const verify = h('button', { class: 'ghost', onclick: async () => {
      verify.disabled = true; out.className = 'msg'; out.textContent = 'Downloading the video to check its fingerprint (up to 25 MB)…'
      try {
        const got = await sha256Hex(await fetchLimited(url, 25 * 1024 * 1024))
        const ok = got.toLowerCase() === hash.toLowerCase()
        out.className = 'msg ' + (ok ? 'ok' : 'err')
        out.textContent = ok ? '✔ The video at that link matches the recorded fingerprint.' : '✘ The video at that link is NOT the one recorded on this report.'
      } catch (err: any) {
        out.className = 'msg'
        out.textContent = err?.message === 'too large' ? 'That video is over 25 MB, too large to check here. Download it and use “Check a file”.' : 'This host does not let us check the video, or it could not be reached. Download it and use “Check a file”.'
        verify.disabled = false
      }
    } }, 'Check the video against the fingerprint')
    const play = h('button', { class: 'ghost', onclick: () => {
      play.remove()
      slot.replaceChildren(h('video', { src: url, controls: true, preload: 'metadata', playsInline: true, class: 'remote-video' }), verify, out)
    } }, 'Load the video from the author’s link')
    videoBlock = h('div', {},
      h('p', { class: 'lede', style: 'margin:12px 0 8px' }, `Optional: play the video from ${host}, the host the author chose. Nothing loads until you click, that host will see your IP address, and we have not reviewed it. The video is never stored on Arkiv.`),
      play, slot)
  }
  return h('div', { class: 'card mediacheck' },
    h('h2', { style: 'margin-top:0' }, 'Photo or video fingerprint'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Type'), h('dd', {}, type),
      h('dt', {}, 'SHA-256'), h('dd', {}, h('code', {}, hash)),
      url ? h('dt', {}, 'Author’s link') : null,
      url ? h('dd', {}, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, new URL(url).host), ' (supplied by the author, not checked or hosted by us)') : null),
    h('p', { class: 'lede', style: 'margin:12px 0 8px' }, 'The file is not stored on Arkiv or on this site. Only its fingerprint is recorded, so you can check that a copy you were given is the original. A match proves the file is unchanged since it was recorded. It does not prove its content is genuine.'),
    remoteBlock,
    videoBlock,
    h('label', {}, 'Check a file', input), preview, out)
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
  let title = p?.title ?? 'Untitled', body: string = p?.body ?? '', preview: unknown = p?.preview, source: unknown = p?.source
  let keyPrompt: Node | null = null
  if (sealed) {
    title = 'Sealed report'; body = ''
    if (keyText) {
      try { const o = await openSealed(p, await importKey(keyText)); title = o.title; body = o.body; preview = o.preview; source = o.source } catch { body = 'Could not decrypt: the key is wrong.' }
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
  const verdict = statusFor(all.map(toLite), new Set(allow))
  const mediaHash = av(e, 'media_hash') as string | undefined
  const mediaUrl = av(e, 'media_url') ? safeHttps(String(av(e, 'media_url'))) : null
  const mediaBlock = mediaHash ? mediaCard(mediaHash, String(av(e, 'media_type') ?? 'unknown'), mediaUrl) : null
  const pSrc = previewSrc(preview)
  const src = sourceOf(source)
  const sourceBlock = src ? h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Source'),
    h('p', { class: 'lede', style: 'margin:0 0 8px' }, 'This is a sample news item. The summary above was written for this demo in our own words; it is not the article. Read the original at the publisher:'),
    h('p', { style: 'margin:0' }, h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, `${src.publisher}: ${src.title}`)),
    src.image ? h('p', { class: 'meta', style: 'margin:10px 0 0' }, h('span', {}, 'Picture: '), h('a', { href: src.image.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, src.image.credit), h('span', {}, `${src.image.license}, via Wikimedia Commons, resized and compressed`)) : null,
    h('p', { class: 'meta', style: 'margin:8px 0 0' }, src.published ? h('span', {}, 'published ' + src.published) : null, src.retrieved ? h('span', {}, 'read ' + src.retrieved) : null, h('span', {}, 'Summary not verified by reviewers unless the status above says Verified.'))) : null
  const previewBlock = pSrc ? previewCard(pSrc, verdict.status, !!mediaHash, String(av(e, 'media_type') ?? '').startsWith('video/')) : null
  const reviewCard = (r: any, ok: boolean) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: `chip ${ok ? 'ok' : 'bad'}` }, String(av(r, 'verdict')).replace('_', ' ')), 'by ', addrLink(r.creator as string),
      !ok && h('span', { class: 'chip bad' }, 'ignored: creator not on allowlist')),
    h('p', {}, decode(r)?.note ?? ''))

  show(
    h('a', { href: '#/' }, '← All reports'),
    h('h1', {}, title),
    h('p', { class: 'meta' }, h('span', {}, String(av(e, 'category')).replace('_', ' ')), h('span', {}, String(av(e, 'region'))), h('span', {}, 'incident ' + dateStr(Number(av(e, 'incident_ms')))), h('span', {}, expiresIn(e.expiresAt))),
    h('div', { class: `status ${verdict.status}` }, h('span', { class: 'big' }, STATUS_TEXT[verdict.status]),
      h('p', {}, STATUS_EXPLAIN[verdict.status], ` (${verdict.corroborated} corroborate, ${verdict.disputed} dispute, from ${verdict.reviewers} allowlisted reviewer${verdict.reviewers === 1 ? '' : 's'}.)`)),
    keyPrompt, body ? h('div', { class: 'card pre' }, body) : null,
    sourceBlock,
    previewBlock,
    mediaBlock,
    h('h2', {}, 'Why you can trust what you see'),
    h('div', { class: 'card' }, h('dl', { class: 'kv' },
      h('dt', {}, 'Creator'), h('dd', {}, addrLink(e.creator), ' · ', h('a', { href: `#/u/${e.creator}` }, 'view profile'), '. Fixed forever, not a field anyone typed.'),
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
    const file = d.get('media') as File | null
    const embed = d.get('embed') === 'on'
    const mediaUrlRaw = String(d.get('media_url') ?? '').trim()
    submit.disabled = true; msg.className = 'msg'; msg.textContent = 'Preparing…'
    try {
      let media: { hash: `0x${string}`; type: string; url?: string } | undefined
      if (file && file.size > 0) {
        if (file.size > 100 * 1024 * 1024) throw new Error('That file is over 100 MB, too large to fingerprint in the browser.')
        msg.textContent = 'Fingerprinting your file in the browser…'
        media = { hash: await hashFile(file), type: (file.type || 'application/octet-stream').toLowerCase() }
        if (mediaUrlRaw) {
          if (!safeHttps(mediaUrlRaw)) throw new Error('The file link must be an https:// address.')
          if (new TextEncoder().encode(mediaUrlRaw).length > 128) throw new Error('The file link is longer than 128 bytes.')
          media.url = mediaUrlRaw
        }
      } else if (mediaUrlRaw) throw new Error('Choose the file too, so its fingerprint can be recorded.')
      let preview: Preview | undefined
      if (embed) {
        const isVideo = !!file && file.type.startsWith('video/')
        if (!file || file.size === 0 || !(file.type.startsWith('image/') || isVideo)) throw new Error('Choose an image or video file to store a preview picture of it.')
        msg.textContent = isVideo ? 'Taking a still frame from the video in your browser…' : 'Shrinking the image in your browser…'
        const textBytes = new TextEncoder().encode(JSON.stringify({ title, body })).length
        const budget = Math.min(60_000, Math.floor(((126 * 1024) / (wantSeal ? 1.4 : 1) - textBytes) / 1.34) - 1024)
        if (budget < 8_000) throw new Error('The text is too long to also store an image. Shorten it, or untick the preview.')
        preview = isVideo ? await videoPoster(file, budget) : await shrinkImage(file, budget)
      }
      const inner = { title, body, ...(preview ? { preview } : {}) }
      let payload: Record<string, unknown> = { v: 1, sealed: false, ...inner }
      let keyText = ''
      if (wantSeal) { const k = await newKey(); keyText = k.keyText; payload = await seal(inner, k.key) }
      if (jsonToPayload(payload).length > 128 * 1024) throw new Error('Too large: a payload is limited to 128 KiB.')
      msg.textContent = 'Waiting for your wallet…'
      const w = await connectWallet()
      msg.textContent = 'Sending transaction…'
      const r = await createReport(w, { category: String(d.get('category')), region: String(d.get('region')), incidentMs: Date.parse(String(d.get('incident')) + 'T00:00:00Z'), payload, sealed: wantSeal, lock, media })
      const link = `${location.origin}${location.pathname}#/r/${r.entityKey}${keyText ? '/' + keyText : ''}`
      msg.className = 'msg ok'
      msg.replaceChildren(...([ 'Posted. ', txLink(r.txHash), ' · ', h('a', { href: `#/r/${r.entityKey}${keyText ? '/' + keyText : ''}` }, 'Open report'), ' · ', h('a', { href: `#/u/${w.account.address}` }, 'Your profile'),
        keyText ? h('div', { class: 'card' }, h('p', {}, 'Save this share link now. The decryption key is in it and is not stored anywhere else:'), h('code', {}, link)) : null ].filter(Boolean) as (Node | string)[]))
    } catch (err: any) { msg.className = 'msg err'; msg.textContent = err?.shortMessage ?? err?.message ?? String(err); submit.disabled = false }
  } },
    sel('category', 'Category', CATEGORIES), sel('region', 'Region', REGIONS),
    h('label', {}, 'Incident date', h('input', { type: 'date', name: 'incident', required: true, max: dateStr(Date.now()) })),
    h('label', {}, 'Title', h('input', { type: 'text', name: 'title', required: true, maxlength: 140, autocomplete: 'off' })),
    h('label', {}, 'Details', h('textarea', { name: 'body', required: true, maxlength: 20000 })),
    h('label', {}, 'Photo or video (optional). The file itself is not uploaded anywhere. Its fingerprint (SHA-256 hash) is recorded and is public. Choosing an image or video ticks the preview box below; untick it if you only want the fingerprint recorded.', h('input', { type: 'file', name: 'media', accept: 'image/*,video/*', onchange: (ev: Event) => {
      // Choosing an image or a video ticks the preview box (people expect an attached picture to be shown).
      const f = (ev.target as HTMLInputElement).files?.[0]
      const box = form.querySelector<HTMLInputElement>('input[name=embed]')
      if (box) box.checked = !!f && (f.type.startsWith('image/') || f.type.startsWith('video/'))
    } })),
    h('label', {}, 'Where the image is hosted (optional https link, up to 128 bytes). Readers can load it from there after a click, and it is checked against the fingerprint when the host allows.', h('input', { type: 'url', name: 'media_url', maxlength: 128, autocomplete: 'off', placeholder: 'https://' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'embed' }), h('span', {}, 'Also store a small preview picture on Arkiv (for a video, one still frame), shrunk to about 60 KB with location data removed, so it can be shown here. It is public, and permanent if you also lock the report. Only use pictures and videos you have the right to publish. It appears on the homepage only after reviewers verify the report. The video itself is never stored.')),
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
      // With the default address we use the same connection as the rest of this site (it carries an Arkiv access key, because the
      // anonymous query budget is usually empty). Any other address is queried exactly as typed, with no key.
      const url = rpc.value.trim()
      const useSite = url === 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
      const c = useSite ? publicHttp : clientFor(url)
      const [block, res] = await Promise.all([c.getBlockNumber(), c.query(q, { select: { key: true, creator: true }, limit: 100 })])
      out.textContent = `RPC:   ${url}${useSite ? '  (this site adds an Arkiv access key for its rate limit)' : ''}\nblock: ${block}\nquery: ${q}\nmatched ${res.entities.length} report(s)\n\n` + res.entities.slice(0, 20).map(x => `${x.key}  creator ${x.creator}`).join('\n')
    } catch (err: any) { out.textContent = 'Failed: ' + rpcMessage(err) } finally { run.disabled = false }
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
      h('li', {}, 'A matching file fingerprint shows a photo or video is unchanged since it was recorded. It does not show the content is genuine, and it cannot detect a forgery that was recorded as-is.'),
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
    h('p', { class: 'meta' }, 'Reports here are synthetic test data, or short sample news summaries written for this demo with a link to the original source. Nothing is verified unless it says Verified.')))
}

async function profileView(address: string) {
  setNav('me'); onLive = undefined
  const mine = (await connectedAddress())?.toLowerCase() === address.toLowerCase()
  const head1 = h('div', { class: 'profilehead' }, h('h1', {}, mine ? 'Your profile' : 'Profile'), mine ? h('span', { class: 'chip ok' }, 'connected wallet') : null)
  show(head1, h('p', { class: 'meta' }, h('span', {}, 'Wallet '), addrLink(address)), h('div', { class: 'skeleton' }))
  try {
    await refreshState()
    const { reports, trusted } = await cached('u:' + address.toLowerCase(), 45_000, async () => {
      const [reports, trusted] = await Promise.all([listReportsBy(address), listTrustedReviews(allow)])
      return { reports, trusted }
    })
    const reviews = groupReviews(trusted)
    const verified = reports.filter(r => statusOf(reviews, r.key as string) === 'verified').length
    show(head1,
      h('p', { class: 'meta' }, h('span', {}, 'Wallet '), addrLink(address), h('span', {}, `${reports.length} report${reports.length === 1 ? '' : 's'}`), h('span', {}, `${verified} verified`)),
      h('p', { class: 'lede' }, 'A profile is just every report created by this wallet, read from the network. Nothing here is verified by default: a report shows as Unverified until at least 2 allowlisted reviewers corroborate it.'),
      reports.length
        ? h('div', { class: 'grid3' }, ...reports.map(r => card(r, statusOf(reviews, r.key as string), 'mid')))
        : h('div', { class: 'empty' }, h('p', {}, 'This wallet has not posted any reports.'), mine ? h('a', { class: 'btn', href: '#/post' }, 'Post a report') : null))
  } catch (e: any) {
    show(h('div', { class: 'empty' }, h('p', {}, rpcMessage(e)), h('button', { onclick: () => { cache.clear(); profileView(address) } }, 'Try again')))
  }
}

async function meView() {
  setNav('me'); onLive = undefined
  const a = await connectedAddress()
  if (a) { location.replace('#/u/' + a); return }
  const msg = h('p', { class: 'msg', role: 'status' })
  const btn = h('button', { onclick: async () => {
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Waiting for your wallet…'
    try { const w = await connectWallet(); location.hash = '#/u/' + w.account.address } catch (err: any) {
      msg.className = 'msg err'; msg.textContent = err?.shortMessage ?? err?.message ?? String(err); btn.disabled = false
    }
  } }, 'Connect wallet')
  show(h('h1', {}, 'Your profile'),
    h('p', { class: 'lede' }, 'There are no accounts or passwords here. Your wallet address is your identity: connect it to see everything it has posted. Connecting only shares your public address with this page. It signs nothing and moves no funds.'),
    btn, msg)
}

// ---------- router ----------
async function route() {
  rerender = undefined
  const hash = location.hash || '#/'
  window.scrollTo(0, 0)
  try {
    const m = hash.match(/^#\/r\/(0x[0-9a-fA-F]{64})(?:\/([^?]+))?/)
    const u = hash.match(/^#\/u\/(0x[0-9a-fA-F]{40})/)
    if (m) await detailView(m[1] as `0x${string}`, m[2] ? decodeURIComponent(m[2]) : undefined)
    else if (u) await profileView(u[1])
    else if (hash.startsWith('#/me')) await meView()
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
  drawer.replaceChildren(...CATEGORIES.map(c => h('a', { href: `#/?c=${c}` }, label(c))), h('a', { href: '#/post' }, 'Post a report'), h('a', { href: '#/me' }, 'Profile'), h('a', { href: '#/proof' }, 'Proof'))
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
