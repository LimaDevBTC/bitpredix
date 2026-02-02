#!/usr/bin/env node
/**
 * Verifica qual endereço STX (testnet) deriva do ORACLE_MNEMONIC.
 * O contrato exige que create-round seja assinado pelo ORACLE (deployer).
 * Compara com o deployer em .env.local (NEXT_PUBLIC_BITPREDIX_CONTRACT_ID).
 *
 * Uso: ORACLE_MNEMONIC="word1 ... word12" node scripts/oracle-check-address.mjs
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

const mnemonicRaw = (process.env.ORACLE_MNEMONIC || '').trim().replace(/\s+/g, ' ')
const mnemonic = mnemonicRaw.toLowerCase()
const bitpredixId = process.env.BITPREDIX_CONTRACT_ID || process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || ''
const deployer = bitpredixId ? bitpredixId.slice(0, bitpredixId.lastIndexOf('.')) : ''

async function main() {
  if (!mnemonic || mnemonic.split(' ').length < 12) {
    console.error('Defina ORACLE_MNEMONIC (12 ou 24 palavras).')
    process.exit(1)
  }

  const { generateWallet, getStxAddress } = await import('@stacks/wallet-sdk')
  const wallet = await generateWallet({ secretKey: mnemonic, password: 'bitpredix-oracle' })
  const acc = wallet.accounts?.[0]
  if (!acc) {
    console.error('Falha ao derivar conta 0.')
    process.exit(1)
  }

  const derived = getStxAddress({ account: acc, network: 'testnet' })
  console.log('Endereço derivado do mnemonic (testnet):', derived)
  if (deployer) {
    console.log('ORACLE/deployer do contrato:          ', deployer)
    console.log('Coincidem?', derived === deployer ? 'Sim' : 'NÃO — create-round vai falhar (u401). Usa o mnemonic da carteira deployer.')
  } else {
    console.log('(.env.local sem BITPREDIX_ID — não é possível comparar.)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
