import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HIRO_API = 'https://api.testnet.hiro.so'

/**
 * Proxy for Stacks read-only contract calls
 * Avoids CORS issues by fetching server-side
 *
 * POST body: { contractId, functionName, args, sender }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { contractId, functionName, args, sender } = body

    if (!contractId || !functionName) {
      return NextResponse.json(
        { error: 'Missing contractId or functionName', ok: false },
        { status: 400 }
      )
    }

    const [contractAddr, contractName] = contractId.split('.')
    if (!contractAddr || !contractName) {
      return NextResponse.json(
        { error: 'Invalid contractId format', ok: false },
        { status: 400 }
      )
    }

    const url = `${HIRO_API}/v2/contracts/call-read/${contractAddr}/${contractName}/${functionName}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: sender || contractAddr,
        arguments: args || []
      })
    })

    if (!response.ok) {
      console.error(`[stacks-read] Hiro API error: ${response.status}`)
      return NextResponse.json(
        { error: `Hiro API error: ${response.status}`, ok: false },
        { status: 502 }
      )
    }

    const data = await response.json()
    return NextResponse.json({ ...data, ok: true })
  } catch (e) {
    console.error('[stacks-read] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to call contract', ok: false },
      { status: 500 }
    )
  }
}
