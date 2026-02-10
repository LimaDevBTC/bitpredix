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
    ? Number(arg)
    : Math.floor(Date.now() / 1000 / 60)

  if (!BITPREDIX_ID || !BITPREDIX_ID.includes('.')) {
    console.error('BITPREDIX_ID / NEXT_PUBLIC_BITPREDIX_CONTRACT_ID em .env.local.')
    process.exit(1)
  }

  const [addr, name] = parseContractId(BITPREDIX_ID)
  const { uintCV, tupleCV, cvToHex, deserializeCV } = await import('@stacks/transactions')
  const keyHex = cvToHex(tupleCV({ 'round-id': uintCV(roundId) }))
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

  // Campos do contrato v5: total-up, total-down, price-start, price-end, resolved
  const u = (k) => Number(d[k]?.value ?? 0)
  const b = (k) => d[k]?.value === true
  console.log('→ Round existe.')
  console.log('  resolved:', b('resolved'))
  console.log('  start-at (computed):', roundId * 60)
  console.log('  ends-at (computed):', (roundId + 1) * 60)
  console.log('  price-start:', u('price-start') / 100)
  console.log('  price-end:', u('price-end') / 100)
  console.log('  total-up:', u('total-up') / 1e6, '| total-down:', u('total-down') / 1e6)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
