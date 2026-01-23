/**
 * Obtém o preço do Bitcoin em tempo real
 * Fontes: Binance (público, sem API key) ou CoinGecko como fallback
 */

const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
const FETCH_TIMEOUT_MS = 8000

function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(to))
}

export async function fetchBtcPriceUsd(): Promise<number> {
  try {
    const res = await fetchWithTimeout(BINANCE_URL, { next: { revalidate: 0 } })
    if (!res.ok) throw new Error('Binance API error')
    const data = await res.json()
    return parseFloat(data.price)
  } catch {
    const res = await fetchWithTimeout(COINGECKO_URL, { next: { revalidate: 0 } })
    if (!res.ok) throw new Error('CoinGecko API error')
    const data = await res.json()
    return data.bitcoin?.usd ?? 0
  }
}
