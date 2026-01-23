/**
 * Tipos do Bitpredix - Prediction Market para o preço do Bitcoin no próximo minuto
 */

export type MarketSide = 'UP' | 'DOWN'

export type RoundStatus = 'TRADING' | 'RESOLVING' | 'RESOLVED'

export interface PoolState {
  reserveUp: number
  reserveDown: number
  /** Constante k = reserveUp * reserveDown (constant product) */
  k: number
}

export interface Round {
  id: string
  /** Timestamp de início da rodada (início do minuto) */
  startAt: number
  /** Timestamp de fim (fim do minuto, quando resolve) */
  endsAt: number
  /** Preço do BTC no início da rodada (em USD) */
  priceAtStart: number
  /** Preço do BTC no fim (preenchido quando resolved) */
  priceAtEnd?: number
  /** Resultado: UP se priceAtEnd > priceAtStart, DOWN caso contrário */
  outcome?: MarketSide
  status: RoundStatus
  pool: PoolState
}

export interface Trade {
  roundId: string
  side: MarketSide
  /** Valor em USD (ou sBTC) pago */
  amountUsd: number
  /** Número de shares recebidas */
  sharesReceived: number
  /** Preço efetivo por share (amountUsd / sharesReceived) */
  pricePerShare: number
  timestamp: number
}

/** Resposta da API de preço do Bitcoin */
export interface BtcPriceResponse {
  usd: number
  usd_24h_change?: number
  last_updated_at?: number
}
