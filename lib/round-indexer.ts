/**
 * Round Indexer — server-side in-memory indexer for BitPredix round history.
 *
 * Scans contract transactions from the Hiro API, parses place-bet and claim
 * calls, and builds a complete round index. Resolved rounds are cached
 * permanently (immutable data). Supports v5 (claim-round) and v6
 * (claim-round-side) contract formats.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface IndexedBet {
  txId: string
  user: string
  side: 'UP' | 'DOWN'
  amount: number      // micro-units (6 decimals)
  amountUsd: number   // amount / 1e6
  timestamp: number   // block_time (unix seconds)
  status: 'success' | 'pending' | 'failed'
}

export interface IndexedRound {
  roundId: number
  startTimestamp: number
  endTimestamp: number
  totalUpUsd: number
  totalDownUsd: number
  totalPoolUsd: number
  resolved: boolean
  outcome: 'UP' | 'DOWN' | null
  priceStart: number | null
  priceEnd: number | null
  bets: IndexedBet[]
  participantCount: number
  lastUpdated: number
}

export interface WalletStats {
  address: string
  totalBets: number
  totalVolumeUsd: number
  wins: number
  losses: number
  pending: number
  winRate: number
}

export interface IndexerStatus {
  roundCount: number
  lastScan: number
  totalTxsIndexed: number
  scanning: boolean
}

// ============================================================================
// HIRO TX TYPES
// ============================================================================

interface HiroFunctionArg {
  hex: string
  repr: string
  name: string
  type: string
}

interface HiroTx {
  tx_id: string
  tx_type: string
  tx_status: string
  sender_address: string
  block_time: number
  block_time_iso: string
  contract_call: {
    contract_id: string
    function_name: string
    function_args: HiroFunctionArg[]
  }
}

// ============================================================================
// CONFIG
// ============================================================================

const HIRO_API = 'https://api.testnet.hiro.so'
const DEPLOYER = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const SCAN_PAGE_SIZE = 50
const MAX_PAGES_PER_SCAN = 20
const MIN_SCAN_INTERVAL_MS = 30_000
const FETCH_TIMEOUT = 12_000

function getContractAddress(): string {
  return process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || `${DEPLOYER}.predixv1`
}

// ============================================================================
// SINGLETON STATE
// ============================================================================

const roundsIndex: Map<number, IndexedRound> = new Map()
const knownTxIds: Set<string> = new Set()

let lastScanTimestamp = 0
let totalTxsIndexed = 0
let scanInProgress = false
let initialScanDone = false

// ============================================================================
// PARSING HELPERS
// ============================================================================

function parseUint(repr: string): number {
  // "u29494078" -> 29494078
  if (repr.startsWith('u')) return parseInt(repr.slice(1), 10)
  return parseInt(repr, 10)
}

function parseString(repr: string): string {
  // '"UP"' -> 'UP'
  if (repr.startsWith('"') && repr.endsWith('"')) return repr.slice(1, -1)
  return repr
}

function parseTxStatus(status: string): 'success' | 'pending' | 'failed' {
  if (status === 'success') return 'success'
  if (status === 'pending') return 'pending'
  return 'failed'
}

// ============================================================================
// TRANSACTION PARSERS
// ============================================================================

function parsePlaceBetTx(tx: HiroTx): { roundId: number; bet: IndexedBet } | null {
  const args = tx.contract_call.function_args
  if (!args || args.length < 3) return null

  const roundId = parseUint(args[0].repr)
  const side = parseString(args[1].repr) as 'UP' | 'DOWN'
  if (side !== 'UP' && side !== 'DOWN') return null

  const amount = parseUint(args[2].repr)
  if (isNaN(roundId) || isNaN(amount)) return null

  return {
    roundId,
    bet: {
      txId: tx.tx_id,
      user: tx.sender_address,
      side,
      amount,
      amountUsd: amount / 1e6,
      timestamp: tx.block_time,
      status: parseTxStatus(tx.tx_status),
    },
  }
}

function parseClaimTx(tx: HiroTx): { roundId: number; priceStart: number; priceEnd: number } | null {
  const fn = tx.contract_call.function_name
  const args = tx.contract_call.function_args
  if (!args) return null

  if (fn === 'claim-round' && args.length >= 3) {
    // v5: (round-id, price-start, price-end)
    return {
      roundId: parseUint(args[0].repr),
      priceStart: parseUint(args[1].repr),
      priceEnd: parseUint(args[2].repr),
    }
  }

  if (fn === 'claim-round-side' && args.length >= 4) {
    // v6/predixv1: (round-id, side, price-start, price-end)
    return {
      roundId: parseUint(args[0].repr),
      priceStart: parseUint(args[2].repr),
      priceEnd: parseUint(args[3].repr),
    }
  }

  if (fn === 'resolve-round' && args.length >= 3) {
    // predixv1: (round-id, price-start, price-end)
    return {
      roundId: parseUint(args[0].repr),
      priceStart: parseUint(args[1].repr),
      priceEnd: parseUint(args[2].repr),
    }
  }

  if (fn === 'claim-on-behalf' && args.length >= 5) {
    // predixv1 cron: (user, round-id, side, price-start, price-end)
    return {
      roundId: parseUint(args[1].repr),
      priceStart: parseUint(args[3].repr),
      priceEnd: parseUint(args[4].repr),
    }
  }

  return null
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

function ensureRound(roundId: number): IndexedRound {
  let round = roundsIndex.get(roundId)
  if (!round) {
    round = {
      roundId,
      startTimestamp: roundId * 60,
      endTimestamp: (roundId + 1) * 60,
      totalUpUsd: 0,
      totalDownUsd: 0,
      totalPoolUsd: 0,
      resolved: false,
      outcome: null,
      priceStart: null,
      priceEnd: null,
      bets: [],
      participantCount: 0,
      lastUpdated: Date.now(),
    }
    roundsIndex.set(roundId, round)
  }
  return round
}

function recalcRoundTotals(round: IndexedRound): void {
  const successBets = round.bets.filter((b) => b.status === 'success')
  round.totalUpUsd = successBets.filter((b) => b.side === 'UP').reduce((s, b) => s + b.amountUsd, 0)
  round.totalDownUsd = successBets.filter((b) => b.side === 'DOWN').reduce((s, b) => s + b.amountUsd, 0)
  round.totalPoolUsd = round.totalUpUsd + round.totalDownUsd
  round.participantCount = new Set(successBets.map((b) => b.user)).size
  round.lastUpdated = Date.now()
}

// ============================================================================
// HIRO API FETCHING
// ============================================================================

async function fetchContractTxs(contractAddress: string, limit: number, offset: number): Promise<{ results: HiroTx[]; total: number }> {
  const url = `${HIRO_API}/extended/v1/address/${contractAddress}/transactions?limit=${limit}&offset=${offset}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`Hiro API ${res.status}`)
    const data = await res.json()
    return { results: data.results || [], total: data.total || 0 }
  } catch (e) {
    clearTimeout(timeoutId)
    throw e
  }
}

// ============================================================================
// ON-CHAIN ENRICHMENT
// ============================================================================

async function enrichUnresolvedRounds(): Promise<void> {
  const contractId = getContractAddress()
  const [contractAddr, contractName] = contractId.split('.')
  if (!contractAddr || !contractName) return

  const now = Math.floor(Date.now() / 1000)
  const unresolved = [...roundsIndex.values()]
    .filter((r) => !r.resolved && r.endTimestamp < now)
    .sort((a, b) => b.roundId - a.roundId)
    .slice(0, 10)

  for (const round of unresolved) {
    try {
      const { uintCV, tupleCV, cvToHex, deserializeCV } = await import('@stacks/transactions')
      const keyHex = cvToHex(tupleCV({ 'round-id': uintCV(round.roundId) }))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

      const res = await fetch(
        `${HIRO_API}/v2/map_entry/${contractAddr}/${contractName}/rounds?proof=0`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(keyHex),
          signal: controller.signal,
        },
      )
      clearTimeout(timeoutId)

      if (!res.ok) continue
      const json = (await res.json()) as { data?: string }
      if (!json.data) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cv = deserializeCV(json.data) as any
      const tuple = cv?.type === 'some' && cv?.value ? cv.value : cv
      // v7 @stacks/transactions: tuple fields are under .value, not .data
      const d = tuple?.value ?? tuple?.data ?? cv?.value ?? cv?.data
      if (!d) continue

      const u = (k: string) => Number(d[k]?.value ?? 0)
      // v7 @stacks/transactions: bools have .type 'true'/'false', not .value
      const resolvedField = d['resolved']
      const resolved = resolvedField?.type === 'true' || resolvedField?.value === true || String(resolvedField?.value) === 'true'

      if (resolved) {
        const priceStart = u('price-start')
        const priceEnd = u('price-end')
        round.priceStart = priceStart / 100
        round.priceEnd = priceEnd / 100
        round.resolved = true
        round.outcome = priceEnd > priceStart ? 'UP' : 'DOWN'
        round.lastUpdated = Date.now()
      }
    } catch {
      // Skip — will retry next scan
    }
  }
}

// ============================================================================
// SCAN ENGINE
// ============================================================================

async function scanContractTransactions(): Promise<void> {
  if (scanInProgress) return
  const now = Date.now()
  if (initialScanDone && now - lastScanTimestamp < MIN_SCAN_INTERVAL_MS) return

  scanInProgress = true

  try {
    const contractAddress = getContractAddress()
    let offset = 0
    let pagesScanned = 0
    let newTxs = 0

    while (pagesScanned < MAX_PAGES_PER_SCAN) {
      const { results } = await fetchContractTxs(contractAddress, SCAN_PAGE_SIZE, offset)
      if (results.length === 0) break

      let allKnown = true

      for (const tx of results) {
        if (tx.tx_type !== 'contract_call') continue
        if (!tx.contract_call) continue

        // Skip already indexed
        if (knownTxIds.has(tx.tx_id)) continue
        allKnown = false

        const fn = tx.contract_call.function_name

        if (fn === 'place-bet') {
          const parsed = parsePlaceBetTx(tx)
          if (parsed) {
            const round = ensureRound(parsed.roundId)
            if (!round.bets.some((b) => b.txId === parsed.bet.txId)) {
              round.bets.push(parsed.bet)
              recalcRoundTotals(round)
              newTxs++
            }
            knownTxIds.add(tx.tx_id)
          }
        }

        if (fn === 'claim-round' || fn === 'claim-round-side' || fn === 'resolve-round' || fn === 'claim-on-behalf') {
          if (tx.tx_status === 'success') {
            const parsed = parseClaimTx(tx)
            if (parsed) {
              const round = ensureRound(parsed.roundId)
              if (!round.resolved && parsed.priceStart > 0 && parsed.priceEnd > 0) {
                round.priceStart = parsed.priceStart / 100
                round.priceEnd = parsed.priceEnd / 100
                round.resolved = true
                round.outcome = parsed.priceEnd > parsed.priceStart ? 'UP' : 'DOWN'
                round.lastUpdated = Date.now()
              }
              knownTxIds.add(tx.tx_id)
              newTxs++
            }
          }
        }
      }

      offset += SCAN_PAGE_SIZE
      pagesScanned++

      // If all txs on this page were already known, stop scanning
      if (allKnown && initialScanDone) break
    }

    totalTxsIndexed += newTxs

    // Enrich unresolved rounds with on-chain data
    await enrichUnresolvedRounds()

    lastScanTimestamp = now
    initialScanDone = true
  } catch (e) {
    console.error('[round-indexer] Scan error:', e instanceof Error ? e.message : e)
  } finally {
    scanInProgress = false
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function getRoundHistory(opts: {
  page?: number
  pageSize?: number
  roundId?: number
}): Promise<{ rounds: IndexedRound[]; total: number; hasMore: boolean }> {
  // Trigger scan if needed
  await scanContractTransactions()

  const { page = 1, pageSize = 10, roundId } = opts

  // Search by specific round
  if (roundId !== undefined) {
    const round = roundsIndex.get(roundId)
    return {
      rounds: round ? [round] : [],
      total: round ? 1 : 0,
      hasMore: false,
    }
  }

  // Paginated list, newest first
  const allRounds = [...roundsIndex.values()].sort((a, b) => b.roundId - a.roundId)
  const start = (page - 1) * pageSize
  const slice = allRounds.slice(start, start + pageSize)

  return {
    rounds: slice,
    total: allRounds.length,
    hasMore: start + pageSize < allRounds.length,
  }
}

export function getWalletStats(address: string): WalletStats {
  let totalBets = 0
  let totalVolumeUsd = 0
  let wins = 0
  let losses = 0
  let pending = 0

  for (const round of roundsIndex.values()) {
    const userBets = round.bets.filter((b) => b.user === address && b.status === 'success')
    if (userBets.length === 0) continue

    for (const bet of userBets) {
      totalBets++
      totalVolumeUsd += bet.amountUsd

      if (!round.resolved) {
        pending++
      } else if (bet.side === round.outcome) {
        wins++
      } else {
        losses++
      }
    }
  }

  const decided = wins + losses
  return {
    address,
    totalBets,
    totalVolumeUsd,
    wins,
    losses,
    pending,
    winRate: decided > 0 ? wins / decided : 0,
  }
}

export function getIndexerStatus(): IndexerStatus {
  return {
    roundCount: roundsIndex.size,
    lastScan: lastScanTimestamp,
    totalTxsIndexed,
    scanning: scanInProgress,
  }
}
