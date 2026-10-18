// Posts the 3 final sample news items in scripts/news3.json from the same "news desk" wallet, in file order (the last item posted is the newest).
// Each report: a short summary in our own words, the original source (publisher, title, https link, dates), and a small freely licensed
// Wikimedia Commons picture with its credit. Everything starts Unverified. No publisher photos are used.
import { appendFileSync, readFileSync } from 'node:fs'
import { formatEther } from 'viem'
import { balanceOf, wallet } from './lib'
import { createReport } from '../src/lib/write'
import { EXPLORER } from '../src/config'

const news = wallet('NEWS_KEY')
const addr = news.account!.address
console.log('news desk wallet:', addr, formatEther(await balanceOf(addr)), 'GLM')
const items: any[] = JSON.parse(readFileSync('scripts/news3.json', 'utf8'))
const credits: any[] = JSON.parse(readFileSync('scripts/news-images/credits3.json', 'utf8'))
const retrieved = '2026-10-18'
const rows: string[] = []
for (let i = 0; i < items.length; i++) {
  const it = items[i], cr = credits[i]
  if (!/^https:\/\//.test(it.source.url)) throw new Error('source must be https: ' + it.source.url)
  const jpg = readFileSync(cr.file)
  const r = await createReport(news, {
    category: it.category, region: it.region, incidentMs: Date.parse(it.published + 'T00:00:00Z'), sealed: false,
    payload: {
      v: 1, sealed: false, title: it.title, body: it.body,
      preview: { type: 'image/jpeg', b64: jpg.toString('base64'), w: cr.w, h: cr.h },
      source: { ...it.source, published: it.published, retrieved, image: { credit: `${cr.title} by ${cr.author}`, license: cr.license, url: cr.page } },
    },
  })
  rows.push(`| ${it.title.slice(0, 70).replace(/\|/g, '/')} | \`${r.entityKey}\` | [${r.txHash.slice(0, 10)}…](${EXPLORER}/tx/${r.txHash}) |`)
  console.log(String(i + 1).padStart(2), 'posted:', it.title.slice(0, 64))
}
appendFileSync('arkiv/evidence.md', `\n## Ninth seed: three more sample news items with sources and freely licensed pictures (news desk wallet ${addr})\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n`)
console.log('done.', items.length, 'items; balance', formatEther(await balanceOf(addr)), 'GLM')
