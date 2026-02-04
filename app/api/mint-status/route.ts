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
    const { Cl, cvToHex, hexToCV, cvToJSON } = await import('@stacks/transactions')
    const argHex = cvToHex(Cl.principal(address))

    console.log(`[mint-status] Checking for address: ${address}`)

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
      console.log('[mint-status] get-minted raw response:', JSON.stringify(json))

      if (json.okay && typeof json.result === 'string') {
        const cv = hexToCV(json.result)
        const cvJson = cvToJSON(cv)
        console.log('[mint-status] get-minted parsed:', JSON.stringify(cvJson))

        // get-minted retorna uint diretamente (não wrapped em ok/err)
        const v = cvJson?.value
        minted = v == null ? BigInt(0) : BigInt(String(v))
        canMint = minted === BigInt(0)

        console.log(`[mint-status] minted=${minted}, canMint=${canMint}`)
      }
    } else {
      console.error('[mint-status] get-minted failed:', mintedResult.reason)
    }

    // Parse balance
    let balance = '0'
    if (balanceResult.status === 'fulfilled') {
      const jBalance = balanceResult.value as { okay?: boolean; result?: string }
      console.log('[mint-status] get-balance raw response:', JSON.stringify(jBalance))

      if (jBalance.okay && typeof jBalance.result === 'string') {
        try {
          const cvBal = hexToCV(jBalance.result)
          const cvBalJson = cvToJSON(cvBal)
          console.log('[mint-status] get-balance parsed:', JSON.stringify(cvBalJson))

          // get-balance retorna (ok uint) - precisamos extrair o valor
          if (cvBalJson?.type === 'ok' && cvBalJson.value != null) {
            const v = cvBalJson.value?.value ?? cvBalJson.value
            balance = v != null ? String(v) : '0'
          } else if (cvBalJson?.type === 'uint') {
            balance = String(cvBalJson.value ?? '0')
          }
        } catch (e) {
          console.error('[mint-status] balance parse error:', e)
          balance = '0'
        }
      }
    } else {
      console.error('[mint-status] get-balance failed:', balanceResult.reason)
    }

    console.log(`[mint-status] Final result: minted=${minted}, canMint=${canMint}, balance=${balance}`)

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
