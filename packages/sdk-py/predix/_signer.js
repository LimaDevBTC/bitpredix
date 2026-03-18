/**
 * Unified Stacks signer for the Predix Python SDK.
 * Reads JSON commands from stdin, writes JSON results to stdout.
 * Private key is passed via stdin (never in command args).
 */
const readline = require('readline')
const {
  createStacksPrivateKey,
  pubKeyfromPrivKey,
  publicKeyToHex,
  deserializeTransaction,
  TransactionSigner,
} = require('@stacks/transactions')
const { getStxAddress } = require('@stacks/wallet-sdk')

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  try {
    const cmd = JSON.parse(line)

    if (cmd.action === 'derive') {
      const address = getStxAddress({
        account: {
          stxPrivateKey: cmd.privateKey,
          dataPrivateKey: '',
          appsKey: '',
          salt: '',
          index: 0,
        },
        network: cmd.network || 'testnet',
      })
      const pubKey = publicKeyToHex(
        pubKeyfromPrivKey(createStacksPrivateKey(cmd.privateKey))
      )
      console.log(JSON.stringify({ address, publicKey: pubKey }))
    } else if (cmd.action === 'sign') {
      const tx = deserializeTransaction(cmd.txHex)
      const signer = new TransactionSigner(tx)
      signer.signOrigin(createStacksPrivateKey(cmd.privateKey))
      console.log(JSON.stringify({ signedHex: tx.serialize() }))
    } else {
      console.log(JSON.stringify({ error: `Unknown action: ${cmd.action}` }))
    }
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }))
  }
  rl.close()
})
