/**
 * Positions and P&L in localStorage (MVP, no auth).
 * Network-prefixed keys to prevent ghost data cross-network.
 * 7-day TTL on trades to prevent unbounded growth.
 */

import { NETWORK_NAME } from './config'

const TRADES_KEY = `predix:${NETWORK_NAME}:trades`
const RESULTS_KEY = `predix:${NETWORK_NAME}:results`
const TRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface StoredTrade {
  roundId: string
  side: 'UP' | 'DOWN'
  shares: number
  amountUsd: number
  ts: number
}

export interface Position {
  sharesUp: number
  sharesDown: number
  costUp: number
  costDown: number
}

function cleanExpiredTrades(trades: StoredTrade[]): StoredTrade[] {
  const cutoff = Date.now() - TRADE_TTL_MS
  return trades.filter(t => t.ts > cutoff)
}

export function saveTrade(t: Omit<StoredTrade, 'ts'>): void {
  if (typeof window === 'undefined') return
  const raw: StoredTrade[] = JSON.parse(localStorage.getItem(TRADES_KEY) ?? '[]')
  const list = cleanExpiredTrades(raw)
  list.push({ ...t, ts: Date.now() })
  localStorage.setItem(TRADES_KEY, JSON.stringify(list))
}

export function getPositionForRound(roundId: string): Position {
  if (typeof window === 'undefined') return { sharesUp: 0, sharesDown: 0, costUp: 0, costDown: 0 }
  const raw: StoredTrade[] = JSON.parse(localStorage.getItem(TRADES_KEY) ?? '[]')
  const list = cleanExpiredTrades(raw)
  const pos: Position = { sharesUp: 0, sharesDown: 0, costUp: 0, costDown: 0 }
  for (const t of list) {
    if (t.roundId !== roundId) continue
    if (t.side === 'UP') {
      pos.sharesUp += t.shares
      pos.costUp += t.amountUsd
    } else {
      pos.sharesDown += t.shares
      pos.costDown += t.amountUsd
    }
  }
  return pos
}

/** P&L in USD. outcome: 'UP' | 'DOWN' (who won). */
export function getPnl(roundId: string, outcome: 'UP' | 'DOWN', pos: Position): number {
  const totalCost = pos.costUp + pos.costDown
  const winningShares = outcome === 'UP' ? pos.sharesUp : pos.sharesDown
  const payout = winningShares * 1.00
  return payout - totalCost
}

const MY_RESULTS_KEY = RESULTS_KEY

export interface MyResult {
  roundId: string
  outcome: 'UP' | 'DOWN'
  pnl: number
  startAt: number
}

export function saveMyResult(r: MyResult): void {
  if (typeof window === 'undefined') return
  const list: MyResult[] = JSON.parse(localStorage.getItem(MY_RESULTS_KEY) ?? '[]')
  const next = [r, ...list.filter((x) => x.roundId !== r.roundId)].slice(0, 5)
  localStorage.setItem(MY_RESULTS_KEY, JSON.stringify(next))
}

export function getMyResults(): MyResult[] {
  if (typeof window === 'undefined') return []
  return JSON.parse(localStorage.getItem(MY_RESULTS_KEY) ?? '[]')
}
