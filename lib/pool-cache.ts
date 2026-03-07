/**
 * Server-side in-memory cache for optimistic pool totals.
 *
 * When a client broadcasts a bet tx, it immediately notifies the server
 * via POST /api/pool-update. The GET /api/round handler merges these
 * optimistic values with on-chain data using max(), so ALL clients see
 * pool updates within the next poll cycle (~3s) instead of waiting for
 * blockchain confirmation (~10-30s on Stacks testnet).
 */

interface RoundPool {
  up: number   // micro-units (6 decimals)
  down: number // micro-units
}

const pools = new Map<number, RoundPool>()

/** Record an optimistic bet for a round (amount in micro-units). */
export function addOptimisticBet(roundId: number, side: 'UP' | 'DOWN', amountMicro: number) {
  const current = pools.get(roundId) ?? { up: 0, down: 0 }
  if (side === 'UP') current.up += amountMicro
  else current.down += amountMicro
  pools.set(roundId, current)

  // Evict old rounds (keep only last 3)
  if (pools.size > 3) {
    const sortedKeys = [...pools.keys()].sort((a, b) => a - b)
    for (let i = 0; i < sortedKeys.length - 3; i++) {
      pools.delete(sortedKeys[i])
    }
  }
}

/** Get optimistic pool totals for a round (micro-units). */
export function getOptimisticPool(roundId: number): RoundPool {
  return pools.get(roundId) ?? { up: 0, down: 0 }
}

// ============================================================================
// Open price cache — first-write-wins per round
// ============================================================================

const openPrices = new Map<number, number>()

/** Set open price for a round. Returns true if this was the first write (accepted). */
export function setOpenPrice(roundId: number, price: number): boolean {
  if (openPrices.has(roundId)) return false
  openPrices.set(roundId, price)
  // Evict old rounds (keep last 3)
  if (openPrices.size > 3) {
    const sorted = [...openPrices.keys()].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 3; i++) openPrices.delete(sorted[i])
  }
  return true
}

/** Get the canonical open price for a round, or null if not yet set. */
export function getOpenPrice(roundId: number): number | null {
  return openPrices.get(roundId) ?? null
}
