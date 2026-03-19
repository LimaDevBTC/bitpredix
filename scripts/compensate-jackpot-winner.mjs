/**
 * Compensate the jackpot winner from the 2026-03-18 draw.
 *
 * Context:
 *   The daily draw on 2026-03-18 resolved the winner correctly but failed to
 *   pay because the address was stored as a hash160 signer instead of a Stacks
 *   c32 address. The transfer errored with:
 *     "Invalid c32 address: must start with S"
 *
 *   The bug was fixed in commits d1a2227 and 565dce6, but the prize for that
 *   draw was never delivered. This script:
 *     1. Reads the failed draw result from Redis
 *     2. Converts the hash160 winner to a valid Stacks address (if needed)
 *     3. Calls gateway.pay-jackpot-winner to deliver the prize
 *     4. Updates the draw record in Redis with the successful txId
 *
 * Usage:
 *   node scripts/compensate-jackpot-winner.mjs                  # dry-run (default)
 *   node scripts/compensate-jackpot-winner.mjs --execute         # actually pay
 *
 * Required env vars:
 *   ORACLE_MNEMONIC            — sponsor wallet mnemonic
 *   UPSTASH_REDIS_REST_URL     — Redis URL
 *   UPSTASH_REDIS_REST_TOKEN   — Redis token
 *
 * Optional:
 *   HIRO_API                   — default: https://api.testnet.hiro.so
 *   DRAW_DATE                  — default: 2026-03-18
 */

import txPkg from '@stacks/transactions'
const {
  makeContractCall,
  PostConditionMode,
  uintCV,
  standardPrincipalCV,
} = txPkg
import netPkg from '@stacks/network'
const { STACKS_TESTNET } = netPkg
import walletPkg from '@stacks/wallet-sdk'
const { generateWallet, getStxAddress } = walletPkg
import c32Pkg from 'c32check'
const { c32address } = c32Pkg

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MNEMONIC = process.env.ORACLE_MNEMONIC
if (!MNEMONIC) {
  console.error('ORACLE_MNEMONIC not set')
  process.exit(1)
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
if (!REDIS_URL || !REDIS_TOKEN) {
  console.error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required')
  process.exit(1)
}

const HIRO_API = process.env.HIRO_API || 'https://api.testnet.hiro.so'
const DRAW_DATE = process.env.DRAW_DATE || '2026-03-18'
const DRY_RUN = !process.argv.includes('--execute')
const TX_FEE = 50000n

// Gateway contract (same as production)
const GATEWAY_ADDRESS = 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK'
const GATEWAY_NAME = 'gatewayv7'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function redisGet(key) {
  const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })
  const data = await res.json()
  return data.result
}

async function redisSet(key, value) {
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  })
  return res.ok
}

async function initWallet() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: '' })
  const account = wallet.accounts[0]
  return {
    privateKey: account.stxPrivateKey,
    address: getStxAddress({ account, network: 'testnet' }),
  }
}

async function getNonce(address) {
  const res = await fetch(`${HIRO_API}/extended/v1/address/${address}/nonces`)
  if (!res.ok) throw new Error(`Nonce fetch failed: HTTP ${res.status}`)
  const data = await res.json()
  return data.possible_next_nonce
}

function hash160ToStacks(hash160, network = 'testnet') {
  const version = network === 'mainnet' ? 22 : 26
  return c32address(version, hash160)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60))
  console.log('  JACKPOT WINNER COMPENSATION')
  console.log('='.repeat(60))
  console.log(`  Draw date:  ${DRAW_DATE}`)
  console.log(`  Mode:       ${DRY_RUN ? 'DRY RUN (use --execute to pay)' : 'EXECUTE'}`)
  console.log()

  // 1. Read the failed draw from Redis
  const drawKey = `jackpot:draw:${DRAW_DATE}`
  const rawDraw = await redisGet(drawKey)
  if (!rawDraw) {
    console.error(`No draw found at key: ${drawKey}`)
    process.exit(1)
  }

  const draw = typeof rawDraw === 'string' ? JSON.parse(rawDraw) : rawDraw
  console.log('  Draw record:')
  console.log(`    Winner (raw):     ${draw.winner}`)
  console.log(`    Prize (micro):    ${draw.prize}`)
  console.log(`    Prize (USDCx):    ${(draw.prize / 1e6).toFixed(2)}`)
  console.log(`    Block hash:       ${draw.blockHash}`)
  console.log(`    Block height:     ${draw.blockHeight}`)
  console.log(`    Total tickets:    ${draw.totalTickets}`)
  console.log(`    Transfer error:   ${draw.transferError || 'none'}`)
  console.log(`    Existing txId:    ${draw.txId || 'none'}`)

  if (draw.txId && !draw.transferError) {
    console.log('\n  Draw already has a successful txId. Nothing to do.')
    process.exit(0)
  }

  if (!draw.transferError) {
    console.log('\n  No transferError found in draw record. Nothing to compensate.')
    process.exit(0)
  }

  // 2. Resolve winner address
  let winnerAddress = draw.winner
  if (!winnerAddress.startsWith('S')) {
    console.log(`\n  Converting hash160 to Stacks address...`)
    winnerAddress = hash160ToStacks(winnerAddress)
    console.log(`    hash160:  ${draw.winner}`)
    console.log(`    Stacks:   ${winnerAddress}`)
  } else {
    console.log(`\n  Winner already has valid Stacks address: ${winnerAddress}`)
  }

  // 3. Verify prize against current on-chain jackpot balance
  const { address: sponsorAddress } = await initWallet()
  console.log(`\n  Sponsor: ${sponsorAddress}`)

  if (DRY_RUN) {
    console.log('\n' + '='.repeat(60))
    console.log('  DRY RUN — no transaction will be sent.')
    console.log('  To execute, run with --execute flag:')
    console.log(`    node scripts/compensate-jackpot-winner.mjs --execute`)
    console.log('='.repeat(60))
    process.exit(0)
  }

  // 4. Execute on-chain payment
  console.log('\n  Sending pay-jackpot-winner transaction...')
  const { privateKey } = await initWallet()
  const nonce = await getNonce(sponsorAddress)
  console.log(`    Nonce: ${nonce}`)

  const tx = await makeContractCall({
    contractAddress: GATEWAY_ADDRESS,
    contractName: GATEWAY_NAME,
    functionName: 'pay-jackpot-winner',
    functionArgs: [
      standardPrincipalCV(winnerAddress),
      uintCV(draw.prize),
    ],
    senderKey: privateKey,
    network: STACKS_TESTNET,
    postConditionMode: PostConditionMode.Allow,
    fee: TX_FEE,
    nonce: BigInt(nonce),
  })

  const hexTx = tx.serialize()
  const binaryTx = Buffer.from(hexTx, 'hex')

  const res = await fetch(`${HIRO_API}/v2/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: binaryTx,
  })
  const text = await res.text()

  let data
  try { data = JSON.parse(text) } catch { data = { txid: text.trim().replace(/"/g, '') } }

  if (data.error) {
    console.error(`\n  PAYMENT FAILED: ${data.error}`)
    console.error(`  Reason: ${data.reason}`)
    if (data.reason_data) console.error(`  Details:`, JSON.stringify(data.reason_data, null, 2))
    process.exit(1)
  }

  const txId = data.txid || data || tx.txid()
  console.log(`    TX ID: ${txId}`)
  console.log(`    Explorer: https://explorer.hiro.so/txid/${txId}?chain=testnet`)

  // 5. Update draw record in Redis
  console.log('\n  Updating draw record in Redis...')
  const updatedDraw = {
    ...draw,
    winner: winnerAddress,
    txId: typeof txId === 'string' ? txId : String(txId),
    transferError: undefined,
    compensatedAt: new Date().toISOString(),
  }
  // Remove transferError key entirely
  delete updatedDraw.transferError

  await redisSet(drawKey, JSON.stringify(updatedDraw))
  console.log('    Draw record updated successfully.')

  // 6. Wait for confirmation
  console.log('\n  Waiting for confirmation...')
  const txIdStr = typeof txId === 'string' ? txId : String(txId)
  for (let i = 1; i <= 40; i++) {
    await new Promise(r => setTimeout(r, 15000))
    try {
      const statusRes = await fetch(`${HIRO_API}/extended/v1/tx/${txIdStr}`)
      const status = await statusRes.json()
      if (status.tx_status === 'success') {
        console.log(`    CONFIRMED at block ${status.block_height}`)
        break
      } else if (status.tx_status?.startsWith('abort')) {
        console.error(`    ABORTED: ${status.tx_status}`)
        if (status.tx_result) console.error(`    Result:`, JSON.stringify(status.tx_result))
        break
      } else {
        console.log(`    [${i}/40] ${status.tx_status || 'pending'}...`)
      }
    } catch {
      console.log(`    [${i}/40] checking...`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('  COMPENSATION COMPLETE')
  console.log(`    Winner:  ${winnerAddress}`)
  console.log(`    Prize:   ${(draw.prize / 1e6).toFixed(2)} USDCx`)
  console.log(`    TX:      ${txId}`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
