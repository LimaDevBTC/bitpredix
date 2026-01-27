/**
 * Gestão de rodadas de 1 minuto
 * Estado em memória (MVP) - em produção: smart contracts on-chain (Stacks/sBTC)
 */

import type { Round, RoundStatus, MarketSide, PoolState } from './types'
import { createInitialPool, buyShares, getPriceUp, getPriceDown } from './amm'

// Estado em memória do servidor (singleton)
const rounds = new Map<string, Round>()
let currentRound: Round | null = null

const ROUND_DURATION_MS = 60 * 1000 // 1 minuto

/** Gera ID da rodada a partir do timestamp de início */
function roundIdFromStart(startAt: number): string {
  return `round-${Math.floor(startAt / 1000)}`
}

/** Segundos antes do fim em que as apostas travam: aleatório entre 10 e 14 (inclusive). */
function randomTradingCloseSeconds(): number {
  return 10 + Math.floor(Math.random() * 5)
}

/** Cria uma nova rodada */
export function createRound(startAt: number, priceAtStart: number): Round {
  const id = roundIdFromStart(startAt)
  if (rounds.has(id)) {
    return rounds.get(id)!
  }

  const endsAt = startAt + ROUND_DURATION_MS
  const closeSeconds = randomTradingCloseSeconds()
  const round: Round = {
    id,
    startAt,
    endsAt,
    tradingClosesAt: endsAt - closeSeconds * 1000,
    priceAtStart,
    status: 'TRADING',
    pool: createInitialPool(),
  }
  rounds.set(id, round)
  currentRound = round
  return round
}

export interface RoundResult {
  round: Round
  resolvedRound?: Round
}

/** Obtém a rodada atual (criando se necessário). Se acabou de resolver, devolve também resolvedRound. */
export async function getOrCreateCurrentRound(
  fetchPrice: () => Promise<number>
): Promise<RoundResult> {
  const now = Date.now()
  const minuteStart = Math.floor(now / 60_000) * 60_000

  if (currentRound) {
    if (now < currentRound.endsAt) {
      return { round: currentRound }
    }
    // Rodada terminou: 1 fetch para fecho e abertura da próxima (evita 2× espera na API)
    const toResolve = currentRound
    const price = await fetchPrice()
    resolveRound(toResolve.id, price)
    const resolved = rounds.get(toResolve.id)!
    const newRound = createRound(minuteStart, price)
    return { round: newRound, resolvedRound: resolved }
  }

  const priceAtStart = await fetchPrice()
  const newRound = createRound(minuteStart, priceAtStart)
  return { round: newRound }
}

/** Obtém uma rodada por ID */
export function getRound(id: string): Round | undefined {
  return rounds.get(id)
}

/** Resolve uma rodada com o preço de fecho */
export function resolveRound(roundId: string, priceAtEnd: number): Round | null {
  const round = rounds.get(roundId)
  if (!round || round.status !== 'TRADING') return null

  round.priceAtEnd = priceAtEnd
  round.outcome = priceAtEnd > round.priceAtStart ? 'UP' : 'DOWN'
  round.status = 'RESOLVED'
  return round
}

/** Executa uma compra de shares na rodada atual. Rejeita se a rodada já terminou (regra clara). */
export function executeTrade(
  roundId: string,
  side: MarketSide,
  amountUsd: number
): { success: boolean; sharesReceived?: number; pricePerShare?: number; error?: string } {
  const round = rounds.get(roundId)
  if (!round) return { success: false, error: 'Round not found' }
  if (round.status !== 'TRADING') return { success: false, error: 'Trading has closed for this round.' }
  const closesAt = round.tradingClosesAt ?? round.endsAt
  if (Date.now() >= closesAt) return { success: false, error: 'Trading has closed for this round.' }
  if (amountUsd <= 0) return { success: false, error: 'Invalid amount' }

  const { sharesReceived, newPool, pricePerShare } = buyShares(round.pool, side, amountUsd)
  if (sharesReceived <= 0) return { success: false, error: 'Insufficient amount' }

  round.pool = newPool
  return { success: true, sharesReceived, pricePerShare }
}

/** Lista rodadas recentes */
export function listRecentRounds(limit = 10): Round[] {
  return Array.from(rounds.values())
    .sort((a, b) => b.startAt - a.startAt)
    .slice(0, limit)
}

export { getPriceUp, getPriceDown } from './amm'
export type { Round, PoolState }
