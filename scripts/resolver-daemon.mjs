/**
 * Predix Resolver Daemon
 *
 * Runs in a continuous loop (~65s interval). For each completed round:
 * 1. Reads round data on-chain
 * 2. Fetches prices from Pyth Benchmarks
 * 3. Calls resolve-round (if not yet resolved)
 * 4. Calls claim-on-behalf for each bettor
 *
 * Deployer wallet pays gas for all txs.
 *
 * Usage: ORACLE_MNEMONIC="..." node scripts/resolver-daemon.mjs
 */

import { execSync } from 'child_process'
import txPkg from '@stacks/transactions'
const {
  makeContractCall,
  AnchorMode,
  uintCV,
  stringAsciiCV,
  standardPrincipalCV,
  cvToHex,
  tupleCV,
  hexToCV,
  cvToJSON,
} = txPkg
import netPkg from '@stacks/network'
const { STACKS_TESTNET } = netPkg
import walletPkg from '@stacks/wallet-sdk'
const { generateWallet, getStxAddress } = walletPkg

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const MNEMONIC = process.env.ORACLE_MNEMONIC
if (!MNEMONIC) {
  console.error('ORACLE_MNEMONIC not set')
  console.error('Usage: ORACLE_MNEMONIC="..." node scripts/resolver-daemon.mjs')
  process.exit(1)
}

const CONTRACT_ADDRESS = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const CONTRACT_NAME = 'predixv1'
const HIRO_API = 'https://api.testnet.hiro.so'
const PYTH_BENCHMARKS = 'https://benchmarks.pyth.network'
const LOOP_INTERVAL_MS = 65_000 // 65 seconds (5s after round ends)
const TX_FEE = 50000n // 0.05 STX per tx

// ---------------------------------------------------------------------------
// WALLET INIT
// ---------------------------------------------------------------------------

const wallet = await generateWallet({ secretKey: MNEMONIC, password: '' })
const account = wallet.accounts[0]
const privateKey = account.stxPrivateKey
const address = getStxAddress({ account, network: 'testnet' })

console.log(`[resolver] Wallet address: ${address}`)
console.log(`[resolver] Contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
console.log(`[resolver] Loop interval: ${LOOP_INTERVAL_MS}ms\n`)

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

let lastProcessedRoundId = null

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`)
  }
  return res.json()
}

async function getNonce() {
  const data = await fetchJson(`${HIRO_API}/extended/v1/address/${address}/nonces`)
  return data.possible_next_nonce
}

async function getStxBalance() {
  const data = await fetchJson(`${HIRO_API}/extended/v1/address/${address}/stx`)
  return Number(data.balance) / 1e6
}

async function broadcastTx(tx) {
  const hexTx = tx.serialize()
  const binaryTx = Buffer.from(hexTx, 'hex')

  const res = await fetch(`${HIRO_API}/v2/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: binaryTx,
  })
  const text = await res.text()

  let data
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

async function waitForMempool(txId, maxWaitMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await fetchJson(`${HIRO_API}/extended/v1/tx/${txId}`)
      if (data.tx_status) return data.tx_status
    } catch { /* not found yet */ }
    await sleep(2500)
  }
  return 'unknown'
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// ON-CHAIN READS
// ---------------------------------------------------------------------------

async function readRound(roundId) {
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
    const cv = hexToCV(data.data)
    const json = cvToJSON(cv)
    // (some { ... }) or (none)
    if (json.value === null || json.value === undefined) return null
    const v = json.value
    return {
      totalUp: Number(v['total-up']?.value ?? 0),
      totalDown: Number(v['total-down']?.value ?? 0),
      priceStart: Number(v['price-start']?.value ?? 0),
      priceEnd: Number(v['price-end']?.value ?? 0),
      resolved: v.resolved?.value === true || String(v.resolved?.value) === 'true',
    }
  } catch (e) {
    console.error(`[resolver] Error reading round ${roundId}:`, e.message)
    return null
  }
}

async function readRoundBettors(roundId) {
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
    const cv = hexToCV(data.result)
    const json = cvToJSON(cv)
    const bettorsList = json.value?.bettors?.value
    if (!Array.isArray(bettorsList)) return []
    return bettorsList.map(b => b.value)
  } catch (e) {
    console.error(`[resolver] Error reading bettors for round ${roundId}:`, e.message)
    return []
  }
}

async function readUserBets(roundId, bettor) {
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
    const cv = hexToCV(data.result)
    const json = cvToJSON(cv)
    const v = json.value

    const parseSide = (side) => {
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
  } catch (e) {
    console.error(`[resolver] Error reading bets for ${bettor} round ${roundId}:`, e.message)
    return { up: null, down: null }
  }
}

// ---------------------------------------------------------------------------
// PYTH PRICES
// ---------------------------------------------------------------------------

function findClosestCandleIndex(timestamps, target) {
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

async function fetchRoundPrices(roundId) {
  const roundStartTs = roundId * 60
  const roundEndTs = (roundId + 1) * 60

  const url = `${PYTH_BENCHMARKS}/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1&from=${roundStartTs - 120}&to=${roundEndTs + 120}`
  const data = await fetchJson(url)

  if (data.s !== 'ok' || !data.t || data.t.length === 0) {
    throw new Error(`Pyth returned no data for round ${roundId} (status: ${data.s})`)
  }

  const timestamps = data.t
  const opens = data.o
  const closes = data.c

  const startIdx = findClosestCandleIndex(timestamps, roundStartTs)
  const endIdx = findClosestCandleIndex(timestamps, roundEndTs)

  let priceStart, priceEnd

  if (startIdx === endIdx) {
    priceStart = opens[startIdx]
    priceEnd = closes[endIdx]
  } else {
    priceStart = closes[startIdx]
    priceEnd = closes[endIdx]
  }

  return {
    priceStart: Math.round(priceStart * 100),
    priceEnd: Math.round(priceEnd * 100),
  }
}

// ---------------------------------------------------------------------------
// TX BUILDERS
// ---------------------------------------------------------------------------

async function sendResolveRound(roundId, priceStart, priceEnd, nonce) {
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'resolve-round',
    functionArgs: [uintCV(roundId), uintCV(priceStart), uintCV(priceEnd)],
    senderKey: privateKey,
    network: STACKS_TESTNET,
    anchorMode: AnchorMode.Any,
    fee: TX_FEE,
    nonce: BigInt(nonce),
  })
  const txId = await broadcastTx(tx)
  console.log(`   [resolve-round] txId=${txId}`)
  await waitForMempool(txId)
  return txId
}

async function sendClaimOnBehalf(user, roundId, side, priceStart, priceEnd, nonce) {
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: 'claim-on-behalf',
    functionArgs: [
      standardPrincipalCV(user),
      uintCV(roundId),
      stringAsciiCV(side),
      uintCV(priceStart),
      uintCV(priceEnd),
    ],
    senderKey: privateKey,
    network: STACKS_TESTNET,
    anchorMode: AnchorMode.Any,
    fee: TX_FEE,
    nonce: BigInt(nonce),
  })
  const txId = await broadcastTx(tx)
  console.log(`   [claim-on-behalf] user=${user} side=${side} txId=${txId}`)
  await waitForMempool(txId)
  return txId
}

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------

async function processRound(roundId, nonce) {
  let currentNonce = nonce

  // 1. Read round on-chain
  const round = await readRound(roundId)
  if (!round || (round.totalUp + round.totalDown === 0)) {
    console.log(`   Round ${roundId}: empty or not found, skipping`)
    return currentNonce
  }

  console.log(`   Round ${roundId}: UP=$${round.totalUp / 1e6} DOWN=$${round.totalDown / 1e6} resolved=${round.resolved}`)

  let priceStart, priceEnd

  if (!round.resolved) {
    // 2. Fetch prices from Pyth
    try {
      const prices = await fetchRoundPrices(roundId)
      priceStart = prices.priceStart
      priceEnd = prices.priceEnd
    } catch (e) {
      console.error(`   Round ${roundId}: failed to fetch Pyth prices: ${e.message}`)
      return currentNonce
    }

    console.log(`   Prices: start=${priceStart} end=${priceEnd} outcome=${priceEnd > priceStart ? 'UP' : 'DOWN'}`)

    // 3. Resolve round
    try {
      await sendResolveRound(roundId, priceStart, priceEnd, currentNonce)
      currentNonce++
    } catch (e) {
      console.error(`   Round ${roundId}: resolve-round failed: ${e.message}`)
      return currentNonce
    }
  } else {
    // Round already resolved — use on-chain prices
    priceStart = round.priceStart
    priceEnd = round.priceEnd
    console.log(`   Already resolved: start=${priceStart} end=${priceEnd}`)
  }

  // 4. Read bettors
  const bettors = await readRoundBettors(roundId)
  if (bettors.length === 0) {
    console.log(`   No bettors found for round ${roundId}`)
    return currentNonce
  }
  console.log(`   Bettors: ${bettors.length} found`)

  // 5. Claim for each bettor
  for (const bettor of bettors) {
    const userBets = await readUserBets(roundId, bettor)

    for (const side of ['UP', 'DOWN']) {
      const bet = side === 'UP' ? userBets.up : userBets.down
      if (!bet || bet.claimed) continue

      try {
        await sendClaimOnBehalf(bettor, roundId, side, priceStart, priceEnd, currentNonce)
        currentNonce++
      } catch (e) {
        console.error(`   claim-on-behalf failed for ${bettor} ${side}: ${e.message}`)
        // Continue with next bettor/side
      }
    }
  }

  return currentNonce
}

async function tick() {
  const now = Date.now()
  const currentRoundId = Math.floor(now / 60000)
  const previousRoundId = currentRoundId - 1

  // Determine rounds to process
  let roundsToProcess
  if (lastProcessedRoundId === null) {
    // First run: only process the immediately previous round
    roundsToProcess = [previousRoundId]
  } else {
    // Catch-up: process all rounds since last processed
    roundsToProcess = []
    for (let r = lastProcessedRoundId + 1; r <= previousRoundId; r++) {
      roundsToProcess.push(r)
    }
  }

  if (roundsToProcess.length === 0) {
    console.log(`[${new Date().toISOString()}] No new rounds to process`)
    return
  }

  // Skip very old rounds (>2h) — Pyth data may be unavailable
  const twoHoursAgoRound = Math.floor((now - 2 * 60 * 60 * 1000) / 60000)
  roundsToProcess = roundsToProcess.filter(r => r >= twoHoursAgoRound)

  if (roundsToProcess.length === 0) {
    console.log(`[${new Date().toISOString()}] All pending rounds are too old (>2h), skipping`)
    lastProcessedRoundId = previousRoundId
    return
  }

  console.log(`\n[${new Date().toISOString()}] Processing ${roundsToProcess.length} round(s): ${roundsToProcess[0]}..${roundsToProcess[roundsToProcess.length - 1]}`)

  // Check balance
  try {
    const balance = await getStxBalance()
    console.log(`   STX balance: ${balance.toFixed(2)} STX`)
    if (balance < 50) {
      console.warn('   WARNING: Low STX balance! Refill from faucet.')
    }
  } catch { /* ignore */ }

  // Fetch nonce once for the batch
  let nonce
  try {
    nonce = await getNonce()
  } catch (e) {
    console.error(`   Failed to fetch nonce: ${e.message}`)
    return
  }

  for (const roundId of roundsToProcess) {
    try {
      nonce = await processRound(roundId, nonce)
    } catch (e) {
      console.error(`   Error processing round ${roundId}: ${e.message}`)
    }
  }

  lastProcessedRoundId = roundsToProcess[roundsToProcess.length - 1]
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

console.log('[resolver] Starting daemon...\n')

// Run immediately, then loop
await tick()

setInterval(async () => {
  try {
    await tick()
  } catch (e) {
    console.error('[resolver] Tick error:', e.message)
  }
}, LOOP_INTERVAL_MS)
