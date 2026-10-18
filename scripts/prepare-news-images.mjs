// Downloads the chosen freely licensed Wikimedia Commons pictures, shrinks each under ~56 KB (JPEG, no metadata), and records the credit.
// Output: scripts/news-images/NN.jpg and scripts/news-images/credits.json (author, licence, links) used by seed-news.ts.
import { execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const UA = { 'user-agent': 'WitNessHackathonBot/1.0 (ibnweb3@gmail.com)' }
const cands = { ...JSON.parse(readFileSync('scripts/.img/cands.json', 'utf8')), ...JSON.parse(readFileSync('scripts/.img/cands_security.json', 'utf8')) }
// news.json item index -> [topic, candidate number]
const picks = [['obesity', 2], ['bloodpressure', 3], ['mentalhealth', 5], ['biodiversity', 6], ['ocean', 3], ['press', 4], ['shutdown', 1], ['uk', 6], ['data', 2], ['security', 1]]
const items = JSON.parse(readFileSync('scripts/news.json', 'utf8'))
const OUT = 'scripts/news-images'
mkdirSync(OUT, { recursive: true })
const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const credits = []
for (let i = 0; i < picks.length; i++) {
  const [topic, n] = picks[i]
  const c = cands[topic][n - 1]
  // ask Commons for an 800 px rendition
  const u = new URL('https://commons.wikimedia.org/w/api.php')
  u.search = new URLSearchParams({ action: 'query', titles: c.title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800', format: 'json', formatversion: '2' })
  const j = await (await fetch(u, { headers: UA })).json()
  const ii = j.query.pages[0].imageinfo[0]
  const m = ii.extmetadata
  const raw = `${OUT}/raw_${i}.jpg`
  const r = await fetch(ii.thumburl, { headers: UA })
  if (!r.ok) throw new Error('download failed ' + c.title)
  await finished(Readable.fromWeb(r.body).pipe(createWriteStream(raw)))
  // shrink: widths and qualities until it fits
  const file = `${OUT}/${String(i + 1).padStart(2, '0')}.jpg`
  let done = false
  for (const w of [800, 700, 600, 520, 440, 380]) {
    for (const q of [5, 8, 11, 14, 18]) {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `scale=${w}:-2`, '-map_metadata', '-1', '-q:v', String(q), file])
      if (statSync(file).size <= 56_000) { done = true; break }
    }
    if (done) break
  }
  if (!done) throw new Error('could not shrink ' + c.title)
  const [wh] = [execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim()]
  const [w, h] = wh.split(',').map(Number)
  credits.push({
    item: i, file, w, h, bytes: statSync(file).size,
    title: strip(c.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')),
    author: strip(m.Artist?.value).slice(0, 80) || 'Unknown',
    license: m.LicenseShortName?.value, licenseUrl: m.LicenseUrl?.value ?? '', page: ii.descriptionurl,
  })
  console.log(String(i + 1).padStart(2), items[i].title.slice(0, 40).padEnd(40), `${w}x${h} ${(statSync(file).size / 1024).toFixed(0)} KB`, credits[i].license, '|', credits[i].author)
  await new Promise((r2) => setTimeout(r2, 500))
}
writeFileSync(`${OUT}/credits.json`, JSON.stringify(credits, null, 1))
