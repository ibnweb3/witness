import { createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicHttp } from '../src/lib/arkiv'

export const wallet = (envName: string) => {
  const k = process.env[envName]
  if (!k) throw new Error(`${envName} missing in .env`)
  return createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(k as `0x${string}`) })
}
export const balanceOf = (a: `0x${string}`) => publicHttp.getBalance({ address: a })
