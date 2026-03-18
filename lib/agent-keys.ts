/**
 * Agent API Key management — Redis-backed key storage.
 *
 * Keys are hashed (SHA-256) before storage. The raw key is shown
 * to the agent exactly once at registration time.
 */

import { Redis } from '@upstash/redis'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Redis client (reuse pattern from pool-store)
// ---------------------------------------------------------------------------

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentKeyData {
  keyPrefix: string
  wallet: string
  name: string
  description: string
  tier: 'free' | 'verified'
  createdAt: number
  lastUsed: number
  requestCount: number
  totalVolumeUsd: number
}

// ---------------------------------------------------------------------------
// Key generation & hashing
// ---------------------------------------------------------------------------

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

function generateRawKey(): string {
  const hex = crypto.randomBytes(32).toString('hex')
  return `pk_live_${hex}`
}

function keyPrefix(key: string): string {
  return key.slice(0, 12)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateAgentKey(
  wallet: string,
  name?: string,
  description?: string,
): Promise<{ key: string; prefix: string; isExisting: boolean }> {
  const r = getRedis()
  if (!r) throw new Error('Redis not configured')

  // Atomic check: try to claim this wallet with SETNX
  const rawKey = generateRawKey()
  const hash = hashKey(rawKey)
  const prefix = keyPrefix(rawKey)

  // SETNX returns true only if key didn't exist — prevents race condition
  const claimed = await r.setnx(`agent-wallet:${wallet}`, hash)

  if (!claimed) {
    // Wallet already registered — return existing info
    const existingHash = await r.get<string>(`agent-wallet:${wallet}`)
    if (existingHash) {
      const existing = await r.get<AgentKeyData>(`agent-key:${existingHash}`)
      if (existing) {
        return { key: '', prefix: existing.keyPrefix, isExisting: true }
      }
    }
    return { key: '', prefix: '', isExisting: true }
  }

  const data: AgentKeyData = {
    keyPrefix: prefix,
    wallet,
    name: name || '',
    description: description || '',
    tier: 'free',
    createdAt: Date.now(),
    lastUsed: Date.now(),
    requestCount: 0,
    totalVolumeUsd: 0,
  }

  // Store key data (wallet index already set by SETNX)
  await r.set(`agent-key:${hash}`, data)

  return { key: rawKey, prefix, isExisting: false }
}

export async function validateAgentKey(key: string): Promise<(AgentKeyData & { keyHash: string }) | null> {
  const r = getRedis()
  if (!r) return null

  const hash = hashKey(key)
  const data = await r.get<AgentKeyData>(`agent-key:${hash}`)
  if (!data) return null

  return { ...data, keyHash: hash }
}

export async function getAgentByWallet(wallet: string): Promise<(AgentKeyData & { keyHash: string }) | null> {
  const r = getRedis()
  if (!r) return null

  const hash = await r.get<string>(`agent-wallet:${wallet}`)
  if (!hash) return null

  const data = await r.get<AgentKeyData>(`agent-key:${hash}`)
  if (!data) return null

  return { ...data, keyHash: hash }
}

export async function revokeAgentKey(keyHash: string): Promise<void> {
  const r = getRedis()
  if (!r) return

  const data = await r.get<AgentKeyData>(`agent-key:${keyHash}`)
  if (data) {
    await r.del(`agent-wallet:${data.wallet}`)
  }
  await r.del(`agent-key:${keyHash}`)
}

export async function incrementUsage(keyHash: string, volumeUsd?: number): Promise<void> {
  const r = getRedis()
  if (!r) return

  const data = await r.get<AgentKeyData>(`agent-key:${keyHash}`)
  if (!data) return

  data.requestCount += 1
  data.lastUsed = Date.now()
  if (volumeUsd) data.totalVolumeUsd += volumeUsd

  await r.set(`agent-key:${keyHash}`, data)
}

export async function listAgentKeys(page: number = 1, pageSize: number = 20): Promise<AgentKeyData[]> {
  const r = getRedis()
  if (!r) return []

  // Scan for agent-key:* keys
  const keys: string[] = []
  let cursor = 0
  do {
    const result = await r.scan(cursor, { match: 'agent-key:*', count: 100 })
    cursor = Number(result[0])
    keys.push(...(result[1] as string[]))
  } while (cursor !== 0 && keys.length < page * pageSize + pageSize)

  const start = (page - 1) * pageSize
  const slice = keys.slice(start, start + pageSize)

  const results: AgentKeyData[] = []
  for (const key of slice) {
    const data = await r.get<AgentKeyData>(key)
    if (data) results.push(data)
  }

  return results
}
