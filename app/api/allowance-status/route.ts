import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HIRO_TESTNET = 'https://api.testnet.hiro.so'
const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v5'
const FETCH_TIMEOUT = 10000

/**
 * Verifica o allowance de um usuário para o contrato BitPredix
 *
 * GET /api/allowance-status?address=<stx_address>
 *
 * Retorna:
 * - allowance: string (valor em microunits)
 * - hasAllowance: boolean (true se > 0)
 * - ok: boolean
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')

  if (!address) {
    return NextResponse.json(
      { error: 'Missing address parameter', ok: false },
      { status: 400 }
    )
  }

  if (!TOKEN_CONTRACT || !BITPREDIX_CONTRACT) {
    return NextResponse.json(
      { error: 'Contracts not configured', ok: false },
      { status: 500 }
    )
  }

  try {
    const { Cl, cvToHex, hexToCV, cvToJSON } = await import('@stacks/transactions')

    const [tokenAddr, tokenName] = TOKEN_CONTRACT.split('.')
    if (!tokenAddr || !tokenName) {
      return NextResponse.json(
        { error: 'Invalid token contract ID', ok: false },
        { status: 500 }
      )
    }

    // Tenta primeiro usar get-allowance (se o contrato foi atualizado)
    // Se falhar, tenta ler o map diretamente
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    try {
      // Método 1: Chama get-allowance se existir
      const response = await fetch(
        `${HIRO_TESTNET}/v2/contracts/call-read/${tokenAddr}/${tokenName}/get-allowance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: address,
            arguments: [
              cvToHex(Cl.principal(address)),       // owner
              cvToHex(Cl.principal(BITPREDIX_CONTRACT))  // spender
            ]
          }),
          signal: controller.signal
        }
      )

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        console.log('[allowance-status] get-allowance response:', data)

        if (data.okay && data.result) {
          const cv = hexToCV(data.result)
          const json = cvToJSON(cv)

          // get-allowance retorna uint diretamente
          const allowance = json?.value ?? '0'
          const allowanceNum = BigInt(allowance)

          return NextResponse.json({
            allowance: String(allowance),
            hasAllowance: allowanceNum > BigInt(0),
            ok: true
          })
        }
      }
    } catch (e) {
      // get-allowance pode não existir no contrato antigo
      console.log('[allowance-status] get-allowance not available, trying map read')
    }

    // Método 2: Lê o map allowances diretamente
    // Formato do key: tuple { owner: principal, spender: principal }
    const keyCV = Cl.tuple({
      owner: Cl.principal(address),
      spender: Cl.principal(BITPREDIX_CONTRACT)
    })
    const keyHex = cvToHex(keyCV)

    console.log('[allowance-status] Reading map with key:', keyHex)

    const controller2 = new AbortController()
    const timeoutId2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT)

    const mapResponse = await fetch(
      `${HIRO_TESTNET}/v2/map_entry/${tokenAddr}/${tokenName}/allowances`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Hiro API expects hex string directly (with quotes) in JSON body
        body: `"${keyHex}"`,
        signal: controller2.signal
      }
    )

    clearTimeout(timeoutId2)

    if (!mapResponse.ok) {
      const errorText = await mapResponse.text()
      console.error('[allowance-status] Map read failed:', mapResponse.status, errorText)
      return NextResponse.json(
        { error: `Hiro API error: ${mapResponse.status}`, ok: false },
        { status: 502 }
      )
    }

    const mapData = await mapResponse.json()
    console.log('[allowance-status] map_entry response:', JSON.stringify(mapData))

    // Se o map entry existe, parsea o valor
    if (mapData.data) {
      const cv = hexToCV(mapData.data)
      const json = cvToJSON(cv)
      console.log('[allowance-status] Parsed map value:', JSON.stringify(json))

      // O valor no map é um uint (some) ou none
      let allowance = '0'
      if (json?.type === 'some' && json?.value?.value != null) {
        allowance = String(json.value.value)
      } else if (json?.type === 'uint') {
        allowance = String(json.value)
      } else if (json?.value != null) {
        allowance = String(json.value)
      }

      const allowanceNum = BigInt(allowance)
      console.log('[allowance-status] Final allowance:', allowance, 'hasAllowance:', allowanceNum > BigInt(0))

      return NextResponse.json({
        allowance,
        hasAllowance: allowanceNum > BigInt(0),
        ok: true
      })
    }

    // Map entry não existe = allowance 0
    console.log('[allowance-status] No map entry found, allowance = 0')
    return NextResponse.json({
      allowance: '0',
      hasAllowance: false,
      ok: true
    })

  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timeout', ok: false },
        { status: 504 }
      )
    }

    console.error('[allowance-status] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to check allowance', ok: false },
      { status: 500 }
    )
  }
}
