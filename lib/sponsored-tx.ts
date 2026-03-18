import { request } from '@stacks/connect'
import { ClarityValue, serializeCV } from '@stacks/transactions'
import { NETWORK_NAME } from './config'

const PUBLIC_KEY_STORAGE = 'stx_public_key'

/** Retorna a publicKey salva do user ou null */
export function getSavedPublicKey(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(PUBLIC_KEY_STORAGE)
}

/** Salva a publicKey no localStorage */
export function savePublicKey(publicKey: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PUBLIC_KEY_STORAGE, publicKey)
  }
}

/**
 * Uses stx_callContract with sponsored=true so the WALLET builds and signs
 * the transaction from scratch (avoiding serialization incompatibilities).
 * Then sends the signed hex to /api/sponsor for sponsoring + broadcast.
 */
export async function sponsoredContractCall(params: {
  contractAddress: string
  contractName: string
  functionName: string
  functionArgs: ClarityValue[]
  publicKey: string
}): Promise<string> {
  const contract = `${params.contractAddress}.${params.contractName}` as `${string}.${string}`

  // Serialize ClarityValues to hex strings for the wallet
  const serializedArgs = params.functionArgs.map(arg => serializeCV(arg))

  // Preserve @stacks/connect session (wallet request can overwrite it)
  const CONNECT_KEY = '@stacks/connect'
  const savedSession = localStorage.getItem(CONNECT_KEY)

  // stx_callContract with sponsored=true: wallet builds + signs, does NOT broadcast
  const result = await request('stx_callContract', {
    contract,
    functionName: params.functionName,
    functionArgs: serializedArgs,
    network: NETWORK_NAME === 'mainnet' ? 'mainnet' : 'testnet',
    sponsored: true,
  })

  // Restore session if wallet overwrote it
  if (savedSession && localStorage.getItem(CONNECT_KEY) !== savedSession) {
    localStorage.setItem(CONNECT_KEY, savedSession)
  }

  const signedHex = result.transaction
  if (!signedHex) {
    throw new Error('Wallet did not return a signed transaction')
  }

  // Send to /api/sponsor for sponsoring + broadcast
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex: signedHex }),
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    throw new Error(data.error || `Sponsor failed (${res.status})`)
  }

  return data.txid
}
