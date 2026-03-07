import { NextRequest, NextResponse } from 'next/server'
import {
  deserializeTransaction,
  sponsorTransaction,
  broadcastTransaction,
  PayloadType,
} from '@stacks/transactions'
import { generateWallet } from '@stacks/wallet-sdk'

// Contratos permitidos para sponsorship
const ALLOWED_CONTRACTS = [
  process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv1',
  process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx',
]

// Funcoes permitidas
const ALLOWED_FUNCTIONS = [
  'place-bet',
  'claim-round-side',
  'approve',
  'mint',
]

// Cache da private key do sponsor (derivada uma vez)
let sponsorKeyCache: string | null = null

async function getSponsorPrivateKey(): Promise<string> {
  if (sponsorKeyCache) return sponsorKeyCache

  const mnemonic = process.env.ORACLE_MNEMONIC
  if (!mnemonic) throw new Error('ORACLE_MNEMONIC not configured')

  const wallet = await generateWallet({ secretKey: mnemonic, password: '' })
  const account = wallet.accounts[0]
  sponsorKeyCache = account.stxPrivateKey
  return sponsorKeyCache
}

// ---------------------------------------------------------------------------
// Sponsor nonce tracking — prevents ConflictingNonceInMempool when multiple
// users (or same user) place bets before previous sponsored txs confirm.
// Uses globalThis to survive Next.js HMR reloads in dev.
// ---------------------------------------------------------------------------
const g = globalThis as unknown as {
  __sponsorNonce?: bigint | null
  __sponsorNonceTs?: number
  __sponsorLock?: Promise<void>
}
g.__sponsorNonce ??= null
g.__sponsorNonceTs ??= 0
g.__sponsorLock ??= Promise.resolve()

const SPONSOR_NONCE_TTL_MS = 120_000 // 2 min

export async function POST(req: NextRequest) {
  // Serialize sponsor+broadcast to prevent concurrent nonce conflicts
  let releaseLock: () => void = () => {}
  const prevLock = g.__sponsorLock!
  g.__sponsorLock = new Promise<void>(resolve => { releaseLock = resolve })

  try {
    // Wait for any previous broadcast to finish
    await prevLock

    const { txHex } = await req.json()

    if (!txHex || typeof txHex !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid txHex' }, { status: 400 })
    }

    // 1. Deserializa a transacao
    const transaction = deserializeTransaction(txHex)

    // 2. Valida que e um contract-call para contratos permitidos
    const payload = transaction.payload
    if (payload.payloadType !== PayloadType.ContractCall) {
      return NextResponse.json({ error: 'Only contract calls are allowed' }, { status: 400 })
    }

    // PayloadType.ContractCall payloads have contractAddress, contractName, functionName
    const contractPayload = payload as {
      payloadType: number
      contractAddress: { hash160: string; type: number; version: number }
      contractName: { content: string; lengthPrefixBytes: number; maxLengthBytes: number; type: number }
      functionName: { content: string; lengthPrefixBytes: number; maxLengthBytes: number; type: number }
    }

    // Build contract ID from the payload
    // contractAddress is a StacksAddress - we need to convert it to string
    // The simpler approach: check if contractName and functionName fields exist
    if (!('contractName' in payload) || !('functionName' in payload)) {
      return NextResponse.json({ error: 'Only contract calls are allowed' }, { status: 400 })
    }

    const contractName = contractPayload.contractName.content
    const functionName = contractPayload.functionName.content

    // To get the string address, we serialize and re-read, or use addressToString
    // Simpler: match by contractName since our contracts have unique names
    const allowedNames = ALLOWED_CONTRACTS.map(c => c.split('.')[1])
    if (!allowedNames.includes(contractName)) {
      return NextResponse.json(
        { error: `Contract ${contractName} not allowed for sponsorship` },
        { status: 403 }
      )
    }

    if (!ALLOWED_FUNCTIONS.includes(functionName)) {
      return NextResponse.json(
        { error: `Function ${functionName} not allowed for sponsorship` },
        { status: 403 }
      )
    }

    // 3. Sponsora a transacao (with tracked nonce if available)
    const sponsorPrivateKey = await getSponsorPrivateKey()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sponsorOpts: any = {
      transaction,
      sponsorPrivateKey,
      fee: BigInt(50000), // 0.05 STX
      network: 'testnet',
    }

    // Use tracked sponsor nonce if recent enough
    if (g.__sponsorNonce !== null && Date.now() - g.__sponsorNonceTs! < SPONSOR_NONCE_TTL_MS) {
      sponsorOpts.sponsorNonce = g.__sponsorNonce
    }

    const sponsoredTx = await sponsorTransaction(sponsorOpts)

    // 4. Broadcasta
    const result = await broadcastTransaction({
      transaction: sponsoredTx,
      network: 'testnet',
    })

    // v7: broadcastTransaction returns { txid } on success, or error object on failure
    if ('txid' in result) {
      console.log('[sponsor] Broadcast OK:', result.txid)

      // Track next sponsor nonce
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auth = sponsoredTx.auth as any
        const usedNonce = BigInt(auth.sponsorSpendingCondition?.nonce ?? auth.sponsorCondition?.nonce ?? 0)
        g.__sponsorNonce = usedNonce + BigInt(1)
        g.__sponsorNonceTs = Date.now()
      } catch {
        g.__sponsorNonce = null
      }

      return NextResponse.json({ txid: result.txid })
    }

    // Error case — clear tracked nonce
    g.__sponsorNonce = null
    console.error('[sponsor] Broadcast failed:', result)
    return NextResponse.json(
      { error: (result as Record<string, unknown>).error ?? 'Broadcast failed', reason: (result as Record<string, unknown>).reason },
      { status: 400 }
    )
  } catch (err: unknown) {
    g.__sponsorNonce = null
    console.error('[sponsor] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    releaseLock()
  }
}
