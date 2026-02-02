#!/usr/bin/env node
/**
 * Verifica se um round existe no mapa `rounds` do bitpredix (map_entry).
 * Uso: node scripts/check-round.mjs [roundId]
 *   roundId opcional; default = minuto atual (floor(now/60)*60).
 * Carrega .env.local para BITPREDIX_ID.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = path.join(path.dirname(__dirname), '.env.local')
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

loadEnv()

const BITPREDIX_ID = process.env.BITPREDIX_CONTRACT_ID || process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID
const HIRO = 'https://api.testnet.hiro.so'

function parseContractId(id) {
  const i = id.lastIndexOf('.')
  if (i < 0) throw new Error(`Invalid contract id: ${id}`)
  return [id.slice(0, i), id.slice(i + 1)]
}

async function main() {
  const arg = process.argv[2]
  const roundId = arg != null && arg !== ''
    ? Math.floor(Number(arg) / 60) * 60
    : Math.floor(Date.now() / 1000 / 60) * 60

  if (!BITPREDIX_ID || !BITPREDIX_ID.includes('.')) {
    console.error('BITPREDIX_ID / NEXT_PUBLIC_BITPREDIX_CONTRACT_ID em .env.local.')
    process.exit(1)
  }

  const [addr, name] = parseContractId(BITPREDIX_ID)
  const { Cl, cvToHex, deserializeCV } = await import('@stacks/transactions')
  const keyHex = cvToHex(Cl.tuple({ 'round-id': Cl.uint(roundId) }))
  const url = `${HIRO}/v2/map_entry/${addr}/${name}/rounds?proof=0`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(keyHex),
  })
  const json = await res.json()

  console.log('Round ID consultado:', roundId)
  console.log('HTTP', res.status, '| hasData:', !!json.data)

  if (!res.ok || !json.data) {
    console.log('→ Round não encontrado (map_entry (none) ou erro).')
    process.exit(0)
  }

  const cv = deserializeCV(json.data)
  if (cv?.type === 'none') {
    console.log('→ Round não encontrado (none).')
    process.exit(0)
  }

  const tuple = cv?.type === 'some' && cv?.value ? cv.value : cv
  const d = tuple?.data ?? cv?.data
  if (!d) {
    console.log('→ Resposta inesperada (sem tuple data).')
    process.exit(1)
  }

  const u = (k) => Number(d[k]?.value ?? 0)
  const s = (k) => String(d[k]?.value ?? '')
  console.log('→ Round existe.')
  console.log('  status:', s('status'))
  console.log('  start-at:', u('start-at'))
  console.log('  ends-at:', u('ends-at'))
  console.log('  price-at-start:', u('price-at-start') / 1e6)
  console.log('  pool-up:', u('pool-up') / 1e6, '| pool-down:', u('pool-down') / 1e6)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
