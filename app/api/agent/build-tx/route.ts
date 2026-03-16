import { NextRequest, NextResponse } from 'next/server'
import {
  buildPlaceBetTx,
  buildClaimTx,
  buildApproveTx,
  buildMintTx,
} from '@/lib/agent-tx-builder'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS = ['place-bet', 'claim', 'approve', 'mint'] as const
type Action = typeof VALID_ACTIONS[number]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, publicKey, params } = body as {
      action?: string
      publicKey?: string
      params?: Record<string, unknown>
    }

    if (!action || !VALID_ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { ok: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }

    if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 60) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid publicKey (compressed hex, 66 chars)' },
        { status: 400 }
      )
    }

    switch (action as Action) {
      case 'place-bet': {
        const side = String(params?.side ?? '').toUpperCase()
        if (side !== 'UP' && side !== 'DOWN') {
          return NextResponse.json({ ok: false, error: 'params.side must be UP or DOWN' }, { status: 400 })
        }
        const amount = Number(params?.amount)
        if (!amount || amount < 1) {
          return NextResponse.json({ ok: false, error: 'params.amount must be >= 1 (USD)' }, { status: 400 })
        }
        const roundId = params?.roundId ? Number(params.roundId) : undefined
        const result = await buildPlaceBetTx(publicKey, side as 'UP' | 'DOWN', amount, roundId)
        return NextResponse.json({
          ok: true,
          txHex: result.txHex,
          action: 'place-bet',
          details: result.details,
          instructions: 'Sign this transaction with your private key using @stacks/transactions signStructuredTransaction(), then POST the signed hex to /api/sponsor as { "txHex": "<signed-hex>" }',
        })
      }

      case 'claim': {
        const roundId = Number(params?.roundId)
        if (!roundId || roundId <= 0) {
          return NextResponse.json({ ok: false, error: 'params.roundId is required' }, { status: 400 })
        }
        const side = String(params?.side ?? '').toUpperCase()
        if (side !== 'UP' && side !== 'DOWN') {
          return NextResponse.json({ ok: false, error: 'params.side must be UP or DOWN' }, { status: 400 })
        }
        const result = await buildClaimTx(publicKey, roundId, side as 'UP' | 'DOWN')
        return NextResponse.json({
          ok: true,
          txHex: result.txHex,
          action: 'claim',
          details: result.details,
          instructions: 'Sign this transaction with your private key, then POST the signed hex to /api/sponsor as { "txHex": "<signed-hex>" }',
        })
      }

      case 'approve': {
        const result = await buildApproveTx(publicKey)
        return NextResponse.json({
          ok: true,
          txHex: result.txHex,
          action: 'approve',
          details: result.details,
          instructions: 'Sign this transaction with your private key, then POST the signed hex to /api/sponsor as { "txHex": "<signed-hex>" }',
        })
      }

      case 'mint': {
        const result = await buildMintTx(publicKey)
        return NextResponse.json({
          ok: true,
          txHex: result.txHex,
          action: 'mint',
          details: result.details,
          instructions: 'Sign this transaction with your private key, then POST the signed hex to /api/sponsor as { "txHex": "<signed-hex>" }',
        })
      }
    }
  } catch (err) {
    console.error('[agent/build-tx] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
