import { request } from '@stacks/connect'
import { makeUnsignedContractCall, ClarityValue } from '@stacks/transactions'

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
  // 1. Construir tx unsigned com sponsored=true e fee=0
  const unsignedTx = await makeUnsignedContractCall({
    contractAddress: params.contractAddress,
    contractName: params.contractName,
    functionName: params.functionName,
    functionArgs: params.functionArgs,
    publicKey: params.publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
  })

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
    throw new Error(data.error || `Sponsor failed (${res.status})`)
  }

  return data.txid
}
