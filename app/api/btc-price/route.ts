import { fetchBtcPriceUsd } from '@/lib/btc-price'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const usd = await fetchBtcPriceUsd()
    return NextResponse.json({ usd, ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to fetch Bitcoin price', ok: false },
      { status: 502 }
    )
  }
}
