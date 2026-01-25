/**
 * AMM — LMSR (Logarithmic Market Scoring Rule)
 *
 * Usado em prediction markets (Kalshi, Gnosis, etc.). O impacto de cada trade
 * depende explicitamente da liquidez: b = b0 + volumeTraded. Com mais volume
 * no round, o mesmo $10k move menos o preço.
 *
 * C(q) = b · ln(Σ exp(q_i / b))
 * Preço UP = exp(qUp/b) / (exp(qUp/b) + exp(qDown/b))
 * Custo para comprar Δq de UP = C(qUp+Δq, qDown) − C(qUp, qDown)
 */

import type { PoolState, MarketSide } from './types'

/** Liquidez base. b = B0 + volumeTraded; maior b → menor impacto por dólar. */
const B0 = 3_000

/** Máximo USD por trade (botão MAX). */
export const MAX_TRADE_USD_ABSOLUTE = 10_000

function getB(pool: PoolState): number {
  return B0 + pool.volumeTraded
}

function costLmsr(qUp: number, qDown: number, b: number): number {
  const eUp = Math.exp(qUp / b)
  const eDown = Math.exp(qDown / b)
  return b * Math.log(eUp + eDown)
}

/** Custo em USD para comprar Δq shares de UP, dado estado (qUp, qDown) e b. */
function costToBuyUp(qUp: number, qDown: number, dq: number, b: number): number {
  if (dq <= 0) return 0
  return costLmsr(qUp + dq, qDown, b) - costLmsr(qUp, qDown, b)
}

/** Custo em USD para comprar Δq shares de DOWN. */
function costToBuyDown(qUp: number, qDown: number, dq: number, b: number): number {
  if (dq <= 0) return 0
  return costLmsr(qUp, qDown + dq, b) - costLmsr(qUp, qDown, b)
}

/** Encontra Δq tal que cost(Δq) = amountUsd (busca binária). */
function sharesForCost(
  qUp: number,
  qDown: number,
  side: MarketSide,
  amountUsd: number,
  b: number
): number {
  const cost = side === 'UP' ? costToBuyUp : costToBuyDown
  let lo = 0
  let hi = Math.max(amountUsd * 2, 1e3)
  while (cost(qUp, qDown, hi, b) < amountUsd) hi *= 2
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    const c = cost(qUp, qDown, mid, b)
    if (Math.abs(c - amountUsd) < 1e-6) return mid
    if (c < amountUsd) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Cria estado inicial (50/50). */
export function createInitialPool(): PoolState {
  return { qUp: 0, qDown: 0, volumeTraded: 0 }
}

/** Preço implícito de UP (0–1). */
export function getPriceUp(pool: PoolState): number {
  const b = getB(pool)
  const eUp = Math.exp(pool.qUp / b)
  const eDown = Math.exp(pool.qDown / b)
  const sum = eUp + eDown
  if (sum <= 0) return 0.5
  return eUp / sum
}

/** Preço implícito de DOWN (0–1). */
export function getPriceDown(pool: PoolState): number {
  return 1 - getPriceUp(pool)
}

/**
 * Compra shares. Retorna shares recebidas, novo pool e preço médio por share.
 */
export function buyShares(
  pool: PoolState,
  side: MarketSide,
  amountUsd: number
): { sharesReceived: number; newPool: PoolState; pricePerShare: number } {
  if (amountUsd <= 0) {
    return { sharesReceived: 0, newPool: { ...pool }, pricePerShare: 0 }
  }

  const b = getB(pool)
  const dq = sharesForCost(pool.qUp, pool.qDown, side, amountUsd, b)
  if (dq <= 0 || !Number.isFinite(dq)) {
    return { sharesReceived: 0, newPool: { ...pool }, pricePerShare: 0 }
  }

  const newPool: PoolState = {
    qUp: side === 'UP' ? pool.qUp + dq : pool.qUp,
    qDown: side === 'DOWN' ? pool.qDown + dq : pool.qDown,
    volumeTraded: pool.volumeTraded + amountUsd,
  }

  const pricePerShare = amountUsd / dq
  return { sharesReceived: dq, newPool, pricePerShare }
}

/** Estima shares para um dado amount (preview na UI). */
export function estimateShares(side: MarketSide, amountUsd: number, pool: PoolState): number {
  const { sharesReceived } = buyShares(pool, side, amountUsd)
  return sharesReceived
}
