/**
 * Server-side pub/sub for real-time pool updates via SSE.
 *
 * When a client places a bet, the server broadcasts the updated pool
 * totals to ALL connected SSE clients, so every user sees the pool
 * change instantly — no polling delay.
 */

export interface PoolUpdate {
  roundId: number
  side: 'UP' | 'DOWN'
  amountMicro: number
  totalUp: number   // cumulative optimistic total (micro-units)
  totalDown: number // cumulative optimistic total (micro-units)
  clientId?: string // originating client — receivers skip their own echo
}

type PoolUpdateCallback = (data: PoolUpdate) => void

const listeners = new Set<PoolUpdateCallback>()

export function subscribePoolUpdates(cb: PoolUpdateCallback): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function broadcastPoolUpdate(data: PoolUpdate) {
  for (const cb of listeners) {
    try { cb(data) } catch {}
  }
}

// ============================================================================
// Open price broadcast — propagates canonical open price to all SSE clients
// ============================================================================

export interface OpenPriceUpdate {
  roundId: number
  price: number
}

type OpenPriceCallback = (data: OpenPriceUpdate) => void

const openPriceListeners = new Set<OpenPriceCallback>()

export function subscribeOpenPrice(cb: OpenPriceCallback): () => void {
  openPriceListeners.add(cb)
  return () => { openPriceListeners.delete(cb) }
}

export function broadcastOpenPrice(data: OpenPriceUpdate) {
  for (const cb of openPriceListeners) {
    try { cb(data) } catch {}
  }
}
