/**
 * Agent webhook management and delivery.
 *
 * Webhooks are stored in Redis. Events are dispatched to subscribed agents
 * after round resolution, bet confirmation, etc.
 */

import { Redis } from '@upstash/redis'
import crypto from 'crypto'
import dns from 'dns/promises'
import { URL } from 'url'

// ---------------------------------------------------------------------------
// Redis
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

export type WebhookEvent =
  | 'round.open'
  | 'round.trading_closed'
  | 'round.resolved'
  | 'bet.confirmed'
  | 'bet.result'
  | 'jackpot.drawn'

export interface WebhookData {
  id: string
  keyHash: string
  url: string
  events: WebhookEvent[]
  secret: string
  active: boolean
  failCount: number
  createdAt: number
}

const VALID_EVENTS: WebhookEvent[] = [
  'round.open',
  'round.trading_closed',
  'round.resolved',
  'bet.confirmed',
  'bet.result',
  'jackpot.drawn',
]

// ---------------------------------------------------------------------------
// SSRF Prevention
// ---------------------------------------------------------------------------

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
]

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some(re => re.test(ip))
}

async function validateWebhookUrl(urlStr: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error('Invalid URL')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS')
  }

  // Resolve DNS (both IPv4 and IPv6) and check for private IPs
  const allAddresses: string[] = []
  try {
    const v4 = await dns.resolve4(parsed.hostname).catch(() => [] as string[])
    allAddresses.push(...v4)
  } catch { /* no IPv4 */ }
  try {
    const v6 = await dns.resolve6(parsed.hostname).catch(() => [] as string[])
    allAddresses.push(...v6)
  } catch { /* no IPv6 */ }

  if (allAddresses.length === 0) {
    throw new Error('Could not resolve webhook URL hostname')
  }

  for (const addr of allAddresses) {
    if (isPrivateIp(addr)) {
      throw new Error('Webhook URL resolves to a private IP address')
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createWebhook(
  keyHash: string,
  url: string,
  events: WebhookEvent[],
  secret?: string,
): Promise<WebhookData> {
  const r = getRedis()
  if (!r) throw new Error('Redis not configured')

  // Validate URL (SSRF prevention)
  await validateWebhookUrl(url)

  // Validate events
  const validEvents = events.filter(e => VALID_EVENTS.includes(e))
  if (validEvents.length === 0) throw new Error(`Invalid events. Valid: ${VALID_EVENTS.join(', ')}`)

  // Check limit (max 5 per agent)
  const existing = await r.lrange<string>(`agent-webhooks:${keyHash}`, 0, -1)
  if (existing.length >= 5) throw new Error('Maximum 5 webhooks per agent')

  const id = `wh_${crypto.randomBytes(12).toString('hex')}`
  const webhookSecret = secret || `whsec_${crypto.randomBytes(24).toString('hex')}`

  const data: WebhookData = {
    id,
    keyHash,
    url,
    events: validEvents,
    secret: webhookSecret,
    active: true,
    failCount: 0,
    createdAt: Date.now(),
  }

  await r.set(`agent-webhook:${id}`, data)
  await r.rpush(`agent-webhooks:${keyHash}`, id)

  return data
}

export async function listWebhooks(keyHash: string): Promise<WebhookData[]> {
  const r = getRedis()
  if (!r) return []

  const ids = await r.lrange<string>(`agent-webhooks:${keyHash}`, 0, -1)
  const results: WebhookData[] = []
  for (const id of ids) {
    const data = await r.get<WebhookData>(`agent-webhook:${id}`)
    if (data) results.push(data)
  }
  return results
}

export async function deleteWebhook(keyHash: string, webhookId: string): Promise<boolean> {
  const r = getRedis()
  if (!r) return false

  const data = await r.get<WebhookData>(`agent-webhook:${webhookId}`)
  if (!data || data.keyHash !== keyHash) return false

  await r.del(`agent-webhook:${webhookId}`)
  await r.lrem(`agent-webhooks:${keyHash}`, 1, webhookId)
  return true
}

export async function updateWebhook(
  keyHash: string,
  webhookId: string,
  updates: { active?: boolean; events?: WebhookEvent[] },
): Promise<WebhookData | null> {
  const r = getRedis()
  if (!r) return null

  const data = await r.get<WebhookData>(`agent-webhook:${webhookId}`)
  if (!data || data.keyHash !== keyHash) return null

  if (updates.active !== undefined) data.active = updates.active
  if (updates.events) {
    const validEvents = updates.events.filter(e => VALID_EVENTS.includes(e))
    if (validEvents.length > 0) data.events = validEvents
  }

  await r.set(`agent-webhook:${webhookId}`, data)
  return data
}

// ---------------------------------------------------------------------------
// Event Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a webhook event to all subscribed agents.
 * If targetKeyHash is provided, only dispatch to that agent's webhooks.
 */
export async function dispatchWebhookEvent(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  targetKeyHash?: string,
): Promise<void> {
  const r = getRedis()
  if (!r) return

  let webhookIds: string[] = []

  if (targetKeyHash) {
    // Dispatch to specific agent
    webhookIds = await r.lrange<string>(`agent-webhooks:${targetKeyHash}`, 0, -1)
  } else {
    // Broadcast to all agents with webhooks
    // Scan for all agent-webhooks:* keys
    let cursor = 0
    do {
      const result = await r.scan(cursor, { match: 'agent-webhooks:*', count: 100 })
      cursor = Number(result[0])
      const keys = result[1] as string[]
      for (const key of keys) {
        const ids = await r.lrange<string>(key, 0, -1)
        webhookIds.push(...ids)
      }
    } while (cursor !== 0)
  }

  // Deliver to each webhook that subscribes to this event
  const deliveryPromises = webhookIds.map(async (id) => {
    const data = await r.get<WebhookData>(`agent-webhook:${id}`)
    if (!data || !data.active || !data.events.includes(event)) return

    await deliverWebhook(data, event, payload)
  })

  await Promise.allSettled(deliveryPromises)
}

async function deliverWebhook(
  webhook: WebhookData,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({ event, payload, timestamp: Date.now() })
  const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
  const deliveryId = crypto.randomUUID()

  const delays = [0, 1000, 5000, 30000] // initial + 3 retries

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    }

    try {
      // Re-validate URL on delivery (anti-DNS rebinding)
      await validateWebhookUrl(webhook.url)

      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Predix-Signature': signature,
          'X-Predix-Event': event,
          'X-Predix-Delivery': deliveryId,
        },
        body,
        signal: AbortSignal.timeout(5000),
      })

      if (res.ok || res.status < 500) {
        // Success or client error (don't retry 4xx)
        await resetFailCount(webhook.id)
        return
      }
    } catch {
      // Network error, retry
    }
  }

  // All retries failed
  await incrementFailCount(webhook.id)
}

async function resetFailCount(webhookId: string): Promise<void> {
  const r = getRedis()
  if (!r) return
  const data = await r.get<WebhookData>(`agent-webhook:${webhookId}`)
  if (data && data.failCount > 0) {
    data.failCount = 0
    await r.set(`agent-webhook:${webhookId}`, data)
  }
}

async function incrementFailCount(webhookId: string): Promise<void> {
  const r = getRedis()
  if (!r) return
  const data = await r.get<WebhookData>(`agent-webhook:${webhookId}`)
  if (!data) return

  data.failCount += 1
  if (data.failCount >= 50) {
    data.active = false // Auto-disable after 50 consecutive failures
  }
  await r.set(`agent-webhook:${webhookId}`, data)
}
