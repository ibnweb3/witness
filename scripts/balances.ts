import { formatEther } from 'viem'
import { balanceOf, wallet } from './lib'
for (const r of ['ADMIN_KEY', 'REPORTER_KEY', 'REVIEWER_KEY']) {
  const w = wallet(r)
  console.log(r.replace('_KEY', '').padEnd(9), w.account!.address, formatEther(await balanceOf(w.account!.address)), 'GLM')
}
