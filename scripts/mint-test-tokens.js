#!/usr/bin/env node
/**
 * Script para mintar 1 000 USD teste (test-usdcx) na testnet.
 * O mint é feito para tx-sender (quem assina). Uma vez por endereço.
 *
 * Uso:
 *   PRIVATE_KEY=0x... CONTRACT_ID=ST1....test-usdcx node scripts/mint-test-tokens.js
 *   # ou
 *   PRIVATE_KEY=0x... node scripts/mint-test-tokens.js
 *
 * Variáveis:
 *   PRIVATE_KEY  (obrig.) - Chave privada em hex (com ou sem 0x).
 *   CONTRACT_ID  (opc.)   - ex. ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx
 *                           Default: NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID do .env ou este valor.
 *
 * Para obter a chave a partir do mnemonic em settings/Testnet.toml: use Xverse/Leather
 * em testnet para exportar a chave, ou um script com @scure/bip39 + @scure/bip32 (path m/44'/5757'/0'/0/0).
 */

const fs = require('fs')
const path = require('path')

async function main() {
  const privateKeyHex = process.env.PRIVATE_KEY
  if (!privateKeyHex || typeof privateKeyHex !== 'string') {
    console.error('Defina PRIVATE_KEY (hex, com ou sem 0x).')
    process.exit(1)
  }
  const key = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex

  let contractId = process.env.CONTRACT_ID
  if (!contractId) {
    const envPath = path.join(process.cwd(), '.env.local')
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8')
      const m = env.match(/NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID=(.+)/)
      if (m) contractId = m[1].trim().replace(/^["']|["']$/g, '')
    }
    if (!contractId) {
      contractId = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx'
    }
  }

  const i = contractId.lastIndexOf('.')
  if (i < 0) {
    console.error('CONTRACT_ID inválido (esperado: address.contract-name)')
    process.exit(1)
  }
  const contractAddress = contractId.slice(0, i)
  const contractName = contractId.slice(i + 1)

  const { makeContractCall, broadcastTransaction } = await import('@stacks/transactions')

  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName: 'mint',
    functionArgs: [],
    senderKey: key,
    network: 'testnet',
  })

  const r = await broadcastTransaction({ transaction: tx, network: 'testnet' })
  if (r.txid) {
    console.log('Tx enviada:', r.txid)
    console.log('Explorer: https://explorer.hiro.so/txid/' + r.txid + '?chain=testnet')
  } else {
    console.error('Broadcast falhou:', r)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
