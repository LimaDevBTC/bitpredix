/**
 * Predix Resolver Daemon (v3)
 *
 * Runs in a continuous loop (~65s interval). For each completed round:
 * 1. Reads round data on-chain
 * 2. Fetches prices from Pyth Benchmarks
 * 3. Circuit breaker validation (0.5% threshold)
 * 4. Calls resolve-and-distribute via gateway (single atomic call)
 *
 * Usage: SPONSOR_MNEMONIC="..." node scripts/resolver-daemon.mjs
 */

import txPkg from '@stacks/transactions'
const {
  makeContractCall,
  PostConditionMode,
  uintCV,
  cvToHex,
  tupleCV,
  hexToCV,
  cvToJSON,
} = txPkg
import netPkg from '@stacks/network'
const { STACKS_TESTNET, STACKS_MAINNET } = netPkg
import walletPkg from '@stacks/wallet-sdk'
const { generateWallet, getStxAddress } = walletPkg

// ---------------------------------------------------------------------------
// CONFIG (all from env, no hardcoded addresses)
// ---------------------------------------------------------------------------

const MNEMONIC = process.env.SPONSOR_MNEMONIC || process.env.ORACLE_MNEMONIC
if (!MNEMONIC) {
  console.error('SPONSOR_MNEMONIC not set')
  console.error('Usage: SPONSOR_MNEMONIC="..." node scripts/resolver-daemon.mjs')
  process.exit(1)
}

const NETWORK_NAME = process.env.NEXT_PUBLIC_STACKS_NETWORK || 'testnet'

const GATEWAY_CONTRACT_ID = process.env.NEXT_PUBLIC_GATEWAY_CONTRACT_ID
const BITPREDIX_CONTRACT_ID = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID
if (!GATEWAY_CONTRACT_ID || !BITPREDIX_CONTRACT_ID) {
  console.error('NEXT_PUBLIC_GATEWAY_CONTRACT_ID and NEXT_PUBLIC_BITPREDIX_CONTRACT_ID are required')
  process.exit(1)
}

const [GATEWAY_ADDRESS, GATEWAY_NAME] = GATEWAY_CONTRACT_ID.split('.')
const [CONTRACT_ADDRESS, CONTRACT_NAME] = BITPREDIX_CONTRACT_ID.split('.')
const STACKS_NETWORK = NETWORK_NAME === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET
const HIRO_API = NETWORK_NAME === 'mainnet'
  ? 'https://api.mainnet.hiro.so'
  : 'https://api.testnet.hiro.so'
const PYTH_BENCHMARKS = 'https://benchmarks.pyth.network'
const LOOP_INTERVAL_MS = 65_000
const TX_FEE = BigInt(process.env.SPONSOR_TX_FEE || '50000')

// Circuit breaker
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '0.005')
let circuitBreakerFailures = 0

// ---------------------------------------------------------------------------
// WALLET INIT
// ---------------------------------------------------------------------------

const wallet = await generateWallet({ secretKey: MNEMONIC, password: '' })
const account = wallet.accounts[0]
const privateKey = account.stxPrivateKey
const address = getStxAddress({ account, network: NETWORK_NAME })

console.log(`[resolver] Sponsor: ${address}`)
console.log(`[resolver] Gateway: ${GATEWAY_ADDRESS}.${GATEWAY_NAME}`)
console.log(`[resolver] Market: ${CONTRACT_ADDRESS}.${CONTRACT_NAME}`)
console.log(`[resolver] Network: ${NETWORK_NAME}`)
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
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
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
  try { data = JSON.parse(text) } catch { data = { txid: text.trim().replace(/"/g, '') } }

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

// ---------------------------------------------------------------------------
// PYTH PRICES
// ---------------------------------------------------------------------------

function findClosestCandleIndex(timestamps, target) {
  let closest = 0
  let minDiff = Math.abs(timestamps[0] - target)
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - target)
    if (diff < minDiff) { minDiff = diff; closest = i }
  }
  return closest
}

async function fetchRoundPrices(roundId) {
  const roundStartTs = roundId * 60
  const roundEndTs = (roundId + 1) * 60

  const url = `${PYTH_BENCHMARKS}/v1/shims/tradingview/history?symbol=Crypto.BTC/USD&resolution=1&from=${roundStartTs - 120}&to=${roundEndTs + 120}`
  const data = await fetchJson(url)

  if (data.s !== 'ok' || !data.t || data.t.length === 0) {
    throw new Error(`Pyth returned no data for round ${roundId}`)
  }

  const startIdx = findClosestCandleIndex(data.t, roundStartTs)
  const endIdx = findClosestCandleIndex(data.t, roundEndTs)

  let priceStart, priceEnd
  if (startIdx === endIdx) {
    priceStart = data.o[startIdx]
    priceEnd = data.c[endIdx]
  } else {
    priceStart = data.c[startIdx]
    priceEnd = data.c[endIdx]
  }

  return {
    priceStart: Math.round(priceStart * 100),
    priceEnd: Math.round(priceEnd * 100),
  }
}

// ---------------------------------------------------------------------------
// CIRCUIT BREAKER
// ---------------------------------------------------------------------------

function validatePrices(priceStart, priceEnd) {
  const change = Math.abs(priceEnd - priceStart) / priceStart
  if (change > PRICE_CHANGE_THRESHOLD) {
    return { valid: false, reason: `Price change ${(change * 100).toFixed(2)}% exceeds ${PRICE_CHANGE_THRESHOLD * 100}% threshold` }
  }
  // Sanity range
  if (priceEnd < 10_000 * 100 || priceEnd > 500_000 * 100) {
    return { valid: false, reason: `Price ${priceEnd} outside sane range` }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// PROCESS ROUND — resolve-and-distribute via gateway
// ---------------------------------------------------------------------------

async function processRound(roundId, nonce) {
  let currentNonce = nonce

  const round = await readRound(roundId)
  if (!round || (round.totalUp + round.totalDown === 0)) {
    console.log(`   Round ${roundId}: empty or not found, skipping`)
    return currentNonce
  }

  if (round.resolved) {
    console.log(`   Round ${roundId}: already resolved`)
    return currentNonce
  }

  console.log(`   Round ${roundId}: UP=$${round.totalUp / 1e6} DOWN=$${round.totalDown / 1e6}`)

  // Fetch prices
  let priceStart, priceEnd
  try {
    const prices = await fetchRoundPrices(roundId)
    priceStart = prices.priceStart
    priceEnd = prices.priceEnd
  } catch (e) {
    console.error(`   Round ${roundId}: Pyth prices unavailable: ${e.message}`)
    return currentNonce
  }

  const outcome = priceEnd > priceStart ? 'UP' : priceEnd < priceStart ? 'DOWN' : 'TIE'
  console.log(`   Prices: start=${priceStart} end=${priceEnd} outcome=${outcome}`)

  // Circuit breaker
  const validation = validatePrices(priceStart, priceEnd)
  if (!validation.valid) {
    circuitBreakerFailures++
    console.error(`   [CIRCUIT-BREAKER] Skipping round ${roundId}: ${validation.reason} (consecutive=${circuitBreakerFailures})`)
    return currentNonce
  }
  circuitBreakerFailures = 0

  // Call resolve-and-distribute via gateway
  try {
    const tx = await makeContractCall({
      contractAddress: GATEWAY_ADDRESS,
      contractName: GATEWAY_NAME,
      functionName: 'resolve-and-distribute',
      functionArgs: [uintCV(roundId), uintCV(priceStart), uintCV(priceEnd)],
      senderKey: privateKey,
      network: STACKS_NETWORK,
      postConditionMode: PostConditionMode.Allow,
      fee: TX_FEE,
      nonce: BigInt(currentNonce),
    })
    const txId = await broadcastTx(tx)
    console.log(`   [resolve-and-distribute] txId=${txId}`)
    await waitForMempool(txId)
    currentNonce++
  } catch (e) {
    console.error(`   Round ${roundId}: resolve-and-distribute failed: ${e.message}`)
  }

  return currentNonce
}

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------

async function tick() {
  const now = Date.now()
  const currentRoundId = Math.floor(now / 60000)
  const previousRoundId = currentRoundId - 1

  let roundsToProcess
  if (lastProcessedRoundId === null) {
    roundsToProcess = [previousRoundId]
  } else {
    roundsToProcess = []
    for (let r = lastProcessedRoundId + 1; r <= previousRoundId; r++) {
      roundsToProcess.push(r)
    }
  }

  if (roundsToProcess.length === 0) {
    console.log(`[${new Date().toISOString()}] No new rounds to process`)
    return
  }

  // Skip old rounds (>2h)
  const twoHoursAgoRound = Math.floor((now - 2 * 60 * 60 * 1000) / 60000)
  roundsToProcess = roundsToProcess.filter(r => r >= twoHoursAgoRound)

  if (roundsToProcess.length === 0) {
    console.log(`[${new Date().toISOString()}] All pending rounds too old (>2h), skipping`)
    lastProcessedRoundId = previousRoundId
    return
  }

  console.log(`\n[${new Date().toISOString()}] Processing ${roundsToProcess.length} round(s)`)

  try {
    const balance = await getStxBalance()
    console.log(`   STX balance: ${balance.toFixed(2)} STX`)
    if (balance < 10) console.warn('   WARNING: Low STX balance!')
    if (balance < 2) { console.error('   CRITICAL: STX balance < 2, skipping'); return }
  } catch { /* ignore */ }

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
await tick()

setInterval(async () => {
  try { await tick() } catch (e) { console.error('[resolver] Tick error:', e.message) }
}, LOOP_INTERVAL_MS)
