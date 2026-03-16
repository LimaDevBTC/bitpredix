import { request } from '@stacks/connect'
import { makeUnsignedContractCall, ClarityValue, PostConditionMode } from '@stacks/transactions'

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

// ---------------------------------------------------------------------------
// Nonce tracking — prevents ConflictingNonceInMempool when placing multiple
// bets in rapid succession (before previous txs confirm on-chain).
// ---------------------------------------------------------------------------
const nonceTracker = new Map<string, { nonce: bigint; ts: number }>()
const NONCE_TTL_MS = 120_000 // expire after 2 min (Stacks testnet blocks ~10-60s)

/**
 * Constroi uma tx sponsored unsigned, pede a wallet para assinar,
 * e envia para /api/sponsor para sponsorar e broadcastar.
 * Retorna o txid.
 */
export async function sponsoredContractCall(params: {
  contractAddress: string
  contractName: string
  functionName: string
  functionArgs: ClarityValue[]
  publicKey: string
}): Promise<string> {
  // Check for tracked nonce from a recent successful broadcast
  const tracked = nonceTracker.get(params.publicKey)
  const pendingNonce = (tracked && Date.now() - tracked.ts < NONCE_TTL_MS)
    ? tracked.nonce
    : undefined

  // 1. Construir tx unsigned com sponsored=true e fee=0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txOptions: any = {
    contractAddress: params.contractAddress,
    contractName: params.contractName,
    functionName: params.functionName,
    functionArgs: params.functionArgs,
    publicKey: params.publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  }
  if (pendingNonce !== undefined) {
    txOptions.nonce = pendingNonce
  }

  let unsignedTx
  try {
    unsignedTx = await makeUnsignedContractCall(txOptions)
  } catch (err) {
    const msg = (err as Error).message || String(err)
    // makeUnsignedContractCall fetches nonce from Hiro — can fail with network errors
    if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
      throw new Error('Network error building transaction. Please try again.')
    }
    throw err
  }
  const txHex = unsignedTx.serialize()

  // 2. Pedir a wallet para assinar via stx_signTransaction (SIP-030 direto)
  // Usa request() ao inves de openSignTransaction() para enviar apenas os params
  // que Xverse aceita ({ transaction, broadcast }) sem extras que causam "Invalid parameters."
  //
  // Preserva o estado de sessao do @stacks/connect: a lib v8 armazena sessao como
  // hex-encoded JSON e request() pode alterar/reescrever esse dado, causando
  // isConnected()/getLocalStorage() a retornar dados diferentes (formato de endereco,
  // etc), o que faz o polling do MarketCardV4 resetar tradingEnabled.
  const CONNECT_KEY = '@stacks/connect'
  const savedSession = localStorage.getItem(CONNECT_KEY)

  const result = await request('stx_signTransaction', {
    transaction: txHex,
    broadcast: false,
  })
  const signedHex = result.transaction

  // Restaura sessao se foi alterada pelo request()
  if (savedSession && localStorage.getItem(CONNECT_KEY) !== savedSession) {
    localStorage.setItem(CONNECT_KEY, savedSession)
  }

  // 3. Enviar para /api/sponsor para sponsorar e broadcastar
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex: signedHex }),
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    // On failure, clear tracked nonce so next call re-fetches from network
    nonceTracker.delete(params.publicKey)
    throw new Error(data.error || `Sponsor failed (${res.status})`)
  }

  // On success: track next expected nonce for this user
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usedNonce = BigInt((unsignedTx.auth as any).spendingCondition?.nonce ?? 0)
    nonceTracker.set(params.publicKey, { nonce: usedNonce + BigInt(1), ts: Date.now() })
  } catch {
    // If nonce extraction fails, clear tracker — next call will re-fetch
    nonceTracker.delete(params.publicKey)
  }

  return data.txid
}
