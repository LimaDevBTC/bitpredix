#!/usr/bin/env node
/**
 * Cron oráculo: a cada minuto (:00) deve executar:
 *   1) set-price(round-id do minuto que terminou, preço)
 *   2) resolve-round(round-id do minuto que terminou, preço) ← CORRIGIDO: recebe preço como param
 *   3) create-round(round-id do minuto novo, preço abertura)
 *
 * Sem isto, não existem rounds no mapa do bitpredix e a app mostra
 * "Nenhuma rodada on-chain".
 *
 * Obtém o nonce imediatamente antes de cada tx (set-price, resolve-round, create-round).
 * Assim não sobrescrevemos a create-round pendente com o set-price do tick seguinte.
 * AGUARDA confirmação de set-price e resolve-round antes de enviar a seguinte.
 *
 * Uso:
 *   ORACLE_PRIVATE_KEY=0x... node scripts/cron-oracle.mjs
 *   # Ou ORACLE_MNEMONIC (12/24 palavras) — deriva a chave; útil se a carteira (ex. Xverse) não exporta private key.
 *   ORACLE_MNEMONIC="word1 word2 ... word12" node scripts/cron-oracle.mjs
 *
 * Variáveis:
 *   ORACLE_PRIVATE_KEY  (opc.)  - Chave privada hex da carteira ORACLE. Alternativa: ORACLE_MNEMONIC.
 *   ORACLE_MNEMONIC     (opc.)  - Mnemonic (12 ou 24 palavras) da carteira ORACLE. Deriva a chave (path m/44'/5757'/0'/0/0).
 *   ORACLE_CONTRACT_ID  (opc.)  - ex. ST1....oracle. Default: NEXT_PUBLIC_ORACLE_CONTRACT_ID.
 *   BITPREDIX_CONTRACT_ID (opc.) - ex. ST1....bitpredix. Default: NEXT_PUBLIC_BITPREDIX_CONTRACT_ID.
 *
 * É obrigatório ORACLE_PRIVATE_KEY ou ORACLE_MNEMONIC.
 */

import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(path.dirname(__dirname))

// Carrega .env e .env.local (dotenv nao sobrescreve variaveis ja definidas)
dotenv.config({ path: path.join(root, '.env') })
dotenv.config({ path: path.join(root, '.env.local') })

const ORACLE_ID = process.env.ORACLE_CONTRACT_ID || process.env.NEXT_PUBLIC_ORACLE_CONTRACT_ID
const BITPREDIX_ID = process.env.BITPREDIX_CONTRACT_ID || process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID

function parseContractId(id) {
  const i = id.lastIndexOf('.')
  if (i < 0) throw new Error(`Invalid contract id: ${id}`)
  return [id.slice(0, i), id.slice(i + 1)]
}

async function fetchBtcPriceUsd() {
  const res = await fetch('https://www.bitstamp.net/api/v2/ticker/btcusd/', {
    headers: { Accept: 'application/json', 'User-Agent': 'Bitpredix-cron/1.0' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Bitstamp ${res.status}`)
  const d = await res.json()
  const v = d?.last
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  if (!(n > 0 && isFinite(n))) throw new Error('Invalid price from Bitstamp')
  return n
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Obtém a chave do oráculo: ORACLE_PRIVATE_KEY ou deriva de ORACLE_MNEMONIC (path m/44'/5757'/0'/0/0).
 * @returns {Promise<string>} Chave privada (hex, sem 0x) para usar como senderKey.
 */
async function getOracleKey() {
  const raw = (process.env.ORACLE_PRIVATE_KEY || '').trim().replace(/^0x/, '')
  if (raw && raw.length >= 32) return raw

  const mnemonicRaw = (process.env.ORACLE_MNEMONIC || '').trim().replace(/\s+/g, ' ')
  const mnemonic = mnemonicRaw.toLowerCase()
  if (!mnemonic || mnemonic.split(' ').length < 12) {
    throw new Error('Defina ORACLE_PRIVATE_KEY (hex) ou ORACLE_MNEMONIC (12/24 palavras) da carteira ORACLE.')
  }

  const { generateWallet, getStxAddress } = await import('@stacks/wallet-sdk')
  const wallet = await generateWallet({ secretKey: mnemonic, password: 'bitpredix-oracle' })
  const acc = wallet.accounts?.[0]
  if (!acc?.stxPrivateKey) throw new Error('ORACLE_MNEMONIC: falha ao derivar chave (conta 0).')
  const derived = getStxAddress({ account: acc, network: 'testnet' })
  const deployer = BITPREDIX_ID ? (BITPREDIX_ID.slice(0, BITPREDIX_ID.lastIndexOf('.'))) : ''
  if (deployer && derived !== deployer) {
    throw new Error(
      `ORACLE_MNEMONIC deriva para ${derived}, mas o ORACLE do contrato é ${deployer}. ` +
      'Usa o mnemonic da carteira que fez o deploy (Xverse) ou configura ORACLE_PRIVATE_KEY dessa carteira.'
    )
  }
  return acc.stxPrivateKey.replace(/^0x/, '')
}

/**
 * Executa um ciclo: set-price → aguarda confirm → resolve-round → aguarda confirm → create-round.
 * @throws {Error} se ORACLE_PRIVATE_KEY/ORACLE_MNEMONIC / CONTRACT_IDs em falta ou create-round falhar
 */
export async function runOneTick() {
  const key = await getOracleKey()
  if (!ORACLE_ID || !BITPREDIX_ID) {
    throw new Error('Defina ORACLE_CONTRACT_ID e BITPREDIX_CONTRACT_ID (ou NEXT_PUBLIC_* em .env.local).')
  }

  const [oracleAddr, oracleName] = parseContractId(ORACLE_ID)
  const [bpAddr, bpName] = parseContractId(BITPREDIX_ID)

  const nowSec = Math.floor(Date.now() / 1000)
  const roundIdEnd = Math.floor(nowSec / 60) * 60 - 60   // minuto que terminou
  const roundIdStart = Math.floor(nowSec / 60) * 60      // minuto actual

  let priceUsd
  try {
    priceUsd = await fetchBtcPriceUsd()
  } catch (e) {
    throw new Error('Falha ao obter preço BTC: ' + (e.message || e))
  }
  const price6 = Math.round(priceUsd * 1e6)

  const { makeContractCall, broadcastTransaction, Cl, getAddressFromPrivateKey, fetchNonce } = await import('@stacks/transactions')
  const network = 'testnet'
  /** Fee em uSTX; testnet precisa de mais que o mínimo para as tx serem mineradas. */
  const FEE_USTX = 200_000
  const continueOnCreateTimeout = /^1|true|yes$/i.test(String(process.env.CONTINUE_ON_CREATE_TIMEOUT || ''))

  const oracleAddress = getAddressFromPrivateKey(key.startsWith('0x') ? key : `0x${key}`, network)
  async function fetchNextNonce() {
    return fetchNonce({ address: oracleAddress, network })
  }

  async function waitForTx(txid, label, maxWaitMs = 240_000) {
    const base = 'https://api.testnet.hiro.so'
    const interval = 20_000
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const r = await fetch(`${base}/extended/v1/tx/${txid}`)
      if (r.ok) {
        const j = await r.json()
        const st = j?.tx_status ?? ''
        if (st === 'success') {
          console.log(label, 'confirmada.')
          return true
        }
        if (/^abort_|^dropped_/.test(st)) {
          console.warn(label, 'falhou ou descartada:', st)
          return false
        }
      }
      await sleep(interval)
    }
    const explorer = `https://explorer.hiro.so/txid/${txid}?chain=testnet`
    console.warn(label, 'não confirmada em', maxWaitMs / 1000, 's. Verifica:', explorer)
    return false
  }

  // 1) set-price(roundIdEnd, price) — preço de "fecho" do minuto que acabou
  // CORRIGIDO: aguarda confirmação (resolve-round agora recebe preço como param, mas mantemos set-price para histórico)
  let setPriceTxid = null
  try {
    const nonceSet = await fetchNextNonce()
    const txSet = await makeContractCall({
      contractAddress: oracleAddr,
      contractName: oracleName,
      functionName: 'set-price',
      functionArgs: [Cl.uint(roundIdEnd), Cl.uint(price6)],
      senderKey: key,
      network,
      fee: FEE_USTX,
      nonce: nonceSet,
    })
    const rSet = await broadcastTransaction({ transaction: txSet, network })
    if (rSet.txid) {
      setPriceTxid = rSet.txid
      console.log('set-price', roundIdEnd, 'tx:', rSet.txid)
    } else {
      console.warn('set-price broadcast falhou:', rSet)
    }
  } catch (e) {
    // set-price agora é idempotente: aceita duplicate com mesmo preço (ok), rejeita preço diferente (err u1)
    if (/err u1/i.test(String(e))) {
      console.log('set-price', roundIdEnd, 'já existia com preço diferente, a ignorar.')
    } else {
      console.warn('set-price erro:', e.message)
    }
  }

  // AGUARDAR confirmação de set-price (até 2 min) — garante que não há conflitos de nonce
  if (setPriceTxid) {
    console.log('A aguardar confirmação de set-price...')
    const confirmed = await waitForTx(setPriceTxid, 'set-price', 120_000)
    if (!confirmed) {
      console.warn('set-price não confirmada a tempo; a continuar...')
    }
  } else {
    // Sem txid (ex.: erro ou já existia) — espera 10s extra para propagação
    await sleep(10_000)
  }

  // 2) resolve-round(roundIdEnd, price) — só se o round existir (evita tx descartada e nonce órfão)
  let resolveRoundTxid = null
  let roundExists = false
  try {
    // Verificar se o round existe antes de tentar resolver
    const { cvToHex, deserializeCV } = await import('@stacks/transactions')
    const keyHex = cvToHex(Cl.tuple({ 'round-id': Cl.uint(roundIdEnd) }))
    const checkRes = await fetch(
      `https://api.testnet.hiro.so/v2/map_entry/${bpAddr}/${bpName}/rounds?proof=0`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(keyHex),
      }
    )
    if (checkRes.ok) {
      const checkJson = await checkRes.json()
      if (checkJson.data) {
        const cv = deserializeCV(checkJson.data)
        roundExists = cv?.type !== 'none' && cv?.type !== 9
      }
    }
  } catch (e) {
    console.warn('Erro ao verificar se round existe:', e.message)
  }

  if (roundExists) {
    try {
      console.log('A enviar resolve-round', roundIdEnd, '…')
      const nonceRes = await fetchNextNonce()
      const txRes = await makeContractCall({
        contractAddress: bpAddr,
        contractName: bpName,
        functionName: 'resolve-round',
        functionArgs: [Cl.uint(roundIdEnd), Cl.uint(price6)],
        senderKey: key,
        network,
        fee: FEE_USTX,
        nonce: nonceRes,
      })
      const rRes = await broadcastTransaction({ transaction: txRes, network })
      if (rRes.txid) {
        resolveRoundTxid = rRes.txid
        console.log('resolve-round', roundIdEnd, 'tx:', rRes.txid)
      } else {
        console.warn('resolve-round broadcast falhou:', rRes)
      }
    } catch (e) {
      console.warn('resolve-round erro (não enviado):', e.message)
    }

    // Esperar resolve-round confirmar (até 3 min) para só depois enviar create-round
    if (resolveRoundTxid) {
      const resolved = await waitForTx(resolveRoundTxid, 'resolve-round', 180_000)
      if (!resolved) {
        console.warn('resolve-round não confirmada a tempo; a continuar para create-round.')
      }
    }
  } else {
    console.log('resolve-round', roundIdEnd, 'ignorado (round não existe no contrato).')
  }

  // 3) create-round(roundIdStart, priceAtStart)
  try {
    console.log('A enviar create-round', roundIdStart, '…')
    const nonceCreate = await fetchNextNonce()
    const txCreate = await makeContractCall({
      contractAddress: bpAddr,
      contractName: bpName,
      functionName: 'create-round',
      functionArgs: [Cl.uint(roundIdStart), Cl.uint(price6)],
      senderKey: key,
      network,
      fee: FEE_USTX,
      nonce: nonceCreate,
    })
    const rCreate = await broadcastTransaction({ transaction: txCreate, network })
    if (rCreate.txid) {
      console.log('create-round', roundIdStart, 'tx:', rCreate.txid)
      const ok = await waitForTx(rCreate.txid, 'create-round')
      if (!ok && !continueOnCreateTimeout) {
        throw new Error('create-round não confirmada; rounds não foram criados on-chain. (CONTINUE_ON_CREATE_TIMEOUT=1 para não parar.)')
      }
    } else {
      throw new Error('create-round broadcast falhou: ' + JSON.stringify(rCreate))
    }
  } catch (e) {
    if (/create-round|broadcast/i.test(String(e))) throw e
    throw new Error('create-round: ' + (e.message || e))
  }

  console.log('Cron oráculo concluído. Round', roundIdStart, 'criado.')
}

// Só executa quando chamado directamente: node scripts/cron-oracle.mjs
const __path = fileURLToPath(import.meta.url)
const isMain = process.argv[1] && path.resolve(process.cwd(), process.argv[1]) === path.resolve(__path)
if (isMain) {
  runOneTick().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
