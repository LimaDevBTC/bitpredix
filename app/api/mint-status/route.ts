import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONTRACT_ID = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID
const HIRO_TESTNET = 'https://api.testnet.hiro.so'

function parseContractId(id: string): [string, string] {
  const i = id.lastIndexOf('.')
  if (i < 0) throw new Error(`Invalid contract id: ${id}`)
  return [id.slice(0, i), id.slice(i + 1)]
}

async function callContract(contractId: string, functionName: string, args: string[], sender: string) {
  const [contractAddress, contractName] = parseContractId(contractId)

  const response = await fetch(`${HIRO_TESTNET}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender, arguments: args })
  })

  if (!response.ok) {
    throw new Error(`Hiro API error: ${response.status}`)
  }

  return response.json()
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')

  if (!address || typeof address !== 'string' || address.length === 0) {
    return NextResponse.json(
      { error: 'Missing or invalid address', ok: false },
      { status: 400 }
    )
  }

  if (!CONTRACT_ID) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID not configured', ok: false },
      { status: 500 }
    )
  }

  try {
    const { Cl, cvToHex, hexToCV } = await import('@stacks/transactions')
    const argHex = cvToHex(Cl.principal(address))

    // Busca minted e balance em paralelo
    const [mintedResult, balanceResult] = await Promise.allSettled([
      callContract(CONTRACT_ID, 'get-minted', [argHex], address),
      callContract(CONTRACT_ID, 'get-balance', [argHex], address)
    ])

    // Parse minted
    let minted = BigInt(0)
    let canMint = true

    if (mintedResult.status === 'fulfilled') {
      const json = mintedResult.value as { okay?: boolean; result?: string; cause?: string }
      if (json.okay && typeof json.result === 'string') {
        const cv = hexToCV(json.result)
        const v = (cv as unknown as { value?: bigint | number | string }).value
        minted = v == null ? BigInt(0) : typeof v === 'bigint' ? v : BigInt(Number(v))
        canMint = minted === BigInt(0)
      }
    }

    // Parse balance
    let balance = '0'
    if (balanceResult.status === 'fulfilled') {
      const jBalance = balanceResult.value as { okay?: boolean; result?: string }
      if (jBalance.okay && typeof jBalance.result === 'string') {
        try {
          const cvBal = hexToCV(jBalance.result) as { type?: string; value?: { value?: bigint } | bigint }
          if (cvBal?.type === 'ok' && cvBal.value != null) {
            const v = (cvBal.value as { value?: bigint })?.value
            balance = v != null ? String(v) : '0'
          } else if (cvBal?.type === 'uint') {
            const v = (cvBal.value as bigint) ?? (cvBal.value as { value?: bigint })?.value
            balance = v != null ? String(v) : '0'
          }
        } catch {
          balance = '0'
        }
      }
    }

    return NextResponse.json({
      minted: String(minted),
      canMint,
      balance,
      ok: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'get-minted failed'
    console.error('[mint-status] Error:', msg)
    return NextResponse.json(
      { error: msg, ok: false },
      { status: 502 }
    )
  }
}
