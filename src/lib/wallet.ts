import { createWalletClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { custom } from 'viem'
import { EXPLORER } from '../config'

/** Connect an injected wallet (e.g. MetaMask), switch/add Tiramisu, return a wallet client. */
export async function connectWallet() {
  const eth = (window as any).ethereum
  if (!eth) throw new Error('No browser wallet found. Install one (e.g. MetaMask) to post or extend. Reading needs no wallet.')
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as `0x${string}`[]
  const chainId = '0x' + tiramisu.id.toString(16)
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (e: any) {
    if (e?.code !== 4902) throw e
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId, chainName: 'Arkiv Tiramisu',
        nativeCurrency: tiramisu.nativeCurrency,
        rpcUrls: [...tiramisu.rpcUrls.default.http], blockExplorerUrls: [EXPLORER],
      }],
    })
  }
  return createWalletClient({ chain: tiramisu, transport: custom(eth), account }) as any
}
