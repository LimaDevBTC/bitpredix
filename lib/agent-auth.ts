/**
 * Agent authentication middleware.
 *
 * Extracts API key from X-Predix-Key header (or Authorization: Bearer pk_...),
 * validates against Redis, enforces rate limits, and injects agent context.
 *
 * Graceful degradation: no key = anonymous tier (10 req/min per IP).
 */

import { NextRequest, NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { validateAgentKey, incrementUsage } from './agent-keys'

// ---------------------------------------------------------------------------
// Redis (for rate limiting)
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

export interface AgentContext {
  authenticated: boolean
  keyHash?: string
  wallet?: string
  name?: string
  tier: 'anonymous' | 'free' | 'verified'
  rateLimit: { max: number; remaining: number; reset: number }
}

// ---------------------------------------------------------------------------
// Rate limit config per tier
// ---------------------------------------------------------------------------

const RATE_LIMITS: Record<AgentContext['tier'], number> = {
  anonymous: 10,
  free: 30,
  verified: 120,
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window via Redis)
// ---------------------------------------------------------------------------

async function checkRateLimit(
  identifier: string,
  tier: AgentContext['tier'],
): Promise<{ allowed: boolean; max: number; remaining: number; reset: number }> {
  const r = getRedis()
  const max = RATE_LIMITS[tier]

  if (!r) {
    // No Redis = no rate limiting (local dev)
    return { allowed: true, max, remaining: max, reset: 0 }
  }

  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - 60
  const key = `agent-rl:${identifier}`

  // Remove old entries, add current, count
  const pipeline = r.pipeline()
  pipeline.zremrangebyscore(key, 0, windowStart)
  pipeline.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 8)}` })
  pipeline.zcard(key)
  pipeline.expire(key, 120)
  const results = await pipeline.exec()

  const count = (results[2] as number) || 0
  const remaining = Math.max(0, max - count)
  const reset = now + 60

  return { allowed: count < max, max, remaining, reset }
}

// ---------------------------------------------------------------------------
// Key extraction
// ---------------------------------------------------------------------------

function extractApiKey(req: NextRequest): string | null {
  // X-Predix-Key header
  const headerKey = req.headers.get('x-predix-key')
  if (headerKey?.startsWith('pk_')) return headerKey

  // Authorization: Bearer pk_...
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer pk_')) return auth.slice(7)

  return null
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function withAgentAuth(
  req: NextRequest,
  handler: (req: NextRequest, agent: AgentContext) => Promise<NextResponse>,
  options?: { requireAuth?: boolean },
): Promise<NextResponse> {
  const apiKey = extractApiKey(req)

  let agent: AgentContext

  if (apiKey) {
    const keyData = await validateAgentKey(apiKey)
    if (!keyData) {
      return NextResponse.json(
        { ok: false, error: 'Invalid API key' },
        { status: 401 },
      )
    }

    const rl = await checkRateLimit(`key:${keyData.keyHash}`, keyData.tier)
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rl.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rl.reset),
            'Retry-After': '60',
          },
        },
      )
    }

    // Increment usage counter (fire and forget)
    incrementUsage(keyData.keyHash).catch(() => {})

    agent = {
      authenticated: true,
      keyHash: keyData.keyHash,
      wallet: keyData.wallet,
      name: keyData.name,
      tier: keyData.tier,
      rateLimit: { max: rl.max, remaining: rl.remaining, reset: rl.reset },
    }
  } else {
    // Anonymous access
    if (options?.requireAuth) {
      return NextResponse.json(
        { ok: false, error: 'API key required. Register at POST /api/agent/register' },
        { status: 401 },
      )
    }

    const ip = getClientIp(req)
    const rl = await checkRateLimit(`ip:${ip}`, 'anonymous')
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Rate limit exceeded. Register for higher limits at POST /api/agent/register' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rl.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rl.reset),
            'Retry-After': '60',
          },
        },
      )
    }

    agent = {
      authenticated: false,
      tier: 'anonymous',
      rateLimit: { max: rl.max, remaining: rl.remaining, reset: rl.reset },
    }
  }

  const response = await handler(req, agent)

  // Inject rate limit headers
  response.headers.set('X-RateLimit-Limit', String(agent.rateLimit.max))
  response.headers.set('X-RateLimit-Remaining', String(agent.rateLimit.remaining))
  response.headers.set('X-RateLimit-Reset', String(agent.rateLimit.reset))
  response.headers.set('X-Predix-Agent-Tier', agent.tier)

  return response
}

// ---------------------------------------------------------------------------
// Bet-per-round enforcement (for build-tx)
// ---------------------------------------------------------------------------

const BET_LIMITS: Record<AgentContext['tier'], number> = {
  anonymous: 1,
  free: 5,
  verified: 20,
}

export async function checkBetLimit(
  agent: AgentContext,
  roundId: number,
): Promise<{ allowed: boolean; limit: number; used: number }> {
  const r = getRedis()
  const limit = BET_LIMITS[agent.tier]

  if (!r || !agent.keyHash) {
    return { allowed: true, limit, used: 0 }
  }

  const key = `agent-bets:${agent.keyHash}:${roundId}`

  // Atomic increment-then-check: INCR returns the new value atomically
  const newCount = await r.incr(key)
  await r.expire(key, 120)

  if (newCount > limit) {
    // Over limit — decrement back (best effort) and reject
    await r.decr(key)
    return { allowed: false, limit, used: newCount - 1 }
  }

  return { allowed: true, limit, used: newCount }
}
