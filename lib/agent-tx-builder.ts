/**
 * Agent Transaction Builder — server-side unsigned tx construction
 *
 * Builds unsigned sponsored transactions that agents sign locally
 * with their private key, then POST to /api/sponsor.
 */

import {
  makeUnsignedContractCall,
  uintCV,
  stringAsciiCV,
  boolCV,
  contractPrincipalCV,
  PostConditionMode,
} from '@stacks/transactions'

// Contract addresses (same defaults as sponsor route)
const DEPLOYER = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const GATEWAY_ID = process.env.NEXT_PUBLIC_GATEWAY_CONTRACT_ID || `${DEPLOYER}.predixv2-gateway`
const PREDIXV2_ID = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || `${DEPLOYER}.predixv2`
const USDCX_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || `${DEPLOYER}.test-usdcx`

function splitContractId(id: string): [string, string] {
  const i = id.lastIndexOf('.')
  return [id.slice(0, i), id.slice(i + 1)]
}

interface BuildTxResult {
  txHex: string
  details: {
    contractId: string
    functionName: string
    [key: string]: unknown
  }
}

/**
 * Build unsigned place-bet tx via gateway contract.
 * Agent signs this, then POSTs to /api/sponsor.
 */
export async function buildPlaceBetTx(
  publicKey: string,
  side: 'UP' | 'DOWN',
  amountUsd: number,
  roundId?: number,
): Promise<BuildTxResult> {
  const rid = roundId ?? Math.floor(Date.now() / 1000 / 60)
  const amountMicro = Math.round(amountUsd * 1e6)
  const isEarly = Date.now() - rid * 60 * 1000 < 20_000

  const [gwAddr, gwName] = splitContractId(GATEWAY_ID)

  const tx = await makeUnsignedContractCall({
    contractAddress: gwAddr,
    contractName: gwName,
    functionName: 'place-bet',
    functionArgs: [
      uintCV(rid),
      stringAsciiCV(side),
      uintCV(amountMicro),
      boolCV(isEarly),
    ],
    publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: GATEWAY_ID,
      functionName: 'place-bet',
      roundId: rid,
      side,
      amountMicro,
      isEarly,
    },
  }
}

/**
 * Build unsigned claim tx. Fetches Pyth prices server-side.
 */
export async function buildClaimTx(
  publicKey: string,
  roundId: number,
  side: 'UP' | 'DOWN',
): Promise<BuildTxResult> {
  // Fetch prices from Pyth Benchmarks server-side
  const prices = await fetchRoundPricesServer(roundId)

  const [addr, name] = splitContractId(PREDIXV2_ID)

  const tx = await makeUnsignedContractCall({
    contractAddress: addr,
    contractName: name,
    functionName: 'claim-round-side',
    functionArgs: [
      uintCV(roundId),
      stringAsciiCV(side),
      uintCV(prices.priceStart),
      uintCV(prices.priceEnd),
    ],
    publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: PREDIXV2_ID,
      functionName: 'claim-round-side',
      roundId,
      side,
      priceStart: prices.priceStart,
      priceEnd: prices.priceEnd,
    },
  }
}

/**
 * Build unsigned approve tx (token approval for predixv2 contract).
 */
export async function buildApproveTx(publicKey: string): Promise<BuildTxResult> {
  const [tokenAddr, tokenName] = splitContractId(USDCX_ID)
  const [predixAddr, predixName] = splitContractId(PREDIXV2_ID)

  const MAX_APPROVE = BigInt('1000000000000') // 1M USDCx

  const tx = await makeUnsignedContractCall({
    contractAddress: tokenAddr,
    contractName: tokenName,
    functionName: 'approve',
    functionArgs: [
      contractPrincipalCV(predixAddr, predixName),
      uintCV(MAX_APPROVE),
    ],
    publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: USDCX_ID,
      functionName: 'approve',
      spender: PREDIXV2_ID,
      amount: Number(MAX_APPROVE),
    },
  }
}

/**
 * Build unsigned mint tx (mint test tokens for agent).
 */
export async function buildMintTx(publicKey: string): Promise<BuildTxResult> {
  const [tokenAddr, tokenName] = splitContractId(USDCX_ID)

  const tx = await makeUnsignedContractCall({
    contractAddress: tokenAddr,
    contractName: tokenName,
    functionName: 'mint',
    functionArgs: [],
    publicKey,
    network: 'testnet',
    fee: 0,
    sponsored: true,
    postConditionMode: PostConditionMode.Allow,
  })

  return {
    txHex: tx.serialize(),
    details: {
      contractId: USDCX_ID,
      functionName: 'mint',
    },
  }
}

// ---------------------------------------------------------------------------
// Pyth price fetching (server-side, no /api proxy needed)
// ---------------------------------------------------------------------------

const PYTH_BTC_USD_FEED = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
const BENCHMARKS_URL = 'https://benchmarks.pyth.network'

async function fetchRoundPricesServer(roundId: number): Promise<{ priceStart: number; priceEnd: number }> {
  const startTs = roundId * 60
  const endTs = (roundId + 1) * 60

  const url = `${BENCHMARKS_URL}/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1&from=${startTs - 120}&to=${endTs + 120}`

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Pyth Benchmarks error: ${res.status}`)

  const data = await res.json() as {
    t?: number[]
    o?: number[]
    c?: number[]
    s?: string
  }

  if (data.s !== 'ok' || !data.t?.length || !data.c?.length || !data.o?.length) {
    throw new Error(`No Pyth data for round ${roundId}`)
  }

  const timestamps = data.t
  const opens = data.o
  const closes = data.c

  const startIdx = closestIndex(timestamps, startTs)
  const endIdx = closestIndex(timestamps, endTs)

  let priceStart: number
  let priceEnd: number

  if (startIdx === endIdx) {
    priceStart = opens[startIdx]
    priceEnd = closes[endIdx]
  } else {
    priceStart = closes[startIdx]
    priceEnd = closes[endIdx]
  }

  // Contract expects centavos (price * 100)
  return {
    priceStart: Math.round(priceStart * 100),
    priceEnd: Math.round(priceEnd * 100),
  }
}

function closestIndex(timestamps: number[], target: number): number {
  let best = 0
  let bestDiff = Math.abs(timestamps[0] - target)
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}
