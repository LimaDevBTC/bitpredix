/**
 * Script para deploy do bitpredix-v6 na testnet Stacks
 *
 * Uso: ORACLE_MNEMONIC="..." node scripts/deploy-bitpredix-v6.mjs
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import txPkg from '@stacks/transactions'
const {
  makeContractDeploy,
  AnchorMode,
  PostConditionMode,
  ClarityVersion,
} = txPkg
import netPkg from '@stacks/network'
const { STACKS_TESTNET } = netPkg
import walletPkg from '@stacks/wallet-sdk'
const { generateWallet, getStxAddress } = walletPkg

const MNEMONIC = process.env.ORACLE_MNEMONIC
if (!MNEMONIC) {
  console.error('ORACLE_MNEMONIC not set')
  console.error('Usage: ORACLE_MNEMONIC="..." node scripts/deploy-bitpredix-v6.mjs')
  process.exit(1)
}

const CONTRACT_NAME = 'bitpredix-v6'
const CONTRACT_PATH = './contracts/bitpredix-v6.clar'

function curlGet(url) {
  try {
    const result = execSync(`curl -s --max-time 30 "${url}"`, { encoding: 'utf8' })
    return JSON.parse(result)
  } catch (e) {
    console.error('Curl error:', e.message)
    throw e
  }
}

async function main() {
  console.log('Deploying bitpredix-v6 to Stacks testnet...\n')

  // 1. Gera wallet a partir da mnemonic
  console.log('Generating wallet from mnemonic...')
  const wallet = await generateWallet({
    secretKey: MNEMONIC,
    password: '',
  })
  const account = wallet.accounts[0]
  const privateKey = account.stxPrivateKey

  const address = getStxAddress({ account, network: 'testnet' })
  console.log(`   Address: ${address}`)

  // 2. Le o codigo do contrato
  console.log(`Reading contract from ${CONTRACT_PATH}...`)
  const codeBody = readFileSync(CONTRACT_PATH, 'utf8')
  console.log(`   Contract size: ${codeBody.length} bytes`)

  // 3. Busca o nonce atual
  console.log('Fetching current nonce...')
  const nonceData = curlGet(`https://api.testnet.hiro.so/extended/v1/address/${address}/nonces`)
  const nonce = nonceData.possible_next_nonce
  console.log(`   Nonce: ${nonce}`)

  // 4. Cria a transacao de deploy (Clarity v2 para suportar index-of?)
  console.log('Creating deploy transaction (Clarity v2)...')
  const network = STACKS_TESTNET

  const txOptions = {
    contractName: CONTRACT_NAME,
    codeBody,
    senderKey: privateKey,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    clarityVersion: ClarityVersion.Clarity2,
    fee: 100000n, // 0.1 STX
    nonce: BigInt(nonce),
  }

  const transaction = await makeContractDeploy(txOptions)
  const txId = transaction.txid()
  console.log(`   TX ID: ${txId}`)

  // 5. Broadcast
  console.log('Broadcasting transaction...')

  const hexTx = transaction.serialize()
  const binaryTx = Buffer.from(hexTx, 'hex')

  const tmpFile = '/tmp/stx-deploy-v6-tx.bin'
  writeFileSync(tmpFile, binaryTx)
  console.log(`   Saved ${binaryTx.length} bytes to ${tmpFile}`)

  const broadcastResult = execSync(
    `curl -s --max-time 60 -X POST -H "Content-Type: application/octet-stream" --data-binary @${tmpFile} "https://api.testnet.hiro.so/v2/transactions"`,
    { encoding: 'utf8' }
  )

  try { unlinkSync(tmpFile) } catch {}

  let broadcastData
  try {
    broadcastData = JSON.parse(broadcastResult)
  } catch {
    broadcastData = { txid: broadcastResult.trim().replace(/"/g, '') }
  }

  if (broadcastData.error) {
    console.error('Broadcast failed:', broadcastData.error)
    console.error('   Reason:', broadcastData.reason)
    if (broadcastData.reason_data) {
      console.error('   Details:', JSON.stringify(broadcastData.reason_data, null, 2))
    }
    process.exit(1)
  }

  console.log('\nTransaction broadcasted!')
  console.log(`   TX ID: ${txId}`)
  console.log(`   Explorer: https://explorer.hiro.so/txid/${txId}?chain=testnet`)
  console.log(`   Contract ID: ${address}.${CONTRACT_NAME}`)

  console.log('\nWaiting for confirmation (10-30 min on testnet)...')

  // 6. Poll para confirmar
  let confirmed = false
  let attempts = 0
  const maxAttempts = 60

  while (!confirmed && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 30000))
    attempts++

    try {
      const statusData = curlGet(`https://api.testnet.hiro.so/extended/v1/tx/${txId}`)

      if (statusData.tx_status === 'success') {
        confirmed = true
        console.log('\nContract deployed successfully!')
        console.log(`   Contract ID: ${address}.${CONTRACT_NAME}`)
      } else if (statusData.tx_status === 'abort_by_response' || statusData.tx_status === 'abort_by_post_condition') {
        console.error('\nTransaction aborted:', statusData.tx_status)
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
    console.log('\nTimed out waiting for confirmation.')
    console.log('   The transaction may still be pending. Check the explorer.')
  }
}

main().catch(console.error)
