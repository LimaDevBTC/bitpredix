/**
 * HTTP client for Predix Agent REST API
 */

const DEFAULT_API_URL = 'https://predix.app'

export function getApiUrl(): string {
  return process.env.PREDIX_API_URL || DEFAULT_API_URL
}

export async function fetchApi<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiUrl()}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(data.error || `API error: ${res.status}`)
  }
  return data as T
}

// ---- API Types ----

export interface MarketResponse {
  ok: boolean
  timestamp: number
  round: {
    id: number
    startAt: number
    endsAt: number
    secondsRemaining: number
    tradingOpen: boolean
    status: string
    openPrice: number | null
    currentPrice: number | null
    priceChangePct: number | null
    pool: {
      totalUp: number
      totalDown: number
      totalVolume: number
      oddsUp: number
      oddsDown: number
    }
    effectivePayoutUp: number
    effectivePayoutDown: number
    recentTrades: unknown[]
    hasCounterparty: boolean
    uniqueWallets: number
    jackpot: { balance: number; earlyUp: number; earlyDown: number }
  }
  contract: {
    id: string
    gateway: string
    token: string
    minBetUsd: number
    feeBps: number
    roundDurationSec: number
    network: string
  }
}

export interface BuildTxResponse {
  ok: boolean
  txHex: string
  action: string
  details: Record<string, unknown>
  instructions: string
}

export interface PositionsResponse {
  ok: boolean
  address: string
  balanceUsd: number
  pendingRounds: Array<{
    roundId: number
    up: { amount: number; claimed: boolean } | null
    down: { amount: number; claimed: boolean } | null
    resolved: boolean
    outcome: string | null
    estimatedPayout: number | null
    claimable: boolean
  }>
  activeRound: {
    roundId: number
    up: { amount: number } | null
    down: { amount: number } | null
  } | null
}

export interface HistoryResponse {
  ok: boolean
  address: string
  stats: {
    totalBets: number
    wins: number
    losses: number
    winRate: number
    totalVolumeUsd: number
    totalPnlUsd: number
    roi: number
    bestWin: number
    worstLoss: number
    avgBetSize: number
    currentStreak: { type: string; count: number }
  }
  bets: Array<{
    roundId: number
    side: string
    amountUsd: number
    outcome: string | null
    resolved: boolean
    pnl: number
    timestamp: number
    txId: string
  }>
}

export interface OpportunitiesResponse {
  ok: boolean
  round: {
    id: number
    tradingOpen: boolean
    secondsRemaining: number
  }
  signals: {
    poolImbalance: {
      favoredSide: string | null
      imbalanceRatio: number
      payoutUp: number
      payoutDown: number
      description: string
    }
    priceDirection: {
      side: string | null
      changePct: number | null
      openPrice: number | null
      currentPrice: number | null
      description: string
    }
    volume: {
      totalUsd: number
      level: string
      uniqueWallets: number
      hasCounterparty: boolean
    }
    jackpot: {
      balanceUsd: number
      earlyWindowOpen: boolean
    }
  }
  recentOutcomes: string[]
  streak: { side: string | null; length: number }
}

export interface SponsorResponse {
  txid: string
}
