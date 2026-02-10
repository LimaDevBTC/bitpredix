# BITPREDIX - Guia do Projeto

## Stack
- **Frontend**: Next.js 14 (App Router), React, TailwindCSS
- **Blockchain**: Stacks (Clarity smart contracts), testnet
- **Oracle**: Pyth Network (BTC/USD price feed)
- **Token**: test-usdcx (ERC20-like, 6 decimais)
- **Wallet**: @stacks/connect

## Contratos Ativos (testnet)
- **Deployer**: `ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK`
- **bitpredix-v5**: Contrato principal de mercado preditivo (`.env.local` → `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID`)
- **test-usdcx**: Token de aposta (6 decimais)
- **oracle-v2**: Oracle (legado, Pyth via frontend agora)

## Arquivos Chave
| Arquivo | Responsabilidade |
|---|---|
| `contracts/bitpredix-v5.clar` | Smart contract ativo (Clarity) |
| `contracts/bitpredix-v4.clar` | Versao anterior (referencia) |
| `components/MarketCardV4.tsx` | UI principal de apostas |
| `components/ClaimButton.tsx` | Botao de claim/settlement |
| `lib/pyth.ts` | Oracle de precos (Pyth SSE + Benchmarks) |
| `lib/positions.ts` | Tracking local de posicoes (localStorage) |
| `app/api/stacks-read/route.ts` | Proxy para Hiro API (read-only calls) |
| `app/api/pyth-price/route.ts` | Proxy para Pyth Benchmarks (historico) |
| `app/api/allowance-status/route.ts` | Verifica approve do token |

## Mecanica de Rounds
- Cada round dura **60 segundos** (round-id = `Math.floor(timestamp / 60)`)
- Trading aberto por **48s** (fecha 12s antes do fim)
- Settlement: frontend busca precos do Pyth, primeiro claim resolve o round
- Payout: `(user_amount / winning_pool) * total_pool - 3% fee`

---

# TAREFA PENDENTE: Multiplas Apostas por Usuario

## Objetivo
Permitir que usuarios facam **multiplas apostas por round**, inclusive em **lados opostos** (hedging). Isso e padrao em mercados preditivos (Polymarket, Kalshi, etc).

## Abordagem Escolhida: Opção A
Mudar a key do map `bets` para `{ round-id, user, side }`. Apostas no **mesmo lado acumulam** valor. Usuario pode apostar em **UP e DOWN** no mesmo round.

## Estado Atual (v5) - O que bloqueia multiplas apostas

### 1. Smart Contract (`contracts/bitpredix-v5.clar`)
```clarity
;; LINHA 56-63: Map key usa { round-id, user } → só 1 entrada por usuario
(define-map bets
  { round-id: uint, user: principal }
  { side: (string-ascii 4), amount: uint, claimed: bool }
)

;; LINHA 92: Rejeita segunda aposta
(asserts! (is-none existing-bet) ERR_ALREADY_BET)
```

### 2. Frontend (`components/MarketCardV4.tsx`)
```typescript
// LINHA 62: Estado que trava apos 1a aposta
const [betPlacedRoundId, setBetPlacedRoundId] = useState<number | null>(null)

// LINHA 350: Flag que desabilita botoes
const alreadyBet = betPlacedRoundId !== null && round !== null && betPlacedRoundId === round.id
const canTrade = isTradingOpen && stxAddress && !trading && !alreadyBet
```

### 3. Claim (`components/ClaimButton.tsx`)
```typescript
// LINHA 117-126: Busca UMA aposta por round
functionName: 'get-bet',
args: [cvToHex(uintCV(roundId)), cvToHex(standardPrincipalCV(stxAddress))]
```

---

## PLANO DE IMPLEMENTACAO

### PASSO 1: Criar contrato `bitpredix-v6.clar`

Copiar `contracts/bitpredix-v5.clar` para `contracts/bitpredix-v6.clar` e aplicar as mudancas abaixo.

#### 1.1 Atualizar SELF
```clarity
;; DE:
(define-constant SELF 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v5)
;; PARA:
(define-constant SELF 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v6)
```

#### 1.2 Mudar map `bets` — adicionar `side` na key
```clarity
;; DE:
(define-map bets
  { round-id: uint, user: principal }
  { side: (string-ascii 4), amount: uint, claimed: bool }
)

;; PARA:
(define-map bets
  { round-id: uint, user: principal, side: (string-ascii 4) }
  { amount: uint, claimed: bool }
)
```
> `side` sai do value e vai para a key. Isso permite 2 entradas por usuario por round (uma UP, uma DOWN).

#### 1.3 Reescrever `place-bet` — acumular ao inves de rejeitar
```clarity
(define-public (place-bet (round-id uint) (side (string-ascii 4)) (amount uint))
  (let (
    (round-start-time (* round-id ROUND_DURATION))
    (trading-close-time (+ round-start-time TRADING_WINDOW))
    (current-round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (existing-bet (map-get? bets { round-id: round-id, user: tx-sender, side: side }))
    (current-amount (default-to u0 (get amount existing-bet)))
  )
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (>= amount MIN_BET) ERR_INVALID_AMOUNT)
    ;; REMOVIDO: (asserts! (is-none existing-bet) ERR_ALREADY_BET)

    ;; Transfere tokens do usuario para o contrato
    (try! (contract-call? .test-usdcx transfer-from tx-sender SELF amount none))

    ;; Atualiza totais do round
    (map-set rounds { round-id: round-id }
      {
        total-up: (if (is-eq side "UP")
          (+ (get total-up current-round-data) amount)
          (get total-up current-round-data)),
        total-down: (if (is-eq side "DOWN")
          (+ (get total-down current-round-data) amount)
          (get total-down current-round-data)),
        price-start: (get price-start current-round-data),
        price-end: (get price-end current-round-data),
        resolved: (get resolved current-round-data)
      }
    )

    ;; Registra/acumula aposta do usuario (side agora e parte da key)
    (map-set bets { round-id: round-id, user: tx-sender, side: side }
      { amount: (+ current-amount amount), claimed: false }
    )

    ;; Adiciona round a lista de pendentes do usuario
    (try! (add-user-pending-round tx-sender round-id))

    (ok { round-id: round-id, side: side, amount: amount })
  )
)
```

#### 1.4 Reescrever `claim-round` — claim por SIDE
Renomear para `claim-round-side` e receber o `side` como parametro. Cada lado e claimado separadamente.

```clarity
(define-public (claim-round-side (round-id uint) (side (string-ascii 4)) (price-start uint) (price-end uint))
  (let (
    (user tx-sender)
    (round-end-time (* (+ round-id u1) ROUND_DURATION))
    (round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (bet-data (unwrap! (map-get? bets { round-id: round-id, user: tx-sender, side: side }) ERR_NO_BET))
  )
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (not (get claimed bet-data)) ERR_ALREADY_CLAIMED)
    (asserts! (> price-start u0) ERR_INVALID_PRICES)
    (asserts! (> price-end u0) ERR_INVALID_PRICES)

    ;; Resolve o round se ainda nao foi resolvido
    (if (not (get resolved round-data))
      (map-set rounds { round-id: round-id }
        (merge round-data { price-start: price-start, price-end: price-end, resolved: true })
      )
      true
    )

    ;; Busca dados atualizados do round
    (let (
      (final-round (unwrap-panic (map-get? rounds { round-id: round-id })))
      (final-price-start (get price-start final-round))
      (final-price-end (get price-end final-round))
      (outcome (if (> final-price-end final-price-start) "UP" "DOWN"))
      (user-won (is-eq side outcome))
      (total-pool (+ (get total-up final-round) (get total-down final-round)))
      (winning-pool (if (is-eq outcome "UP")
        (get total-up final-round)
        (get total-down final-round)))
      (user-amount (get amount bet-data))
    )
      ;; Marca aposta como claimed
      (map-set bets { round-id: round-id, user: user, side: side }
        (merge bet-data { claimed: true })
      )

      ;; Remove da lista de pendentes SOMENTE se ambos os lados ja foram claimed
      ;; (ou se o usuario so apostou em um lado)
      (let (
        (other-side (if (is-eq side "UP") "DOWN" "UP"))
        (other-bet (map-get? bets { round-id: round-id, user: user, side: other-side }))
        (other-claimed (match other-bet ob (get claimed ob) true))
      )
        (if other-claimed
          (begin (remove-user-pending-round user round-id) true)
          true
        )
      )

      ;; Calcula e paga se ganhou
      (if user-won
        (if (> winning-pool u0)
          (let (
            (gross-payout (/ (* user-amount total-pool) winning-pool))
            (fee (/ (* gross-payout FEE_BPS) u10000))
            (net-payout (- gross-payout fee))
          )
            (try! (contract-call? .test-usdcx transfer-from SELF user net-payout none))
            (if (> fee u0)
              (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT fee none))
              true
            )
            (ok { won: true, payout: net-payout, outcome: outcome, price-start: final-price-start, price-end: final-price-end })
          )
          (begin
            (try! (contract-call? .test-usdcx transfer-from SELF user user-amount none))
            (ok { won: true, payout: user-amount, outcome: outcome, price-start: final-price-start, price-end: final-price-end })
          )
        )
        (ok { won: false, payout: u0, outcome: outcome, price-start: final-price-start, price-end: final-price-end })
      )
    )
  )
)
```

#### 1.5 Atualizar funcoes read-only

```clarity
;; DE: get-bet recebe (round-id, user)
;; PARA: get-bet recebe (round-id, user, side)
(define-read-only (get-bet (round-id uint) (user principal) (side (string-ascii 4)))
  (map-get? bets { round-id: round-id, user: user, side: side })
)

;; NOVA: retorna ambos os lados de uma vez
(define-read-only (get-user-bets (round-id uint) (user principal))
  {
    up: (map-get? bets { round-id: round-id, user: user, side: "UP" }),
    down: (map-get? bets { round-id: round-id, user: user, side: "DOWN" })
  }
)
```

#### 1.6 Remover `ERR_ALREADY_BET`
A constante `ERR_ALREADY_BET` (u1008) nao e mais necessaria. Pode ser mantida para compatibilidade ou removida.

---

### PASSO 2: Atualizar Frontend — `components/MarketCardV4.tsx`

#### 2.1 Remover trava de aposta unica
```typescript
// REMOVER estado betPlacedRoundId (linha 62):
// const [betPlacedRoundId, setBetPlacedRoundId] = useState<number | null>(null)

// REMOVER calculo alreadyBet (linha 350):
// const alreadyBet = betPlacedRoundId !== null && ...

// MUDAR canTrade (linha 351):
// DE:  const canTrade = isTradingOpen && stxAddress && !trading && !alreadyBet
// PARA: const canTrade = isTradingOpen && stxAddress && !trading
```

#### 2.2 Adicionar tracking de apostas acumuladas no round atual
Substituir `betPlacedRoundId` e `lastTrade` por um estado que acumula apostas:

```typescript
interface RoundBets {
  roundId: number
  up: number   // total USD apostado em UP neste round
  down: number // total USD apostado em DOWN neste round
}

const [roundBets, setRoundBets] = useState<RoundBets | null>(null)
```

#### 2.3 Atualizar funcao `buy()`
```typescript
// Apos sucesso da tx, ACUMULAR ao inves de bloquear:
const prevBets = (roundBets?.roundId === round.id) ? roundBets : { roundId: round.id, up: 0, down: 0 }
setRoundBets({
  roundId: round.id,
  up: prevBets.up + (side === 'UP' ? v : 0),
  down: prevBets.down + (side === 'DOWN' ? v : 0),
})
setLastTrade({ side, shares: v })
setAmount('')
```

#### 2.4 Atualizar area de mensagens
Onde mostra "Bet placed: $X on UP", mudar para mostrar total acumulado:
```typescript
// Se tem apostas no round atual, mostra resumo mas NAO desabilita botoes
roundBets && roundBets.roundId === round?.id && (roundBets.up > 0 || roundBets.down > 0) ? (
  <div className="...">
    <span className="text-zinc-500">Your bets: </span>
    {roundBets.up > 0 && <span className="text-up font-medium">${roundBets.up} UP</span>}
    {roundBets.up > 0 && roundBets.down > 0 && <span className="text-zinc-600"> | </span>}
    {roundBets.down > 0 && <span className="text-down font-medium">${roundBets.down} DOWN</span>}
  </div>
) : // ... resto
```

#### 2.5 Resetar ao mudar de round
No useEffect que detecta mudanca de round (linha 78-84), resetar `roundBets`:
```typescript
if (lastRoundIdRef.current !== newRound.id) {
  lastRoundIdRef.current = newRound.id
  openPriceRef.current = currentPrice
  setPriceHistory([{ time: 0, up: 50, down: 50 }])
  setLastTrade(null)
  setRoundBets(null)  // <-- resetar apostas acumuladas
}
```

---

### PASSO 3: Atualizar `components/ClaimButton.tsx`

#### 3.1 Mudar interface PendingRound para suportar 2 lados
```typescript
interface PendingBet {
  side: 'UP' | 'DOWN'
  amount: number
  claimed: boolean
}

interface PendingRound {
  roundId: number
  bets: PendingBet[]  // pode ter 1 ou 2 entries (UP e/ou DOWN)
}
```

#### 3.2 Atualizar `fetchPendingRounds`
Para cada roundId, buscar AMBOS os lados:
```typescript
// Chama get-user-bets ao inves de get-bet
functionName: 'get-user-bets',
args: [cvToHex(uintCV(roundId)), cvToHex(standardPrincipalCV(stxAddress))]
```
Ou fazer 2 chamadas `get-bet` (uma para "UP", outra para "DOWN") e combinar.

**Opção mais simples** (2 chamadas por round):
```typescript
for (const roundId of roundIds) {
  const bets: PendingBet[] = []
  for (const side of ['UP', 'DOWN']) {
    const betResponse = await fetch('/api/stacks-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractId: BITPREDIX_CONTRACT,
        functionName: 'get-bet',
        args: [
          cvToHex(uintCV(roundId)),
          cvToHex(standardPrincipalCV(stxAddress)),
          cvToHex(stringAsciiCV(side))  // NOVO: side como 3o argumento
        ],
        sender: stxAddress
      })
    })
    // Parse e adiciona a bets[] se existir
  }
  if (bets.length > 0) {
    rounds.push({ roundId, bets })
  }
}
```

#### 3.3 Atualizar `handleClaim` — claim por side
Para cada PendingRound, fazer claim de cada bet (lado) separadamente:
```typescript
for (const round of batch) {
  for (const bet of round.bets) {
    if (bet.claimed) continue

    await openContractCall({
      functionName: 'claim-round-side',  // MUDOU de claim-round
      functionArgs: [
        uintCV(round.roundId),
        stringAsciiCV(bet.side),          // NOVO: side como parametro
        uintCV(prices.priceStart),
        uintCV(prices.priceEnd)
      ],
      // ...
    })
  }
}
```

---

### PASSO 4: Atualizar `.env.local`

```env
NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v6
```

---

### PASSO 5: Deploy e Teste

1. Deploy `bitpredix-v6.clar` na testnet via Hiro Wallet ou CLI
2. Atualizar `.env.local` com novo contract ID
3. Testar cenarios:
   - [ ] Apostar UP, depois apostar UP de novo (deve acumular)
   - [ ] Apostar UP, depois apostar DOWN (deve permitir)
   - [ ] Claim de round com aposta so UP
   - [ ] Claim de round com aposta so DOWN
   - [ ] Claim de round com apostas em ambos os lados
   - [ ] Verificar payout correto com apostas acumuladas
   - [ ] Verificar que pending-rounds remove corretamente apos claim de todos os lados

---

## Resumo das Mudancas por Arquivo

| Arquivo | Mudanca |
|---|---|
| `contracts/bitpredix-v6.clar` | **NOVO** - Copia de v5 com bets key `{round-id, user, side}`, acumulacao, claim-round-side |
| `components/MarketCardV4.tsx` | Remove trava `alreadyBet`, adiciona tracking acumulado `roundBets`, atualiza UI |
| `components/ClaimButton.tsx` | Busca ambos os lados, chama `claim-round-side` com parametro `side` |
| `.env.local` | Atualiza `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` para v6 |
| `lib/positions.ts` | Nenhuma mudanca necessaria (ja suporta multiplas trades por round) |

## Notas Importantes
- **v5 permanece intacto** — criamos v6 como novo contrato
- O **frontend detecta o contrato via `.env.local`** — basta mudar a variavel
- A funcao `add-user-pending-round` ja tem `index-of?` que evita duplicatas na lista — quando o user aposta novamente no mesmo round, o round nao e adicionado 2x
- O `lib/positions.ts` (localStorage) ja suporta multiplas trades por round naturalmente
- O `stringAsciiCV` do `@stacks/transactions` e usado para passar "UP"/"DOWN" como argumento no claim
