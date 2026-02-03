/**
 * Pyth Network Integration
 *
 * Duas APIs:
 * 1. Hermes (tempo real) - SSE streaming para preco atual
 * 2. Benchmarks (historico) - REST para precos passados (usado no claim)
 */

// BTC/USD Price Feed ID (mesmo para mainnet e testnet)
export const PYTH_BTC_USD_FEED = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'

// URLs das APIs Pyth
export const HERMES_URL = 'https://hermes.pyth.network'
export const BENCHMARKS_URL = 'https://benchmarks.pyth.network'

// ============================================================================
// TIPOS
// ============================================================================

export interface PythPrice {
  price: number      // Preco em USD (ex: 97234.56)
  confidence: number // Intervalo de confianca
  timestamp: number  // Unix timestamp em segundos
  expo: number       // Expoente para conversao
}

export interface PythStreamData {
  parsed: Array<{
    id: string
    price: {
      price: string
      conf: string
      expo: number
      publish_time: number
    }
    ema_price: {
      price: string
      conf: string
      expo: number
      publish_time: number
    }
  }>
}

export interface RoundPrices {
  priceStart: number  // Preco de abertura em centavos (ex: 9723456 = $97,234.56)
  priceEnd: number    // Preco de fechamento em centavos
  timestampStart: number
  timestampEnd: number
}

// ============================================================================
// FUNCOES DE PRECO EM TEMPO REAL (Hermes SSE)
// ============================================================================

/**
 * Cria uma conexao SSE para receber precos em tempo real
 * @param onPrice Callback chamado a cada atualizacao de preco
 * @param onError Callback chamado em caso de erro
 * @returns Funcao para fechar a conexao
 */
export function subscribeToPythPrice(
  onPrice: (price: number, timestamp: number) => void,
  onError?: (error: Error) => void
): () => void {
  const url = `${HERMES_URL}/v2/updates/price/stream?ids[]=${PYTH_BTC_USD_FEED}&encoding=base64&parsed=true`

  const eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    try {
      const data: PythStreamData = JSON.parse(event.data)
      const priceData = data.parsed?.[0]?.price

      if (priceData) {
        // Converte de formato Pyth para USD
        // price * 10^expo = valor real
        const priceValue = Number(priceData.price) * Math.pow(10, priceData.expo)
        onPrice(priceValue, priceData.publish_time)
      }
    } catch (e) {
      console.error('[Pyth] Error parsing SSE data:', e)
      onError?.(e instanceof Error ? e : new Error('Parse error'))
    }
  }

  eventSource.onerror = (e) => {
    console.error('[Pyth] SSE connection error:', e)
    onError?.(new Error('SSE connection error'))
  }

  // Retorna funcao para fechar conexao
  return () => {
    eventSource.close()
  }
}

/**
 * Busca o preco atual via HTTP (fallback se SSE falhar)
 */
export async function fetchCurrentPrice(): Promise<PythPrice> {
  const url = `${HERMES_URL}/v2/updates/price/latest?ids[]=${PYTH_BTC_USD_FEED}&encoding=base64&parsed=true`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch price: ${response.status}`)
  }

  const data = await response.json()
  const priceData = data.parsed?.[0]?.price

  if (!priceData) {
    throw new Error('No price data in response')
  }

  const priceValue = Number(priceData.price) * Math.pow(10, priceData.expo)

  return {
    price: priceValue,
    confidence: Number(priceData.conf) * Math.pow(10, priceData.expo),
    timestamp: priceData.publish_time,
    expo: priceData.expo
  }
}

// ============================================================================
// FUNCOES DE PRECO HISTORICO (Benchmarks)
// ============================================================================

/**
 * Busca o preco em um timestamp especifico
 * Usado para resolver rounds
 *
 * @param timestamp Unix timestamp em segundos
 * @returns Preco em USD
 */
export async function getPriceAtTimestamp(timestamp: number): Promise<PythPrice> {
  // Pyth Benchmarks usa a TradingView API
  // resolution=1 = candles de 1 minuto
  const from = timestamp - 60
  const to = timestamp

  const url = `${BENCHMARKS_URL}/v1/shims/tradingview/history?` +
    `symbol=Crypto.BTC/USD&resolution=1&from=${from}&to=${to}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch historical price: ${response.status}`)
  }

  const data = await response.json()

  // Resposta no formato TradingView: { c: [close prices], t: [timestamps], ... }
  if (!data.c || data.c.length === 0) {
    throw new Error('No historical price data available')
  }

  // Pega o ultimo candle (mais proximo do timestamp solicitado)
  const closePrice = data.c[data.c.length - 1]
  const closeTime = data.t[data.t.length - 1]

  return {
    price: closePrice,
    confidence: 0, // Benchmarks nao retorna confidence
    timestamp: closeTime,
    expo: 0 // Ja vem em USD
  }
}

/**
 * Busca precos de abertura e fechamento de um round
 * Usado pelo ClaimButton para resolver rounds
 *
 * @param roundId ID do round (timestamp do inicio / 60)
 * @returns Precos em centavos (para o contrato)
 */
export async function getRoundPrices(roundId: number): Promise<RoundPrices> {
  const roundStartTimestamp = roundId * 60
  const roundEndTimestamp = (roundId + 1) * 60

  // Busca os dois precos em paralelo
  const [startPrice, endPrice] = await Promise.all([
    getPriceAtTimestamp(roundStartTimestamp),
    getPriceAtTimestamp(roundEndTimestamp)
  ])

  // Converte para centavos (2 decimais) para o contrato
  // Ex: $97,234.56 -> 9723456
  return {
    priceStart: Math.round(startPrice.price * 100),
    priceEnd: Math.round(endPrice.price * 100),
    timestampStart: startPrice.timestamp,
    timestampEnd: endPrice.timestamp
  }
}

/**
 * Busca precos para multiplos rounds (batch)
 * Usado quando usuario tem varios rounds pendentes
 *
 * @param roundIds Lista de round IDs
 * @returns Map de roundId -> precos
 */
export async function getBatchRoundPrices(
  roundIds: number[]
): Promise<Map<number, RoundPrices>> {
  const results = new Map<number, RoundPrices>()

  // Processa em paralelo, mas limitado para nao sobrecarregar a API
  const BATCH_SIZE = 5

  for (let i = 0; i < roundIds.length; i += BATCH_SIZE) {
    const batch = roundIds.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (roundId) => {
        try {
          const prices = await getRoundPrices(roundId)
          return { roundId, prices }
        } catch (e) {
          console.error(`[Pyth] Failed to get prices for round ${roundId}:`, e)
          return null
        }
      })
    )

    for (const result of batchResults) {
      if (result) {
        results.set(result.roundId, result.prices)
      }
    }
  }

  return results
}

// ============================================================================
// HOOK REACT PARA PRECO EM TEMPO REAL
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react'

interface UsePythPriceResult {
  price: number | null
  timestamp: number | null
  loading: boolean
  error: string | null
}

/**
 * Hook React para preco BTC em tempo real via Pyth
 */
export function usePythPrice(): UsePythPriceResult {
  const [price, setPrice] = useState<number | null>(null)
  const [timestamp, setTimestamp] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  const connect = useCallback(() => {
    setError(null)

    const close = subscribeToPythPrice(
      (newPrice, newTimestamp) => {
        setPrice(newPrice)
        setTimestamp(newTimestamp)
        setLoading(false)
        setError(null)
      },
      (err) => {
        setError(err.message)
        // Tenta reconectar apos 3 segundos
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[Pyth] Reconnecting...')
          connect()
        }, 3000)
      }
    )

    closeRef.current = close
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (closeRef.current) {
        closeRef.current()
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [connect])

  return { price, timestamp, loading, error }
}
