import { NextResponse } from 'next/server'
import {
  makeContractCall,

  uintCV,
  stringAsciiCV,
  standardPrincipalCV,
  cvToHex,
  tupleCV,
  hexToCV,
  cvToJSON,
} from '@stacks/transactions'
import { STACKS_TESTNET } from '@stacks/network'
import { generateWallet, getStxAddress } from '@stacks/wallet-sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const CONTRACT_ADDRESS = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const CONTRACT_NAME = 'predixv1'
const HIRO_API = 'https://api.testnet.hiro.so'
const PYTH_BENCHMARKS = 'https://benchmarks.pyth.network'
const TX_FEE = BigInt(50000) // 0.05 STX

interface RoundData {
  totalUp: number
  totalDown: number
  priceStart: number
  priceEnd: number
  resolved: boolean
}

interface BetData {
  amount: number
  claimed: boolean
}

interface LogEntry {
  action: string
  detail: string
  txId?: string
  error?: string
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

async function fetchJson(url: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.json() as Promise<Record<string, unknown>>
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// WALLET
// ---------------------------------------------------------------------------

async function initWallet() {
  const mnemonic = process.env.ORACLE_MNEMONIC
  if (!mnemonic) throw new Error('ORACLE_MNEMONIC not configured')

  const wallet = await generateWallet({ secretKey: mnemonic, password: '' })
  const account = wallet.accounts[0]
  const privateKey = account.stxPrivateKey
  const address = getStxAddress({ account, network: 'testnet' })

  return { privateKey, address }
}

async function getNonce(address: string): Promise<number> {
  const data = await fetchJson(`${HIRO_API}/extended/v1/address/${address}/nonces`)
  return (data as { possible_next_nonce: number }).possible_next_nonce
}

// ---------------------------------------------------------------------------
// BROADCAST
// ---------------------------------------------------------------------------

async function broadcastTx(tx: { serialize: () => string; txid: () => string }): Promise<string> {
  const hexTx = tx.serialize()
  const binaryTx = Buffer.from(hexTx, 'hex')

  const res = await fetch(`${HIRO_API}/v2/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: binaryTx,
  })
  const text = await res.text()

  let data: Record<string, string>
  try {
    data = JSON.parse(text)
  } catch {
    data = { txid: text.trim().replace(/"/g, '') }
  }

  if (data.error) {
    throw new Error(`Broadcast failed: ${data.error} — ${data.reason || ''}`)
  }

  return data.txid || tx.txid()
}

async function waitForMempool(txId: string, maxWaitMs = 15000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fetchJson(`${HIRO_API}/extended/v1/tx/${txId}`)
      if ((data as { tx_status?: string }).tx_status) {
        return (data as { tx_status: string }).tx_status
      }
    } catch { /* not found yet */ }
    await sleep(2000)
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// ON-CHAIN READS
// ---------------------------------------------------------------------------

async function readRound(roundId: number): Promise<RoundData | null> {
  const keyHex = cvToHex(tupleCV({ 'round-id': uintCV(roundId) }))
  try {
    const data = await fetchJson(
      `${HIRO_API}/v2/map_entry/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/rounds?proof=0`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keyHex),
      }
    )
    if (!data.data) return null
    const cv = hexToCV(data.data as string)
    const json = cvToJSON(cv)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (json as any).value
    if (v === null || v === undefined) return null
    return {
      totalUp: Number(v['total-up']?.value ?? 0),
      totalDown: Number(v['total-down']?.value ?? 0),
      priceStart: Number(v['price-start']?.value ?? 0),
      priceEnd: Number(v['price-end']?.value ?? 0),
      resolved: v.resolved?.value === true || String(v.resolved?.value) === 'true',
    }
  } catch {
    return null
  }
}

async function readRoundBettors(roundId: number): Promise<string[]> {
  try {
    const data = await fetchJson(
      `${HIRO_API}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/get-round-bettors`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: CONTRACT_ADDRESS,
          arguments: [cvToHex(uintCV(roundId))],
        }),
      }
    )
    if (!data.result) return []
    const cv = hexToCV(data.result as string)
    const json = cvToJSON(cv)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bettorsList = (json as any).value?.bettors?.value
    if (!Array.isArray(bettorsList)) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return bettorsList.map((b: any) => b.value)
  } catch {
    return []
  }
}

async function readUserBets(roundId: number, bettor: string): Promise<{ up: BetData | null; down: BetData | null }> {
  try {
    const data = await fetchJson(
      `${HIRO_API}/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/get-user-bets`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: CONTRACT_ADDRESS,
          arguments: [
            cvToHex(uintCV(roundId)),
            cvToHex(standardPrincipalCV(bettor)),
          ],
        }),
      }
    )
    if (!data.result) return { up: null, down: null }
    const cv = hexToCV(data.result as string)
    const json = cvToJSON(cv)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (json as any).value

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseSide = (side: any): BetData | null => {
      if (!side || side.value === null || side.value === undefined) return null
      const sv = side.value
      return {
        amount: Number(sv.amount?.value ?? 0),
        claimed: sv.claimed?.value === true || String(sv.claimed?.value) === 'true',
      }
    }

    return {
      up: parseSide(v?.up),
      down: parseSide(v?.down),
    }
  } catch {
    return { up: null, down: null }
  }
}

// ---------------------------------------------------------------------------
// PYTH PRICES
// ---------------------------------------------------------------------------

function findClosestCandleIndex(timestamps: number[], target: number): number {
  let closest = 0
  let minDiff = Math.abs(timestamps[0] - target)
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - target)
    if (diff < minDiff) {
      minDiff = diff
      closest = i
    }
  }
  return closest
}

async function fetchRoundPrices(roundId: number): Promise<{ priceStart: number; priceEnd: number }> {
  const roundStartTs = roundId * 60
  const roundEndTs = (roundId + 1) * 60

  const url = `${PYTH_BENCHMARKS}/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1&from=${roundStartTs - 120}&to=${roundEndTs + 120}`
  const data = await fetchJson(url) as { s: string; t?: number[]; o?: number[]; c?: number[] }

  if (data.s !== 'ok' || !data.t || data.t.length === 0) {
    throw new Error(`Pyth returned no data for round ${roundId}`)
  }

  const startIdx = findClosestCandleIndex(data.t, roundStartTs)
  const endIdx = findClosestCandleIndex(data.t, roundEndTs)

  let priceStart: number, priceEnd: number
  if (startIdx === endIdx) {
    priceStart = data.o![startIdx]
    priceEnd = data.c![endIdx]
  } else {
    priceStart = data.c![startIdx]
    priceEnd = data.c![endIdx]
  }

  return {
    priceStart: Math.round(priceStart * 100),
    priceEnd: Math.round(priceEnd * 100),
  }
}

// ---------------------------------------------------------------------------
// PROCESS ROUND
// ---------------------------------------------------------------------------

async function processRound(
  roundId: number,
  nonce: number,
  privateKey: string,
  log: LogEntry[]
): Promise<number> {
  let currentNonce = nonce

  // 1. Read round on-chain
  const round = await readRound(roundId)
  if (!round || (round.totalUp + round.totalDown === 0)) {
    log.push({ action: 'skip', detail: `Round ${roundId}: empty or not found` })
    return currentNonce
  }

  log.push({
    action: 'read',
    detail: `Round ${roundId}: UP=$${(round.totalUp / 1e6).toFixed(2)} DOWN=$${(round.totalDown / 1e6).toFixed(2)} resolved=${round.resolved}`,
  })

  let priceStart: number, priceEnd: number

  if (!round.resolved) {
    // 2. Fetch Pyth prices
    try {
      const prices = await fetchRoundPrices(roundId)
      priceStart = prices.priceStart
      priceEnd = prices.priceEnd
    } catch (e) {
      log.push({ action: 'error', detail: `Round ${roundId}: Pyth prices unavailable`, error: String(e) })
      return currentNonce
    }

    const outcome = priceEnd > priceStart ? 'UP' : 'DOWN'
    log.push({ action: 'prices', detail: `start=${priceStart} end=${priceEnd} outcome=${outcome}` })

    // 3. Resolve round
    try {
      const tx = await makeContractCall({
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: 'resolve-round',
        functionArgs: [uintCV(roundId), uintCV(priceStart), uintCV(priceEnd)],
        senderKey: privateKey,
        network: STACKS_TESTNET,

        fee: TX_FEE,
        nonce: BigInt(currentNonce),
      })
      const txId = await broadcastTx(tx)
      log.push({ action: 'resolve-round', detail: `Round ${roundId}`, txId })
      await waitForMempool(txId)
      currentNonce++
    } catch (e) {
      log.push({ action: 'error', detail: `resolve-round failed for ${roundId}`, error: String(e) })
      return currentNonce
    }
  } else {
    priceStart = round.priceStart
    priceEnd = round.priceEnd
    log.push({ action: 'already-resolved', detail: `Round ${roundId}: start=${priceStart} end=${priceEnd}` })
  }

  // 4. Read bettors
  const bettors = await readRoundBettors(roundId)
  if (bettors.length === 0) {
    log.push({ action: 'skip', detail: `Round ${roundId}: no bettors` })
    return currentNonce
  }

  log.push({ action: 'bettors', detail: `${bettors.length} bettor(s) found` })

  // 5. Claim on behalf of each bettor
  for (const bettor of bettors) {
    const userBets = await readUserBets(roundId, bettor)

    for (const side of ['UP', 'DOWN'] as const) {
      const bet = side === 'UP' ? userBets.up : userBets.down
      if (!bet || bet.claimed) continue

      try {
        const tx = await makeContractCall({
          contractAddress: CONTRACT_ADDRESS,
          contractName: CONTRACT_NAME,
          functionName: 'claim-on-behalf',
          functionArgs: [
            standardPrincipalCV(bettor),
            uintCV(roundId),
            stringAsciiCV(side),
            uintCV(priceStart),
            uintCV(priceEnd),
          ],
          senderKey: privateKey,
          network: STACKS_TESTNET,
  
          fee: TX_FEE,
          nonce: BigInt(currentNonce),
        })
        const txId = await broadcastTx(tx)
        log.push({ action: 'claim-on-behalf', detail: `${bettor.slice(0, 8)}... ${side}`, txId })
        await waitForMempool(txId)
        currentNonce++
      } catch (e) {
        log.push({ action: 'error', detail: `claim-on-behalf ${bettor.slice(0, 8)}... ${side}`, error: String(e) })
      }
    }
  }

  return currentNonce
}

// ---------------------------------------------------------------------------
// ROUTE HANDLER
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  // Authenticate: Vercel Cron sends Authorization header with CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const log: LogEntry[] = []
  const startTime = Date.now()

  try {
    // Init wallet
    const { privateKey, address } = await initWallet()
    log.push({ action: 'init', detail: `Wallet: ${address.slice(0, 8)}...` })

    // Determine round to process (the one that just ended)
    const currentRoundId = Math.floor(Date.now() / 60000)
    const previousRoundId = currentRoundId - 1

    log.push({ action: 'target', detail: `Processing round ${previousRoundId}` })

    // Get nonce
    const nonce = await getNonce(address)

    // Process the round
    await processRound(previousRoundId, nonce, privateKey, log)

  } catch (e) {
    log.push({ action: 'fatal', detail: 'Unhandled error', error: e instanceof Error ? e.message : String(e) })
  }

  const duration = Date.now() - startTime
  return NextResponse.json({ ok: true, duration, log })
}
