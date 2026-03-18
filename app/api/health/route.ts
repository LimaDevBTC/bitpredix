import { NextResponse } from 'next/server'
import { HIRO_API, hiroFetch } from '@/lib/hiro'
import { NETWORK_NAME, BITPREDIX_CONTRACT, GATEWAY_CONTRACT } from '@/lib/config'
import { getJackpotBalance } from '@/lib/jackpot'

export const dynamic = 'force-dynamic'

interface HealthCheck {
  status: 'ok' | 'degraded' | 'down'
  checks: Record<string, { ok: boolean; detail?: string; latencyMs?: number }>
}

export async function GET() {
  const checks: HealthCheck['checks'] = {}

  // 1. Jackpot balance (on-chain read via Hiro)
  try {
    const start = Date.now()
    const balance = await getJackpotBalance()
    checks.jackpot = { ok: true, detail: `balance=${(balance / 1e6).toFixed(2)} USDCx`, latencyMs: Date.now() - start }
  } catch (e) {
    checks.jackpot = { ok: false, detail: e instanceof Error ? e.message : 'On-chain read failed' }
  }

  // 2. Hiro API check
  try {
    const start = Date.now()
    const res = await hiroFetch('/v2/info')
    checks.hiro = { ok: res.ok, detail: `status=${res.status}`, latencyMs: Date.now() - start }
  } catch (e) {
    checks.hiro = { ok: false, detail: e instanceof Error ? e.message : 'Hiro unreachable' }
  }

  // 3. Sponsor wallet check (balance)
  try {
    const { generateWallet, getStxAddress } = await import('@stacks/wallet-sdk')
    const mnemonic = process.env.SPONSOR_MNEMONIC || process.env.ORACLE_MNEMONIC
    if (mnemonic) {
      const wallet = await generateWallet({ secretKey: mnemonic, password: '' })
      const address = getStxAddress({ account: wallet.accounts[0], network: NETWORK_NAME })
      const start = Date.now()
      const res = await hiroFetch(`/extended/v1/address/${address}/stx`)
      if (res.ok) {
        const data = await res.json() as { balance?: string }
        const balanceStx = Number(data.balance || 0) / 1e6
        checks.sponsor = {
          ok: balanceStx >= 2,
          detail: `${balanceStx.toFixed(2)} STX (${address.slice(0, 8)}...)`,
          latencyMs: Date.now() - start,
        }
      } else {
        checks.sponsor = { ok: false, detail: `Hiro ${res.status}` }
      }
    } else {
      checks.sponsor = { ok: false, detail: 'SPONSOR_MNEMONIC not configured' }
    }
  } catch (e) {
    checks.sponsor = { ok: false, detail: e instanceof Error ? e.message : 'Unknown' }
  }

  // 4. Config check
  checks.config = {
    ok: true,
    detail: `network=${NETWORK_NAME} market=${BITPREDIX_CONTRACT.split('.')[1]} gateway=${GATEWAY_CONTRACT.split('.')[1]}`,
  }

  // Overall status
  const allOk = Object.values(checks).every(c => c.ok)
  const anyDown = !checks.jackpot?.ok || !checks.hiro?.ok
  const status: HealthCheck['status'] = allOk ? 'ok' : anyDown ? 'down' : 'degraded'

  return NextResponse.json({ status, checks }, { status: status === 'down' ? 503 : 200 })
}
