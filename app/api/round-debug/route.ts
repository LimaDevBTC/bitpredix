import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const HIRO_TESTNET = 'https://api.testnet.hiro.so'
const BITPREDIX_ID = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID

function parseContractId(id: string): [string, string] {
  const i = id.lastIndexOf('.')
  if (i < 0) throw new Error(`Invalid contract id: ${id}`)
  return [id.slice(0, i), id.slice(i + 1)]
}

/** GET ?roundId=1769644740 — debug do map_entry para rounds. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const roundIdParam = searchParams.get('roundId')
  const roundId = Math.floor(Date.now() / 1000 / 60) * 60
  const roundIdUsed = roundIdParam != null && roundIdParam !== ''
    ? Number(roundIdParam)
    : roundId

  if (!BITPREDIX_ID || !BITPREDIX_ID.includes('.')) {
    return NextResponse.json({ error: 'BITPREDIX_ID not set', ok: false }, { status: 500 })
  }

  const [contractAddress, contractName] = parseContractId(BITPREDIX_ID)
  const { Cl, cvToHex, deserializeCV } = await import('@stacks/transactions')
  const keyHex = cvToHex(Cl.tuple({ 'round-id': Cl.uint(roundIdUsed) }))
  const url = `${HIRO_TESTNET}/v2/map_entry/${contractAddress}/${contractName}/rounds?proof=0`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(keyHex),
  })
  const json = (await res.json()) as { data?: string; [k: string]: unknown }

  const out: Record<string, unknown> = {
    roundIdQueried: roundIdUsed,
    roundIdCurrentMinute: roundId,
    url,
    resStatus: res.status,
    resOk: res.ok,
    hasData: typeof json.data === 'string' && json.data.length > 0,
    dataLength: typeof json.data === 'string' ? json.data.length : 0,
    dataPreview: typeof json.data === 'string' ? json.data.slice(0, 80) + '...' : null,
  }

  if (res.ok && typeof json.data === 'string' && json.data.length > 0) {
    try {
      const cv = deserializeCV(json.data) as { type?: string; value?: { data?: Record<string, unknown> }; data?: Record<string, unknown> }
      out.cvType = cv?.type
      const tuple = cv?.type === 'some' && cv?.value ? cv.value : cv
      const d = tuple?.data ?? cv?.data
      out.hasTupleData = !!d
      out.tupleKeys = d ? Object.keys(d) : []
      if (d && typeof (d as Record<string, { value?: unknown }>)['start-at'] !== 'undefined') {
        out.startAt = (d as Record<string, { value?: unknown }>)['start-at']?.value
        out.status = (d as Record<string, { value?: unknown }>)['status']?.value
      }
    } catch (e) {
      out.parseError = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ ...out, ok: true })
}
