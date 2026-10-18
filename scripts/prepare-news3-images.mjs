// Same as prepare-news-images.mjs, for scripts/news3.json: downloads the chosen freely licensed Commons pictures, shrinks each under ~56 KB
// (JPEG, no metadata) and records the credit. Output: scripts/news-images/2NN.jpg and credits3.json.
import { execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const UA = { 'user-agent': 'WitNessHackathonBot/1.0 (ibnweb3@gmail.com)' }
const dir = 'scripts/.img'
// merge every candidate file, older first, so a later search for the same topic wins
const files = readdirSync(dir).filter((f) => /^cands.*\.json$/.test(f)).map((f) => ({ f, t: statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => a.t - b.t)
const cands = {}
for (const { f } of files) for (const [k, v] of Object.entries(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))) if (v.length) cands[k] = v
const items = JSON.parse(readFileSync('scripts/news3.json', 'utf8'))
const OUT = 'scripts/news-images'
mkdirSync(OUT, { recursive: true })
const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const cleanAuthor = (a) => (strip(a).replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\([^)]*@[^)]*\)/g, '').trim().slice(0, 80)) || 'Unknown'
const credits = []
for (let i = 0; i < items.length; i++) {
  const [topic, n] = items[i].image
  const c = cands[topic]?.[n - 1]
  if (!c) throw new Error(`no candidate ${topic} #${n}`)
  const u = new URL('https://commons.wikimedia.org/w/api.php')
  u.search = new URLSearchParams({ action: 'query', titles: c.title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800', format: 'json', formatversion: '2' })
  const j = await (await fetch(u, { headers: UA })).json()
  const ii = j.query.pages[0].imageinfo[0], m = ii.extmetadata
  const raw = `${OUT}/raw3_${i}.jpg`
  const r = await fetch(ii.thumburl, { headers: UA })
  if (!r.ok) throw new Error('download failed ' + c.title)
  await finished(Readable.fromWeb(r.body).pipe(createWriteStream(raw)))
  const file = `${OUT}/3${String(i + 1).padStart(2, '0')}.jpg`
  let done = false
  for (const w of [800, 700, 600, 520, 440, 380]) {
    for (const q of [5, 8, 11, 14, 18]) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `scale=${w}:-2`, '-map_metadata', '-1', '-q:v', String(q), file])
      if (statSync(file).size <= 56_000) { done = true; break }
    }
    if (done) break
  }
  if (!done) throw new Error('could not shrink ' + c.title)
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  credits.push({ item: i, file, w, h, bytes: statSync(file).size, title: strip(c.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')), author: cleanAuthor(m.Artist?.value), license: m.LicenseShortName?.value, licenseUrl: m.LicenseUrl?.value ?? '', page: ii.descriptionurl })
  console.log(String(i + 1).padStart(2), items[i].title.slice(0, 38).padEnd(38), `${w}x${h} ${(statSync(file).size / 1024).toFixed(0)}KB`, credits[i].license, '|', credits[i].author.slice(0, 30))
  await new Promise((r2) => setTimeout(r2, 450))
}
writeFileSync(`${OUT}/credits3.json`, JSON.stringify(credits, null, 1))
