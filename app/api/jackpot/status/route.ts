import { NextRequest, NextResponse } from 'next/server'
import { getJackpotBalance, getUserTickets, getTotalTickets, todayET } from '@/lib/jackpot'

export const dynamic = 'force-dynamic'

/**
 * GET /api/jackpot/status?address=<stx_address>
 * Returns: jackpot balance, user's tickets today, total tickets, countdown to 21h ET
 */
export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get('address') || ''

    const today = todayET()

    const [balance, totalTickets, userTickets] = await Promise.all([
      getJackpotBalance(),
      getTotalTickets(today),
      address ? getUserTickets(address, today) : Promise.resolve(0),
    ])

    // Countdown to 21h ET
    const drawHour = parseInt(process.env.JACKPOT_DRAW_HOUR || '21', 10)
    const now = new Date()
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const drawTime = new Date(etNow)
    drawTime.setHours(drawHour, 0, 0, 0)
    if (etNow >= drawTime) {
      drawTime.setDate(drawTime.getDate() + 1)
    }
    const countdownMs = drawTime.getTime() - etNow.getTime()

    return NextResponse.json({
      ok: true,
      balance: balance / 1e6, // in USD
      totalTickets,
      userTickets,
      userProbability: totalTickets > 0 ? userTickets / totalTickets : 0,
      countdownMs,
      drawHourET: drawHour,
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to fetch jackpot status' }, { status: 500 })
  }
}
