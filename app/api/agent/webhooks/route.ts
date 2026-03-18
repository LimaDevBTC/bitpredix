/**
 * Agent Webhooks CRUD — POST/GET/DELETE /api/agent/webhooks
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAgentAuth } from '@/lib/agent-auth'
import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  updateWebhook,
  type WebhookEvent,
} from '@/lib/agent-webhooks'

export const dynamic = 'force-dynamic'

// POST — Create webhook
export const POST = (req: NextRequest) =>
  withAgentAuth(req, async (_req, agent) => {
    try {
      const body = await req.json()
      const { url, events, secret } = body as {
        url?: string
        events?: string[]
        secret?: string
      }

      if (!url || !events || !Array.isArray(events) || events.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'Missing required fields: url, events (array)' },
          { status: 400 },
        )
      }

      const webhook = await createWebhook(
        agent.keyHash!,
        url,
        events as WebhookEvent[],
        secret,
      )

      return NextResponse.json({
        ok: true,
        webhook: {
          id: webhook.id,
          url: webhook.url,
          events: webhook.events,
          secret: webhook.secret,
          active: webhook.active,
          createdAt: webhook.createdAt,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create webhook'
      return NextResponse.json({ ok: false, error: message }, { status: 400 })
    }
  }, { requireAuth: true })

// GET — List webhooks
export const GET = (req: NextRequest) =>
  withAgentAuth(req, async (_req, agent) => {
    const webhooks = await listWebhooks(agent.keyHash!)
    return NextResponse.json({
      ok: true,
      webhooks: webhooks.map(w => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        failCount: w.failCount,
        createdAt: w.createdAt,
      })),
    })
  }, { requireAuth: true })

// DELETE — Remove webhook (id in query param)
export const DELETE = (req: NextRequest) =>
  withAgentAuth(req, async (_req, agent) => {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id query param required' }, { status: 400 })
    }

    const deleted = await deleteWebhook(agent.keyHash!, id)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: 'Webhook not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  }, { requireAuth: true })

// PATCH — Update webhook
export const PATCH = (req: NextRequest) =>
  withAgentAuth(req, async (_req, agent) => {
    try {
      const body = await req.json()
      const { id, active, events } = body as {
        id?: string
        active?: boolean
        events?: string[]
      }

      if (!id) {
        return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
      }

      const updated = await updateWebhook(agent.keyHash!, id, {
        active,
        events: events as WebhookEvent[] | undefined,
      })

      if (!updated) {
        return NextResponse.json({ ok: false, error: 'Webhook not found' }, { status: 404 })
      }

      return NextResponse.json({
        ok: true,
        webhook: {
          id: updated.id,
          url: updated.url,
          events: updated.events,
          active: updated.active,
          failCount: updated.failCount,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update webhook'
      return NextResponse.json({ ok: false, error: message }, { status: 400 })
    }
  }, { requireAuth: true })
