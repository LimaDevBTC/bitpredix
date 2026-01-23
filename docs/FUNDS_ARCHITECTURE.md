# Arquitetura de Fundos - Bitpredix

## Visão Geral

Este documento explica como os fundos (USDCx) serão movidos, travados e distribuídos no sistema on-chain.

## Situação Atual (MVP)

**Estado:** Em memória, sem movimentação real de fundos.

- As apostas são simuladas (apenas cálculos do AMM)
- Não há transferência real de USDCx
- Não há travamento de fundos
- Não há taxa de plataforma aplicada

## Arquitetura On-Chain (Produção)

### Fluxo de Fundos

```
┌─────────────┐
│   Usuário   │
│  (Carteira) │
└──────┬──────┘
       │ 1. Aprova USDCx
       │    (approve)
       ▼
┌─────────────────────────────────┐
│   Smart Contract (Bitpredix)    │
│   ┌───────────────────────────┐ │
│   │  Escrow Pool (Round N)    │ │
│   │  - Total depositado       │ │
│   │  - Shares UP/DOWN         │ │
│   └───────────────────────────┘ │
└──────┬───────────────────────────┘
       │ 2. Fundos travados
       │    (transferFrom)
       │
       │ 3. Rodada termina
       │
       ▼
┌─────────────────────────────────┐
│   Settlement (Auto)             │
│   ┌───────────────────────────┐ │
│   │  - Taxa plataforma: 3%    │ │
│   │  - Distribui para vencedores│ │
│   └───────────────────────────┘ │
└──────┬───────────────────────────┘
       │ 4. Payout
       ▼
┌─────────────┐
│   Usuário   │
│  (Carteira) │
└─────────────┘
```

### 1. Durante a Rodada (Trading)

#### 1.1 Usuário faz uma aposta

```typescript
// Frontend chama smart contract
async function placeBet(roundId: string, side: 'UP' | 'DOWN', amountUsd: number) {
  // 1. Usuário aprova o smart contract a gastar USDCx
  await usdcxContract.approve(
    BITPREDIX_CONTRACT_ADDRESS,
    amountUsd
  )
  
  // 2. Chama função do smart contract
  await bitpredixContract.buyShares(
    roundId,
    side,
    amountUsd
  )
}
```

#### 1.2 Smart Contract processa a aposta

```clarity
;; Smart Contract (Clarity)
(define-public (buy-shares (round-id uint) (side (string-ascii 4)) (amount-uint uint))
  (begin
    ;; 1. Verifica se rodada está aberta
    (asserts! (is-round-open round-id) (err u1001))
    
    ;; 2. Transfere USDCx do usuário para o contrato (escrow)
    (try! (contract-call? .usdcx-token transfer-from
      amount-uint
      tx-sender
      (as-contract tx-sender)  ;; Contrato recebe os fundos
      none
    ))
    
    ;; 3. Calcula shares usando AMM
    (let ((result (calculate-shares round-id side amount-uint)))
      ;; 4. Registra a posição do usuário
      (map-set positions-map
        (tuple (user tx-sender) (round round-id))
        (tuple
          (shares-up (if (is-eq side "UP") (get shares-received result) u0))
          (shares-down (if (is-eq side "DOWN") (get shares-received result) u0))
          (cost amount-uint)
        )
      )
      
      ;; 5. Atualiza pool da rodada
      (update-pool round-id result)
      
      (ok result)
    )
  )
)
```

**O que acontece:**
- ✅ USDCx sai da carteira do usuário
- ✅ USDCx vai para o smart contract (escrow)
- ✅ Usuário recebe "shares" registradas (não tokens físicos)
- ✅ Pool do AMM é atualizado

### 2. Fim da Rodada (Resolution)

#### 2.1 Oracle/Backend resolve a rodada

```typescript
// Backend (Node.js) - após rodada terminar
async function resolveRound(roundId: string, priceAtEnd: number) {
  // 1. Determina vencedor
  const round = await getRound(roundId)
  const outcome = priceAtEnd > round.priceAtStart ? 'UP' : 'DOWN'
  
  // 2. Chama smart contract para resolver
  await bitpredixContract.resolveRound(roundId, outcome)
}
```

#### 2.2 Smart Contract processa settlement

```clarity
(define-public (resolve-round (round-id uint) (outcome (string-ascii 4)))
  (begin
    ;; 1. Marca rodada como resolvida
    (map-set rounds-map round-id
      (merge (unwrap! (map-get? rounds-map round-id) (err u1002))
        (tuple (status "RESOLVED") (outcome outcome))
      )
    )
    
    ;; 2. Calcula total no pool
    (let ((pool (get-pool round-id)))
      (let ((total-usdcx (+ (get reserve-up pool) (get reserve-down pool))))
        
        ;; 3. Calcula taxa de plataforma (3%)
        (let ((platform-fee (/ (* total-usdcx u3) u100)))
          ;; 4. Transfere taxa para endereço da plataforma
          (try! (contract-call? .usdcx-token transfer
            platform-fee
            PLATFORM_ADDRESS
            none
          ))
          
          ;; 5. Calcula total para distribuir
          (let ((payout-pool (- total-usdcx platform-fee)))
            ;; 6. Distribui para vencedores (proporcional às shares)
            (distribute-payouts round-id outcome payout-pool)
          )
        )
      )
    )
    
    (ok true)
  )
)

(define-private (distribute-payouts (round-id uint) (outcome (string-ascii 4)) (total-payout uint))
  ;; Itera sobre todas as posições da rodada
  ;; Para cada usuário com shares do lado vencedor:
  ;;   payout = (shares_do_usuario / total_shares_vencedoras) * total_payout
  ;;   Transfere USDCx para o usuário
)
```

**O que acontece:**
- ✅ Rodada marcada como `RESOLVED`
- ✅ 3% do total é transferido para endereço da plataforma
- ✅ 97% restante é distribuído proporcionalmente aos vencedores
- ✅ Fundos saem do escrow e vão para carteiras dos usuários

### 3. Estrutura de Dados On-Chain

```clarity
;; Estrutura de uma rodada
(define-map rounds-map
  uint  ;; round-id
  {
    start-at: uint,
    ends-at: uint,
    price-at-start: uint,
    price-at-end: (optional uint),
    outcome: (optional (string-ascii 4)),
    status: (string-ascii 10),  ;; "TRADING" | "RESOLVED"
    pool: {
      reserve-up: uint,
      reserve-down: uint,
      k: uint
    },
    total-deposited: uint,  ;; Total de USDCx depositado
    platform-fee-collected: uint
  }
)

;; Posição de um usuário em uma rodada
(define-map positions-map
  {user: principal, round: uint}
  {
    shares-up: uint,
    shares-down: uint,
    cost: uint  ;; Total gasto em USDCx
  }
)
```

## Opções de Arquitetura

### Opção A: Escrow por Rodada (Recomendada)

**Como funciona:**
- Cada rodada tem seu próprio "escrow" (pool de fundos)
- Fundos ficam travados no smart contract até resolução
- Após resolução, fundos são distribuídos imediatamente

**Vantagens:**
- ✅ Fundos claramente separados por rodada
- ✅ Settlement automático e transparente
- ✅ Sem necessidade de "sacar" manualmente

**Desvantagens:**
- ⚠️ Cada rodada precisa de um novo escrow (mas é apenas lógico, não físico)

### Opção B: Escrow Global + Registros por Rodada

**Como funciona:**
- Um único escrow global para todas as rodadas
- Registros separados por rodada
- Settlement consolida todas as rodadas resolvidas

**Vantagens:**
- ✅ Menos complexidade de escrow
- ✅ Pode fazer batch settlements

**Desvantagens:**
- ⚠️ Mais complexo de auditar
- ⚠️ Mistura fundos de rodadas diferentes

**Recomendação:** Opção A (Escrow por Rodada)

## Taxa de Plataforma

### Cálculo da Taxa

```
Total depositado na rodada: $10,000
Taxa plataforma (3%): $300
Total para distribuir: $9,700
```

### Distribuição Proporcional

Se você tem 10% das shares vencedoras:
```
Seu payout = (suas_shares / total_shares_vencedoras) * $9,700
```

### Exemplo Completo

**Rodada:**
- Total depositado: $10,000
- Shares UP vendidas: 8,000
- Shares DOWN vendidas: 2,000
- Resultado: UP vence

**Settlement:**
1. Taxa plataforma: $10,000 × 3% = $300 → vai para `PLATFORM_ADDRESS`
2. Total para distribuir: $10,000 - $300 = $9,700
3. Distribuição:
   - Cada share UP vale: $9,700 / 8,000 = $1.2125
   - Se você tem 100 shares UP: 100 × $1.2125 = $121.25

## Segurança e Transparência

### Garantias On-Chain

1. **Fundos travados:** USDCx fica no smart contract até resolução
2. **Settlement automático:** Não depende de ação manual
3. **Auditável:** Todas as transações são públicas na blockchain
4. **Sem custódia centralizada:** Smart contract é o único dono dos fundos

### Fluxo de Segurança

```
Usuário → Aprova → Smart Contract recebe → Escrow travado
                                              ↓
                                    Rodada termina
                                              ↓
                                    Settlement automático
                                              ↓
                                    Taxa (3%) → Plataforma
                                    Restante → Vencedores
```

## Comparação: MVP vs Produção

| Aspecto | MVP (Atual) | Produção (On-Chain) |
|---------|-------------|---------------------|
| **Fundos** | Simulado | USDCx real travado |
| **Apostas** | Em memória | Registradas on-chain |
| **Settlement** | Manual | Automático via smart contract |
| **Taxa** | Não aplicada | 3% descontada |
| **Transparência** | Backend privado | Blockchain pública |
| **Custódia** | N/A | Smart contract (trustless) |

## Próximos Passos

1. **Smart Contract Clarity:**
   - Implementar `buy-shares`
   - Implementar `resolve-round`
   - Implementar `distribute-payouts`

2. **Frontend Integration:**
   - Conectar com Stacks Wallet (Leather, Xverse)
   - Implementar `approve` + `buy-shares`
   - Mostrar status de transações on-chain

3. **Backend Oracle:**
   - Serviço que resolve rodadas automaticamente
   - Chama `resolve-round` no smart contract

4. **Testing:**
   - Testes unitários do smart contract
   - Testes de integração end-to-end
   - Testes de segurança (audit)

## Resumo

**Fluxo de Fundos:**
1. Usuário aprova USDCx → Smart contract
2. Usuário chama `buy-shares` → Fundos vão para escrow da rodada
3. Rodada termina → Oracle chama `resolve-round`
4. Smart contract:
   - Desconta 3% (taxa plataforma)
   - Distribui 97% proporcionalmente aos vencedores
5. Fundos saem do escrow → Carteiras dos usuários

**Fundos são:**
- ✅ Movidos da carteira do usuário (não apenas travados)
- ✅ Travados no smart contract até resolução
- ✅ Distribuídos automaticamente após resolução
- ✅ Taxa de 3% descontada antes da distribuição
