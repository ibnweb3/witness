// Posts the sample news items in scripts/news.json from a dedicated "news desk" wallet (created here, funded from our own test wallet).
// Each report holds a short summary written for this demo (not the article), plus the original source (publisher, title, https link, dates).
// Nothing is verified: every item starts Unverified like any other report. No photos from news sites are used.
import { appendFileSync, readFileSync } from 'node:fs'
import { createWalletClient, formatEther, http, parseEther } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { publicHttp } from '../src/lib/arkiv'
import { balanceOf, wallet } from './lib'
import { createReport } from '../src/lib/write'
import { EXPLORER } from '../src/config'

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
const retrieved = '2026-10-18'
const rows: string[] = []
for (const it of items) {
  if (!/^https:\/\//.test(it.source.url)) throw new Error('source must be https: ' + it.source.url)
  const r = await createReport(news, {
    category: it.category, region: it.region, incidentMs: Date.parse(it.published + 'T00:00:00Z'), sealed: false,
    payload: { v: 1, sealed: false, title: it.title, body: it.body, source: { ...it.source, published: it.published, retrieved } },
  })
  rows.push(`| ${it.title.slice(0, 70).replace(/\|/g, '/')} | \`${r.entityKey}\` | [${r.txHash.slice(0, 10)}…](${EXPLORER}/tx/${r.txHash}) |`)
  console.log('posted:', it.title.slice(0, 70))
}
appendFileSync('arkiv/evidence.md', `\n## Sixth seed: sample news items with sources (posted by the news desk wallet ${addr})\n\n| What | Entity key | Tx |\n|---|---|---|\n${rows.join('\n')}\n`)
console.log('done.', items.length, 'items; evidence appended.')
