// Finds freely licensed candidate pictures on Wikimedia Commons for each news item (no people, licence recorded).
// Output: scripts/.img/cands.json and numbered 480px JPEG thumbnails per topic for review. Nothing is posted.
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const UA = { 'user-agent': 'WitNessHackathonBot/1.0 (ibnweb3@gmail.com)' }
const OUT = 'scripts/.img'
mkdirSync(OUT, { recursive: true })
const cli = process.argv.slice(2).map((a) => a.split('=')).filter((x) => x.length === 2)
const topics = cli.length ? cli : [
  ['obesity', 'fruits and vegetables market stall'],
  ['bloodpressure', 'sphygmomanometer blood pressure cuff'],
  ['mentalhealth', 'community garden path'],
  ['biodiversity', 'coral reef fish biodiversity'],
  ['ocean', 'ocean waves sea horizon'],
  ['press', 'stack of newspapers'],
  ['shutdown', 'ethernet cables network switch'],
  ['uk', 'Palace of Westminster'],
  ['data', 'documents paper stack desk'],
  ['security', 'padlock on keyboard'],
]
const OK = /^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+)/i
const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const all = {}
for (const [id, q] of topics) {
  const u = new URL('https://commons.wikimedia.org/w/api.php')
  u.search = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '480', format: 'json', formatversion: '2' })
  const j = await (await fetch(u, { headers: UA })).json()
  const c = (j.query?.pages || []).map((p) => { const i = p.imageinfo?.[0]; const m = i?.extmetadata || {}; return { title: p.title, page: i?.descriptionurl, thumb: i?.thumburl, w: i?.width, h: i?.height, mime: i?.mime, license: m.LicenseShortName?.value, licenseUrl: m.LicenseUrl?.value, author: strip(m.Artist?.value).slice(0, 80), desc: strip(m.ImageDescription?.value).slice(0, 90) } })
    .filter((x) => x.mime === 'image/jpeg' && OK.test(x.license || '') && x.w >= 800 && !/\b(man|woman|people|girl|boy|child|portrait|crowd|protest)\b/i.test(x.desc + ' ' + x.title))
    .slice(0, 6)
  all[id] = c
  let n = 0
  for (const x of c) {
    n++
    const r = await fetch(x.thumb, { headers: UA })
    if (!r.ok) { x.thumbFile = null; continue }
    const f = `${OUT}/${id}_${n}.jpg`
    await finished(Readable.fromWeb(r.body).pipe(createWriteStream(f)))
    x.thumbFile = f
    await new Promise((r2) => setTimeout(r2, 400))
  }
  console.log(id.padEnd(14), c.length, 'candidates:', c.map((x) => x.license).join(' | '))
}
writeFileSync(`${OUT}/cands${cli.length ? '_' + cli.map((x) => x[0]).join('_') : ''}.json`, JSON.stringify(all, null, 1))
