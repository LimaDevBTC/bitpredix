/**
 * AMM (Automated Market Maker) - Estilo Polymarket/Uniswap
 * Fórmula: Preço UP = reserve_down / (reserve_up + reserve_down)
 *          Preço DOWN = reserve_up / (reserve_up + reserve_down)
 * Invariante: Preço UP + Preço DOWN ≈ 1.00
 *
 * Para compras usamos constant product: k = reserve_up * reserve_down
 */

import type { PoolState, MarketSide } from './types'

const INITIAL_LIQUIDITY = 10_000

/** Cria estado inicial do pool (50/50) */
export function createInitialPool(): PoolState {
  return {
    reserveUp: INITIAL_LIQUIDITY,
    reserveDown: INITIAL_LIQUIDITY,
    k: INITIAL_LIQUIDITY * INITIAL_LIQUIDITY,
  }
}

/**
 * Preço atual de UP: reserve_down / (reserve_up + reserve_down)
 * Probabilidade implícita de que o preço sobe
 */
export function getPriceUp(pool: PoolState): number {
  const total = pool.reserveUp + pool.reserveDown
  if (total === 0) return 0.5
  return pool.reserveDown / total
}

/**
 * Preço atual de DOWN: reserve_up / (reserve_up + reserve_down)
 */
export function getPriceDown(pool: PoolState): number {
  return 1 - getPriceUp(pool)
}

/**
 * Compra shares de um lado usando constant product.
 * Ao comprar UP: o pagamento (amountUsd) aumenta reserve_down, e o comprador
 * recebe shares UP (reserve_up diminui).
 *
 * Fórmula Uniswap: x * y = k
 * Comprar UP com P USD: reserve_down_new = reserve_down + P
 * reserve_up_new = k / reserve_down_new
 * shares_received = reserve_up - reserve_up_new
 */
export function buyShares(
  pool: PoolState,
  side: MarketSide,
  amountUsd: number
): { sharesReceived: number; newPool: PoolState; pricePerShare: number } {
  if (amountUsd <= 0) {
    return { sharesReceived: 0, newPool: { ...pool }, pricePerShare: 0 }
  }

  let reserveIn: number
  let reserveOut: number

  if (side === 'UP') {
    // Comprar UP: pagamento entra em DOWN, shares saem de UP
    reserveIn = pool.reserveDown
    reserveOut = pool.reserveUp
  } else {
    // Comprar DOWN: pagamento entra em UP, shares saem de DOWN
    reserveIn = pool.reserveUp
    reserveOut = pool.reserveDown
  }

  // Constant product: reserveOut_new = k / (reserveIn + amountUsd)
  // shares = reserveOut - reserveOut_new
  const reserveInNew = reserveIn + amountUsd
  const reserveOutNew = pool.k / reserveInNew
  const sharesReceived = reserveOut - reserveOutNew

  if (sharesReceived <= 0) {
    return { sharesReceived: 0, newPool: { ...pool }, pricePerShare: 0 }
  }

  const pricePerShare = amountUsd / sharesReceived

  const newPool: PoolState = {
    k: pool.k,
    reserveUp: side === 'UP' ? reserveOutNew : reserveInNew,
    reserveDown: side === 'DOWN' ? reserveOutNew : reserveInNew,
  }

  return { sharesReceived, newPool, pricePerShare }
}

/**
 * Estima shares recebidas para um dado amount (para preview na UI)
 * Usa o preço atual como aproximação para pequenas quantias
 */
export function estimateShares(side: MarketSide, amountUsd: number, pool: PoolState): number {
  const { sharesReceived } = buyShares(pool, side, amountUsd)
  return sharesReceived
}
