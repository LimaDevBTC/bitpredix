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
    const [contractAddress, contractName] = parseContractId(CONTRACT_ID)
    const argHex = cvToHex(Cl.principal(address))
    const base = { method: 'POST' as const, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: address, arguments: [argHex] }) }

    const [resMinted, resBalance] = await Promise.all([
      fetch(`${HIRO_TESTNET}/v2/contracts/call-read/${contractAddress}/${contractName}/get-minted`, base),
      fetch(`${HIRO_TESTNET}/v2/contracts/call-read/${contractAddress}/${contractName}/get-balance`, base),
    ])

    const json = (await resMinted.json()) as { okay?: boolean; result?: string; cause?: string }
    if (!resMinted.ok || !json.okay || typeof json.result !== 'string') {
      throw new Error(json.cause || `Hiro API ${resMinted.status}`)
    }
    const cv = hexToCV(json.result)
    const v = (cv as unknown as { value?: bigint | number | string }).value
    const minted = v == null ? BigInt(0) : typeof v === 'bigint' ? v : BigInt(Number(v))
    const canMint = minted === BigInt(0)

    let balance = '0'
    try {
      const jBalance = (await resBalance.json()) as { okay?: boolean; result?: string }
      if (resBalance.ok && jBalance.okay && typeof jBalance.result === 'string') {
        const cvBal = hexToCV(jBalance.result) as { type?: string; value?: { value?: bigint } | bigint }
        // get-balance retorna (ok uint). ResponseOkCV: type='ok', value=UIntCV { value: bigint }.
        // Se a API desempacotar (ok x), vem UIntCV: type='uint', value=bigint.
        if (cvBal?.type === 'ok' && cvBal.value != null) {
          const v = (cvBal.value as { value?: bigint })?.value
          balance = v != null ? String(v) : '0'
        } else if (cvBal?.type === 'uint') {
          const v = (cvBal.value as bigint) ?? (cvBal.value as { value?: bigint })?.value
          balance = v != null ? String(v) : '0'
        }
      }
    } catch {
      balance = '0'
    }

    return NextResponse.json({
      minted: String(minted),
      canMint,
      balance,
      ok: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'get-minted failed'
    return NextResponse.json(
      { error: msg, ok: false },
      { status: 502 }
    )
  }
}
