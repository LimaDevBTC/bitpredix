/**
 * Obtém o preço do Bitcoin em USD.
 *
 * Fonte primária: Bitstamp (BTC/USD), a mesma do gráfico TradingView BITSTAMP:BTCUSD,
 * para manter um padrão único entre o preço exibido no app e o gráfico.
 *
 * Fallbacks: outras fontes caso a Bitstamp esteja indisponível.
 */

const FETCH_TIMEOUT_MS = 6_000
const DEFAULT_HEADERS: HeadersInit = {
  'Accept': 'application/json',
  'User-Agent': 'Predix/1.0 (https://www.predix.live)',
}

const SOURCES: { name: string; url: string; parse: (data: unknown) => number }[] = [
  {
    name: 'Bitstamp',
    url: 'https://www.bitstamp.net/api/v2/ticker/btcusd/',
    parse: (d) => {
      const v = (d as { last?: string | number }).last
      return typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
    },
  },
  {
    name: 'Binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    parse: (d) => parseFloat((d as { price?: string }).price ?? '0'),
  },
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse: (d) => (d as { bitcoin?: { usd?: number } }).bitcoin?.usd ?? 0,
  },
  {
    name: 'Blockchain.info',
    url: 'https://blockchain.info/ticker',
    parse: (d) => (d as { USD?: { last?: number } }).USD?.last ?? 0,
  },
  {
    name: 'CryptoCompare',
    url: 'https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD',
    parse: (d) => (d as { USD?: number }).USD ?? 0,
  },
]

async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {}
): Promise<Response> {
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...opts,
      headers: { ...DEFAULT_HEADERS, ...opts.headers },
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(to)
  }
}

async function trySource(
  source: (typeof SOURCES)[0],
  retries = 2
): Promise<number | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetchWithTimeout(source.url)
      if (!res.ok) continue
      const data = (await res.json()) as unknown
      const price = source.parse(data)
      if (price > 0 && isFinite(price)) return price
    } catch {
      // next retry or next source
    }
  }
  return null
}

const CACHE_MAX_AGE_MS = 2 * 60 * 1000 // 2 minutos
let lastPriceCache: { price: number; ts: number } | null = null

export async function fetchBtcPriceUsd(): Promise<number> {
  for (const source of SOURCES) {
    const price = await trySource(source)
    if (price != null) {
      lastPriceCache = { price, ts: Date.now() }
      return price
    }
  }
  const now = Date.now()
  if (lastPriceCache && now - lastPriceCache.ts < CACHE_MAX_AGE_MS) {
    return lastPriceCache.price
  }
  throw new Error('All Bitcoin price sources failed')
}
