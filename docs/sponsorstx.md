# Sponsored Transactions - Plano de Implementacao

## Objetivo
Usuarios nao precisam ter STX na carteira. O deployer paga as taxas de todas as transacoes.
A wallet ainda abre popup para o user assinar, mas o fee e zero para ele.

---

## Como funciona

```
User clica UP/DOWN
       |
       v
openContractCall({ sponsored: true })
       |
       v
Wallet abre popup (fee = 0 STX)
User assina
       |
       v
onFinish recebe { txRaw }  (tx assinada, NAO broadcasted)
       |
       v
POST /api/sponsor  { txHex: txRaw }
       |
       v
Backend:
  1. deserializeTransaction(txHex)
  2. Valida: e para o contrato predixv1 ou test-usdcx?
  3. sponsorTransaction({ transaction, sponsorPrivateKey, fee })
  4. broadcastTransaction(sponsoredTx)
       |
       v
Retorna { txid } para o frontend
```

---

## Arquivos a modificar/criar

| Arquivo | Acao |
|---|---|
| `app/api/sponsor/route.ts` | **NOVO** - API route que sponsora e broadcasta |
| `components/MarketCardV4.tsx` | Modificar `buy()`, `enableTrading()`, `mintTokens()` |
| `components/ClaimButton.tsx` | Modificar `handleClaim()` |

---

## PASSO 1: Criar `/app/api/sponsor/route.ts`

### 1.1 Funcionalidade
- Recebe `txHex` (transacao assinada pelo user, serializada em hex)
- Deserializa e valida que a tx e para contratos permitidos
- Sponsora com a chave do deployer (derivada de `ORACLE_MNEMONIC`)
- Broadcasta na rede
- Retorna `{ txid }` ou `{ error }`

### 1.2 Codigo

```typescript
import { NextRequest, NextResponse } from 'next/server'
import {
  deserializeTransaction,
  sponsorTransaction,
  broadcastTransaction,
} from '@stacks/transactions'
import { generateWallet, getStxAddress } from '@stacks/wallet-sdk'

// Contratos permitidos para sponsorship
const ALLOWED_CONTRACTS = [
  process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv1',
  process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID || 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx',
]

// Funcoes permitidas
const ALLOWED_FUNCTIONS = [
  'place-bet',
  'claim-round-side',
  'approve',
  'mint',
]

// Cache da private key do sponsor (derivada uma vez)
let sponsorKeyCache: string | null = null

async function getSponsorPrivateKey(): Promise<string> {
  if (sponsorKeyCache) return sponsorKeyCache

  const mnemonic = process.env.ORACLE_MNEMONIC
  if (!mnemonic) throw new Error('ORACLE_MNEMONIC not configured')

  const wallet = await generateWallet({ secretKey: mnemonic, password: '' })
  const account = wallet.accounts[0]
  sponsorKeyCache = account.stxPrivateKey
  return sponsorKeyCache
}

export async function POST(req: NextRequest) {
  try {
    const { txHex } = await req.json()

    if (!txHex || typeof txHex !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid txHex' }, { status: 400 })
    }

    // 1. Deserializa a transacao
    const transaction = deserializeTransaction(txHex)

    // 2. Valida que e um contract-call para contratos permitidos
    const payload = transaction.payload
    if (payload.payloadType !== 2) {
      // payloadType 2 = ContractCall
      return NextResponse.json({ error: 'Only contract calls are allowed' }, { status: 400 })
    }

    const contractId = `${payload.contractAddress}.${payload.contractName}`
    if (!ALLOWED_CONTRACTS.includes(contractId)) {
      return NextResponse.json(
        { error: `Contract ${contractId} not allowed for sponsorship` },
        { status: 403 }
      )
    }

    const functionName = payload.functionName
    if (!ALLOWED_FUNCTIONS.includes(functionName)) {
      return NextResponse.json(
        { error: `Function ${functionName} not allowed for sponsorship` },
        { status: 403 }
      )
    }

    // 3. Sponsora a transacao
    const sponsorPrivateKey = await getSponsorPrivateKey()

    const sponsoredTx = await sponsorTransaction({
      transaction,
      sponsorPrivateKey,
      fee: 50000n, // 0.05 STX - suficiente para contract calls na testnet
      // sponsorNonce: omitido - auto-fetch da rede
    })

    // 4. Broadcasta
    const result = await broadcastTransaction(sponsoredTx, 'testnet')

    // broadcastTransaction retorna string (txid) ou objeto com error
    if (typeof result === 'string') {
      return NextResponse.json({ txid: result })
    }

    if (result && typeof result === 'object' && 'error' in result) {
      console.error('[sponsor] Broadcast failed:', result)
      return NextResponse.json(
        { error: (result as any).error, reason: (result as any).reason },
        { status: 400 }
      )
    }

    // Fallback - tenta extrair txid
    return NextResponse.json({ txid: String(result) })

  } catch (err: unknown) {
    console.error('[sponsor] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

### 1.3 Notas importantes

**Payload type check**: O `payloadType` em `@stacks/transactions` v7:
- `0` = TokenTransfer
- `1` = SmartContract (deploy)
- `2` = ContractCall
- Precisamos verificar no codigo real qual e o enum correto. Pode ser que use `TransactionPayloadType.ContractCall` ou similar. Na implementacao, vamos importar o enum correto ou checar pelo campo `contractAddress` existir no payload.

**Validacao alternativa (mais segura)**: Em vez de checar `payloadType`, podemos checar se `payload.contractAddress` existe:
```typescript
if (!('contractAddress' in payload) || !('functionName' in payload)) {
  return NextResponse.json({ error: 'Only contract calls allowed' }, { status: 400 })
}
```

**broadcastTransaction retorno**: Na v7, `broadcastTransaction` pode retornar:
- Uma string com o txid
- Um objeto `TxBroadcastResult` que pode ter `{ txid }` ou `{ error, reason }`
- Precisamos testar o retorno real. O codigo acima trata ambos os casos.

**Nonce do sponsor**: Ao omitir `sponsorNonce`, o SDK busca automaticamente da rede via `/v2/accounts/{address}`. Isso funciona bem para txs espacadas (como apostas individuais). Se houver problemas de nonce collision com muitas txs simultaneas, podemos adicionar um contador local com lock.

**Fee**: 50000 microSTX (0.05 STX) e conservador para contract calls. Na testnet, fees sao minimos. Com 1900 STX, isso permite 38.000 transacoes.

---

## PASSO 2: Criar helper `lib/sponsor.ts`

Para evitar duplicacao de codigo entre MarketCardV4 e ClaimButton, criar um helper:

```typescript
/**
 * Envia uma transacao sponsored para o backend.
 * Recebe o txRaw do onFinish da wallet e retorna o txid.
 */
export async function submitSponsoredTx(txRaw: string): Promise<string> {
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex: txRaw }),
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    throw new Error(data.error || `Sponsor failed (${res.status})`)
  }

  return data.txid
}
```

---

## PASSO 3: Modificar `components/MarketCardV4.tsx`

### 3.1 Adicionar import
```typescript
import { submitSponsoredTx } from '@/lib/sponsor'
```

### 3.2 Modificar `buy()` (linhas 479-497)

DE:
```typescript
await new Promise<void>((resolve, reject) => {
  openContractCall({
    contractAddress: bpAddr,
    contractName: bpName,
    functionName: 'place-bet',
    functionArgs: [
      uintCV(round.id),
      stringAsciiCV(side),
      uintCV(amountMicro)
    ],
    postConditions,
    network: 'testnet',
    onFinish: (data) => {
      console.log('Bet placed:', data.txId)
      resolve()
    },
    onCancel: () => reject(new Error('Cancelled'))
  })
})
```

PARA:
```typescript
const txRaw = await new Promise<string>((resolve, reject) => {
  openContractCall({
    contractAddress: bpAddr,
    contractName: bpName,
    functionName: 'place-bet',
    functionArgs: [
      uintCV(round.id),
      stringAsciiCV(side),
      uintCV(amountMicro)
    ],
    postConditions,
    network: 'testnet',
    sponsored: true,
    onFinish: (data) => {
      console.log('Bet signed:', data.txId)
      resolve(data.txRaw)
    },
    onCancel: () => reject(new Error('Cancelled'))
  })
})

// Sponsora e broadcasta via backend
const txid = await submitSponsoredTx(txRaw)
console.log('Bet sponsored & broadcast:', txid)
```

### 3.3 Modificar `enableTrading()` (linhas 358-377)

DE:
```typescript
await new Promise<void>((resolve, reject) => {
  openContractCall({
    // ... approve call ...
    network: 'testnet',
    onFinish: () => {
      localStorage.setItem(key, 'true')
      setTradingEnabled(true)
      resolve()
    },
    onCancel: () => reject(new Error('Cancelled'))
  })
})
```

PARA:
```typescript
const txRaw = await new Promise<string>((resolve, reject) => {
  openContractCall({
    // ... approve call (mesmos args) ...
    network: 'testnet',
    sponsored: true,
    onFinish: (data) => {
      resolve(data.txRaw)
    },
    onCancel: () => reject(new Error('Cancelled'))
  })
})
await submitSponsoredTx(txRaw)
localStorage.setItem(key, 'true')
setTradingEnabled(true)
```

### 3.4 Modificar `mintTokens()` (linhas 397-412)

Mesmo padrao: adicionar `sponsored: true`, capturar `txRaw`, enviar para `/api/sponsor`.

---

## PASSO 4: Modificar `components/ClaimButton.tsx`

### 4.1 Adicionar import
```typescript
import { submitSponsoredTx } from '@/lib/sponsor'
```

### 4.2 Modificar o claim loop (linhas 284-305)

DE:
```typescript
const txId = await new Promise<string>((resolve, reject) => {
  openContractCall({
    contractAddress: contractAddr,
    contractName: contractName,
    functionName: 'claim-round-side',
    functionArgs: [ ... ],
    postConditionMode: PostConditionMode.Allow,
    network: 'testnet',
    onFinish: (data) => {
      resolve(data.txId)
    },
    onCancel: () => {
      reject(new Error('Transaction cancelled by user'))
    }
  })
})
```

PARA:
```typescript
const txRaw = await new Promise<string>((resolve, reject) => {
  openContractCall({
    contractAddress: contractAddr,
    contractName: contractName,
    functionName: 'claim-round-side',
    functionArgs: [ ... ],
    postConditionMode: PostConditionMode.Allow,
    network: 'testnet',
    sponsored: true,
    onFinish: (data) => {
      resolve(data.txRaw)
    },
    onCancel: () => {
      reject(new Error('Transaction cancelled by user'))
    }
  })
})
const txId = await submitSponsoredTx(txRaw)
```

### 4.3 Nonce collision no claim
O ClaimButton ja tem `waitForTxInMempool` para evitar nonce collision entre claims sequenciais. Agora a preocupacao e com o nonce do **sponsor** (deployer), nao do user. O `waitForTxInMempool` continua funcionando porque espera a tx aparecer na rede antes de enviar a proxima.

---

## PASSO 5: Testar

### 5.1 Cenarios de teste
1. [ ] **Bet place-bet** - User com 0 STX consegue apostar
2. [ ] **Approve** - User com 0 STX consegue dar approve no token
3. [ ] **Mint** - User com 0 STX consegue mintar tokens de teste
4. [ ] **Claim** - User com 0 STX consegue claimar
5. [ ] **Multiplos claims** - Claims sequenciais nao colidem (nonce do sponsor)
6. [ ] **Tx invalida** - Backend rejeita tx para contrato nao permitido
7. [ ] **Wallet cancel** - User cancela no popup, frontend trata gracefully

### 5.2 Como testar com 0 STX
1. Criar uma nova wallet na Leather (conta limpa, 0 STX)
2. Conectar ao Predix
3. Tentar fazer mint + approve + bet
4. Verificar que todas as txs sao sponsoradas pelo deployer

---

## Riscos e Mitigacoes

### Risco 1: Nonce collision do sponsor
**Problema**: Se 2 users apostam ao mesmo tempo, o backend pode tentar usar o mesmo nonce para ambas as txs sponsoradas.
**Mitigacao fase 1**: Na testnet com poucos users, isso e raro. O `sponsorTransaction` auto-busca o nonce.
**Mitigacao fase 2**: Se necessario, implementar um mutex/queue no backend:
```typescript
let nonceCounter: bigint | null = null
const nonceMutex = new Mutex() // usar lib como 'async-mutex'

async function getNextNonce(): Promise<bigint> {
  return nonceMutex.runExclusive(async () => {
    if (nonceCounter === null) {
      // Fetch da rede na primeira vez
      nonceCounter = await fetchNonce(sponsorAddress)
    }
    const nonce = nonceCounter
    nonceCounter++
    return nonce
  })
}
```
**Decisao**: Comecar sem mutex. Adicionar se necessario.

### Risco 2: Saldo STX do sponsor acaba
**Problema**: Se o deployer ficar sem STX, nenhuma tx funciona.
**Mitigacao**: 1900 STX / 0.05 STX por tx = 38.000 txs. Suficiente para testnet. Monitorar saldo periodicamente. Na testnet, pode pedir mais via faucet.

### Risco 3: Wallet nao suporta `sponsored: true`
**Problema**: Versoes antigas da Leather podem nao suportar ou mostrar erro "insufficient STX balance".
**Mitigacao**: Bug foi corrigido em Leather PR #2159. Se o user tiver versao antiga, vai ver erro. Nao ha muito o que fazer alem de pedir para atualizar.

### Risco 4: `txRaw` undefined no onFinish
**Problema**: Se a wallet nao retornar `txRaw` no callback sponsored.
**Mitigacao**: Adicionar check:
```typescript
onFinish: (data) => {
  if (!data.txRaw) {
    reject(new Error('Wallet did not return signed transaction. Please update your wallet.'))
    return
  }
  resolve(data.txRaw)
}
```

---

## Resumo de mudancas

| # | Arquivo | Mudanca | Complexidade |
|---|---|---|---|
| 1 | `app/api/sponsor/route.ts` | **Novo** - endpoint de sponsorship | Media |
| 2 | `lib/sponsor.ts` | **Novo** - helper para enviar tx sponsored | Baixa |
| 3 | `components/MarketCardV4.tsx` | Adicionar `sponsored: true` + envio ao backend em 3 funcoes | Baixa |
| 4 | `components/ClaimButton.tsx` | Adicionar `sponsored: true` + envio ao backend no claim | Baixa |

Total: ~100 linhas novas, ~30 linhas modificadas. Nenhuma dependencia nova.
