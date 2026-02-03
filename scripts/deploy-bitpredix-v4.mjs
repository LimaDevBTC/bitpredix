/**
 * Script para deploy do bitpredix-v4 na testnet Stacks
 *
 * Uso: ORACLE_MNEMONIC="..." node scripts/deploy-bitpredix-v4.mjs
 */

import { readFileSync } from 'fs'
import {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
} from '@stacks/transactions'
import { StacksTestnet } from '@stacks/network'
import { generateWallet } from '@stacks/wallet-sdk'

const MNEMONIC = process.env.ORACLE_MNEMONIC
if (!MNEMONIC) {
  console.error('❌ ORACLE_MNEMONIC not set')
  console.error('Usage: ORACLE_MNEMONIC="your mnemonic here" node scripts/deploy-bitpredix-v4.mjs')
  process.exit(1)
}

const CONTRACT_NAME = 'bitpredix-v4'
const CONTRACT_PATH = './contracts/bitpredix-v4.clar'

async function main() {
  console.log('🚀 Deploying bitpredix-v4 to Stacks testnet...\n')

  // 1. Gera wallet a partir da mnemonic
  console.log('📝 Generating wallet from mnemonic...')
  const wallet = await generateWallet({
    secretKey: MNEMONIC,
    password: '',
  })
  const account = wallet.accounts[0]
  const privateKey = account.stxPrivateKey
  const address = account.stxAddress?.testnet || account.address

  console.log(`   Address: ${address}`)

  // 2. Lê o código do contrato
  console.log(`📄 Reading contract from ${CONTRACT_PATH}...`)
  const codeBody = readFileSync(CONTRACT_PATH, 'utf8')
  console.log(`   Contract size: ${codeBody.length} bytes`)

  // 3. Busca o nonce atual
  console.log('🔍 Fetching current nonce...')
  const nonceRes = await fetch(`https://api.testnet.hiro.so/extended/v1/address/${address}/nonces`)
  const nonceData = await nonceRes.json()
  const nonce = nonceData.possible_next_nonce
  console.log(`   Nonce: ${nonce}`)

  // 4. Cria a transação de deploy
  console.log('📦 Creating deploy transaction...')
  const network = new StacksTestnet()

  const txOptions = {
    contractName: CONTRACT_NAME,
    codeBody,
    senderKey: privateKey,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    fee: 100000n, // 0.1 STX
    nonce: BigInt(nonce),
  }

  const transaction = await makeContractDeploy(txOptions)
  console.log(`   TX ID: ${transaction.txid()}`)

  // 5. Broadcast
  console.log('📡 Broadcasting transaction...')
  const broadcastResponse = await broadcastTransaction({ transaction, network })

  if (broadcastResponse.error) {
    console.error('❌ Broadcast failed:', broadcastResponse.error)
    console.error('   Reason:', broadcastResponse.reason)
    if (broadcastResponse.reason_data) {
      console.error('   Details:', JSON.stringify(broadcastResponse.reason_data, null, 2))
    }
    process.exit(1)
  }

  const txId = broadcastResponse.txid
  console.log('\n✅ Transaction broadcasted!')
  console.log(`   TX ID: ${txId}`)
  console.log(`   Explorer: https://explorer.hiro.so/txid/${txId}?chain=testnet`)
  console.log(`\n   Contract ID: ${address}.${CONTRACT_NAME}`)

  console.log('\n⏳ Waiting for confirmation (this may take 10-30 minutes on testnet)...')
  console.log('   You can check the status at the explorer link above.')

  // 6. Poll para confirmar
  let confirmed = false
  let attempts = 0
  const maxAttempts = 60 // 30 minutos

  while (!confirmed && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 30000)) // 30 segundos
    attempts++

    try {
      const statusRes = await fetch(`https://api.testnet.hiro.so/extended/v1/tx/${txId}`)
      const statusData = await statusRes.json()

      if (statusData.tx_status === 'success') {
        confirmed = true
        console.log('\n🎉 Contract deployed successfully!')
        console.log(`   Contract ID: ${address}.${CONTRACT_NAME}`)
        console.log('\n📋 Add to your .env.local:')
        console.log(`   NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=${address}.${CONTRACT_NAME}`)
      } else if (statusData.tx_status === 'abort_by_response' || statusData.tx_status === 'abort_by_post_condition') {
        console.error('\n❌ Transaction aborted:', statusData.tx_status)
        if (statusData.tx_result) {
          console.error('   Result:', statusData.tx_result)
        }
        process.exit(1)
      } else {
        console.log(`   [${attempts}/${maxAttempts}] Status: ${statusData.tx_status || 'pending'}...`)
      }
    } catch (e) {
      console.log(`   [${attempts}/${maxAttempts}] Checking...`)
    }
  }

  if (!confirmed) {
    console.log('\n⚠️  Timed out waiting for confirmation.')
    console.log('   The transaction may still be pending. Check the explorer.')
  }
}

main().catch(console.error)
