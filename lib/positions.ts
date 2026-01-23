/**
 * Posições e P&L em localStorage (MVP, sem auth).
 * Em produção: backend/on-chain.
 */

const KEY = 'bitpredix_trades'

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

export function saveTrade(t: Omit<StoredTrade, 'ts'>): void {
  if (typeof window === 'undefined') return
  const list: StoredTrade[] = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  list.push({ ...t, ts: Date.now() })
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function getPositionForRound(roundId: string): Position {
  if (typeof window === 'undefined') return { sharesUp: 0, sharesDown: 0, costUp: 0, costDown: 0 }
  const list: StoredTrade[] = JSON.parse(localStorage.getItem(KEY) ?? '[]')
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

/** P&L em USD. outcome: 'UP' | 'DOWN' (quem ganhou). */
export function getPnl(roundId: string, outcome: 'UP' | 'DOWN', pos: Position): number {
  const totalCost = pos.costUp + pos.costDown
  
  // Quando uma rodada resolve:
  // - Shares do lado vencedor valem $1.00 cada
  // - Shares do lado perdedor valem $0.00
  const winningShares = outcome === 'UP' ? pos.sharesUp : pos.sharesDown
  const payout = winningShares * 1.00 // Cada share vencedora vale exatamente $1.00
  
  // P&L = quanto recebeu - quanto gastou
  return payout - totalCost
}

const MY_RESULTS_KEY = 'bitpredix_my_results'

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
