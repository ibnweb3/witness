// Posts the sample news items in scripts/news.json from a dedicated "news desk" wallet (created here, funded from our own test wallet).
// Each report holds a short summary written for this demo (not the article), plus the original source (publisher, title, https link, dates).
// Nothing is verified: every item starts Unverified like any other report. No photos from news sites are used.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createWalletClient, formatEther, http, parseEther } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { publicHttp } from '../src/lib/arkiv'
import { balanceOf, wallet } from './lib'
import { createReport } from '../src/lib/write'
import { EXPLORER } from '../src/config'
import { execFileSync } from 'node:child_process'

if (!process.env.NEWS_KEY) {
  const k = generatePrivateKey()
  appendFileSync('.env', `NEWS_KEY=${k}\n`)
  process.env.NEWS_KEY = k
  console.log('generated NEWS_KEY into .env')
}
const news = wallet('NEWS_KEY'), reporter = wallet('REPORTER_KEY')
const addr = news.account!.address
console.log('news desk wallet:', addr)
if ((await balanceOf(addr)) < parseEther('0.2')) {
  const rep = createWalletClient({ chain: tiramisu, transport: http(), account: reporter.account! })
  const hash = await rep.sendTransaction({ to: addr, value: parseEther('1') })
  await publicHttp.waitForTransactionReceipt({ hash })
  console.log('funded the news desk wallet with 1 GLM from our own test wallet')
}
console.log('balance:', formatEther(await balanceOf(addr)), 'GLM')

const items: any[] = JSON.parse(readFileSync('scripts/news.json', 'utf8'))
const credits: any[] = JSON.parse(readFileSync('scripts/news-images/credits.json', 'utf8'))

// REPLACE=1: delete the earlier batch (read from evidence.md) before posting again. The news desk wallet owns those entities.
if (process.env.REPLACE === '1') {
  const ev = readFileSync('arkiv/evidence.md', 'utf8')
  const sec = ev.split('## Sixth seed: sample news items')[1]?.split('\n## ')[0] ?? ''
  const keys = [...sec.matchAll(/`(0x[0-9a-f]{64})`/g)].map((m) => m[1] as `0x${string}`)
  if (keys.length) {
    await news.executeBatch({ deletes: keys.map((entityKey) => ({ entityKey })) })
    console.log('deleted', keys.length, 'earlier news entities')
    writeFileSync('arkiv/evidence.md', ev.replace('## Sixth seed: sample news items', '## (Replaced: these entities were deleted and re-posted with pictures) Sixth seed: sample news items'))
  }
}
const retrieved = '2026-10-18'
const rows: string[] = []
for (const it of items) {
  if (!/^https:\/\//.test(it.source.url)) throw new Error('source must be https: ' + it.source.url)
  const cr = credits[items.indexOf(it)]
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
  console.log('posted:', it.title.slice(0, 70))
}
appendFileSync('arkiv/evidence.md', `\n## Seventh seed: sample news items with sources and freely licensed pictures (posted by the news desk wallet ${addr})\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n`)
console.log('done.', items.length, 'items; evidence appended.')
