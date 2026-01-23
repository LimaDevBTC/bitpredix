# Arquitetura de Tokens/Shares - Bitpredix

## Moeda de Aposta: USDCx

**Importante:** Todas as apostas e settlements serão feitos em **USDCx**, a stablecoin USDC na blockchain Stacks. USDCx é a versão wrapped/bridged do USDC para Stacks, mantendo paridade 1:1 com USD.

## Problema

Quando uma rodada termina:
- Tokens UP vencedores valem **$1.00** cada
- Tokens DOWN perdedores valem **$0.00** cada
- Como identificar quais tokens pertencem a qual rodada?
- Como fazer settlement automático?
- Como precificar a próxima rodada sem confusão?

## Análise de Custos na Stacks

### Custos de Transação na Stacks

Na Stacks blockchain, as taxas são calculadas baseadas em:
- **Fee rate**: micro-STX por unidade (determinado pelo mercado)
- **Tamanho da transação**: write count, read count, runtime, bytes

**Estimativas de custo (baseadas em dados de 2024):**
- Transação simples: ~0.001-0.01 STX (dependendo da rede)
- Mint de token: ~0.01-0.05 STX (muito mais caro)
- Chamada de função simples: ~0.001-0.005 STX
- Escrita de dados no contract: Adiciona ~0.001-0.003 STX

### Comparação de Custos

#### Opção 1: Mintar Tokens (NÃO Recomendada)
- **Custo por trade**: ~0.01-0.05 STX
- **Com 100 trades/minuto**: 0.5-5 STX/minuto = 30-300 STX/hora
- **Custo anual estimado**: ~260,000-2,600,000 STX
- **A $0.50/STX**: $130,000 - $1,300,000/ano (inviável!)

#### Opção 2: Registros Apenas (Recomendada)
- **Custo por trade**: ~0.001-0.005 STX
- **Com 100 trades/minuto**: 0.1-0.5 STX/minuto = 6-30 STX/hora
- **Custo anual estimado**: ~52,000-260,000 STX
- **A $0.50/STX**: $26,000 - $130,000/ano (viável!)

**Conclusão:** Mintar tokens físicos é **10x mais caro** e economicamente inviável em escala. Usar apenas registros é muito mais eficiente.

---

## Opções Arquiteturais

### Opção 1: Tokens com ID de Rodada (NÃO Recomendada - Muito Cara)

**⚠️ ATENÇÃO:** Esta opção é muito cara devido aos custos de minting.

**Conceito:** Cada rodada cria novos tokens com identificação única.

#### Estrutura On-Chain (Stacks/USDCx)

```typescript
// Smart Contract
interface RoundToken {
  roundId: string        // "round-1737654000" (timestamp)
  side: 'UP' | 'DOWN'
  amount: number         // Quantidade de shares
  owner: string          // Endereço do dono
}

// Exemplo de token
{
  roundId: "round-1737654000",
  side: "UP",
  amount: 37.5,
  owner: "ST1ABC..."
}
```

#### Fluxo de Operação

1. **Nova Rodada Começa:**
   - Smart contract cria novo `roundId` (ex: `round-1737654000`)
   - Pool inicial: 10,000 UP + 10,000 DOWN para essa rodada específica
   - Tokens são mintados com `roundId` no metadata

2. **Usuário Compra Shares:**
   - Paga USDCx (ex: $50)
   - Recebe tokens: `{roundId: "round-1737654000", side: "UP", amount: 37.5}`
   - Tokens são transferidos para carteira do usuário

3. **Rodada Termina:**
   - Oracle/Backend verifica preço de fecho
   - Determina vencedor: `outcome = priceAtEnd > priceAtStart ? 'UP' : 'DOWN'`
   - Smart contract marca rodada como `RESOLVED`

4. **Settlement Automático:**
   ```typescript
   // Função no smart contract
   function redeemShares(roundId: string) {
     const round = getRound(roundId)
     require(round.status === 'RESOLVED', 'Round not resolved')
     
     const userTokens = getUserTokens(roundId)
     let totalPayout = 0
     
     for (const token of userTokens) {
       if (token.side === round.outcome) {
         // Token vencedor: vale $1.00
         totalPayout += token.amount * 1.00
         burnToken(token.id) // Remove token da circulação
       } else {
         // Token perdedor: vale $0.00
         burnToken(token.id) // Remove sem pagamento
       }
     }
     
     transferUsdcx(user, totalPayout)
   }
   ```

5. **Próxima Rodada:**
   - Novo `roundId` é criado (ex: `round-1737654060`)
   - Novos tokens são mintados com novo ID
   - **Não há confusão** porque tokens antigos têm `roundId` diferente

#### Vantagens:
- ✅ Identificação clara: cada token sabe a qual rodada pertence
- ✅ Settlement simples: verificar `roundId` e `outcome`
- ✅ Sem confusão entre rodadas
- ✅ Tokens podem ser transferidos entre usuários
- ✅ Histórico completo on-chain

#### Desvantagens:
- ❌ **MUITO CARO**: Mintar tokens para cada trade é economicamente inviável
- ❌ Requer metadata nos tokens
- ❌ Muitas transações on-chain (custo alto)
- ❌ Complexo de implementar

**Custo estimado:** ~0.01-0.05 STX por trade = **inviável em escala**

---

### Opção 2: Settlement Imediato com Registros (RECOMENDADA - Mais Eficiente)

### Opção 2: Settlement Imediato (Mais Simples)

**Conceito:** Ao invés de tokens, apenas registros de posições. Settlement acontece automaticamente quando a rodada resolve.

#### Estrutura

```typescript
interface Position {
  roundId: string
  userId: string
  side: 'UP' | 'DOWN'
  shares: number
  costUsd: number
  status: 'ACTIVE' | 'SETTLED'
}

// Quando rodada resolve
function settleRound(roundId: string) {
  const positions = getPositions(roundId)
  const round = getRound(roundId)
  
  for (const pos of positions) {
    if (pos.side === round.outcome) {
      // Vencedor: recebe $1.00 por share
      const payout = pos.shares * 1.00
      transferUsdcx(pos.userId, payout)
      pos.status = 'SETTLED'
    } else {
      // Perdedor: não recebe nada
      pos.status = 'SETTLED'
    }
  }
}
```

#### Vantagens:
- ✅ **MUITO MAIS BARATO**: Apenas registros no smart contract (sem minting)
- ✅ Settlement automático
- ✅ Não precisa gerenciar tokens físicos
- ✅ Custo por trade: ~0.001-0.005 STX (10x mais barato)
- ✅ Simples de implementar
- ✅ Escalável para alto volume

#### Desvantagens:
- ⚠️ Não são tokens transferíveis (mas isso pode ser uma feature, não bug)
- ⚠️ Usuário não "possui" tokens na carteira (mas tem posição registrada on-chain)

**Custo estimado:** ~0.001-0.005 STX por trade = **viável em escala**

---

### Opção 3: Token Único com Timestamp (Híbrida)

**Conceito:** Um único tipo de token, mas com timestamp de criação que identifica a rodada.

```typescript
interface ShareToken {
  side: 'UP' | 'DOWN'
  amount: number
  createdAt: number  // Timestamp da rodada
  roundId: string    // Calculado: Math.floor(createdAt / 60000)
}
```

#### Vantagens:
- ✅ Tokens transferíveis
- ✅ Identificação por timestamp
- ✅ Mais simples que Opção 1

#### Desvantagens:
- ⚠️ Precisa calcular `roundId` a partir do timestamp
- ⚠️ Pode haver edge cases em transições de rodada

---

## Recomendação: Opção 2 (Settlement Imediato com Registros)

### Implementação Proposta (Mais Eficiente)

#### 1. Smart Contract Structure (Stacks) - Sem Minting de Tokens

```clarity
;; Round data
(define-map rounds {round-id: uint} {
  start-at: uint,
  ends-at: uint,
  price-at-start: uint,
  price-at-end: (optional uint),
  outcome: (optional (string-ascii 4)),
  status: (string-ascii 10),
  pool-up: uint,
  pool-down: uint
})

;; User positions per round (SEM tokens físicos - apenas registros)
(define-map positions {round-id: uint, user: principal, side: (string-ascii 4)} {
  shares: uint,
  cost: uint,
  settled: bool
})

;; Create new round
(define-public (create-round (round-id uint) (price-at-start uint))
  ;; Initialize pool with 10,000 each side
  (map-set rounds {round-id: round-id} {
    start-at: (block-height),
    ends-at: (+ (block-height) 60),
    price-at-start: price-at-start,
    price-at-end: none,
    outcome: none,
    status: "TRADING",
    pool-up: u10000,
    pool-down: u10000
  })
  (ok true)
)

;; Buy shares (SEM minting - apenas atualiza registros)
(define-public (buy-shares 
  (round-id uint) 
  (side (string-ascii 4)) 
  (amount-usd uint)
  (user principal)
)
  ;; 1. Recebe USDCx do usuário
  ;; 2. Calcula shares via AMM
  ;; 3. Atualiza pool
  ;; 4. Registra posição (SEM mintar tokens)
  ;; Custo: ~0.001-0.005 STX (muito mais barato!)
  (ok true)
)

;; Resolve round
(define-public (resolve-round (round-id uint) (price-at-end uint) (outcome (string-ascii 4)))
  ;; Mark round as resolved
  ;; Users can now redeem
  (ok true)
)

;; Redeem shares (automatic settlement - SEM tokens para queimar)
(define-public (redeem-shares (round-id uint) (user principal))
  ;; 1. Verifica que rodada está RESOLVED
  ;; 2. Busca posições do usuário na rodada
  ;; 3. Calcula payout: shares vencedoras * $1.00
  ;; 4. Transfere USDCx para usuário
  ;; 5. Marca posições como SETTLED
  ;; Custo: ~0.001-0.005 STX (apenas leitura/escrita de dados)
  (ok true)
)
```

#### 2. Frontend Integration

```typescript
// Quando rodada resolve
async function handleRoundResolution(roundId: string) {
  // 1. Backend/Oracle resolve a rodada
  await resolveRound(roundId, closingPrice)
  
  // 2. Frontend detecta resolução
  const round = await getRound(roundId)
  
  // 3. Mostra modal de resultado
  showResolutionModal(round)
  
  // 4. Usuário pode clicar "Redeem" ou automático
  await redeemUserShares(roundId)
}

// Settlement automático (opcional)
async function autoRedeemShares(roundId: string) {
  const positions = await getUserPositions(roundId)
  const round = await getRound(roundId)
  
  if (round.status === 'RESOLVED') {
    for (const pos of positions) {
      if (pos.side === round.outcome) {
        // Chama smart contract para redeem
        await contract.redeemShares(roundId, pos.side)
      }
    }
  }
}
```

#### 3. Precificação da Próxima Rodada

```typescript
// Nova rodada sempre começa com pool limpo
function createNewRound(timestamp: number, priceAtStart: number) {
  const newRoundId = `round-${Math.floor(timestamp / 1000)}`
  
  return {
    id: newRoundId,
    startAt: timestamp,
    endsAt: timestamp + 60000,
    priceAtStart,
    status: 'TRADING',
    pool: {
      reserveUp: 10_000,    // Sempre começa em 10k
      reserveDown: 10_000,  // Sempre começa em 10k
      k: 100_000_000
    }
  }
}
```

**Importante:** Cada rodada é **completamente independente**. Não há carry-over de liquidez entre rodadas.

---

## Fluxo Completo Visualizado

```
┌─────────────────────────────────────────────────┐
│ Rodada N (round-1737654000)                    │
├─────────────────────────────────────────────────┤
│ Pool: 10k UP / 10k DOWN (50/50)                │
│ Usuário compra: $50 → recebe 37.5 UP tokens    │
│ Tokens: {roundId: "round-1737654000", side: UP}│
└─────────────────────────────────────────────────┘
                    ↓
            [Rodada termina]
                    ↓
┌─────────────────────────────────────────────────┐
│ Resolução: UP venceu                            │
├─────────────────────────────────────────────────┤
│ Settlement:                                      │
│ - 37.5 UP tokens → $37.50 (1:1)                │
│ - Tokens são queimados                          │
│ - USDCx transferido para usuário                 │
└─────────────────────────────────────────────────┘
                    ↓
            [Nova rodada começa]
                    ↓
┌─────────────────────────────────────────────────┐
│ Rodada N+1 (round-1737654060)                   │
├─────────────────────────────────────────────────┤
│ Pool: 10k UP / 10k DOWN (50/50) NOVO           │
│ Tokens: {roundId: "round-1737654060", ...}     │
│ ↑ IDs diferentes = sem confusão                 │
└─────────────────────────────────────────────────┘
```

---

## Considerações de Implementação

### MVP (Atual - Em Memória)
- ✅ Funciona para demonstração
- ⚠️ Não há settlement real
- ⚠️ Tokens não são on-chain

### Produção (Stacks/USDCx)
- 🔄 Implementar smart contract com `roundId` nos tokens
- 🔄 Oracle para preço de fecho (ou API confiável)
- 🔄 Settlement automático ou manual (usuário clica "Redeem")
- 🔄 Interface para visualizar tokens por rodada

### Segurança
- ✅ Verificar que rodada está `RESOLVED` antes de redeem
- ✅ Verificar que `roundId` do token corresponde à rodada
- ✅ Prevenir double-spending
- ✅ Validar preço de fecho (oracle/API confiável)

---

## Conclusão

**Recomendação:** Usar **Opção 2 (Settlement Imediato com Registros)** porque:

### Vantagens Econômicas:
1. **10x mais barato** - sem custos de minting (~0.001-0.005 STX vs ~0.01-0.05 STX)
2. **Escalável** - pode lidar com alto volume sem custos proibitivos
3. **Viável em produção** - custos são gerenciáveis mesmo com 100+ trades/minuto

### Vantagens Técnicas:
1. **Mais simples** - não precisa gerenciar tokens físicos
2. **Settlement automático** - direto e eficiente
3. **On-chain** - todas as posições registradas no smart contract
4. **Seguro** - verificável e auditável

### Trade-offs Aceitáveis:
- Tokens não são transferíveis (mas isso não é necessário para o caso de uso)
- Usuário não "possui" tokens na carteira (mas tem posição registrada on-chain)

**Próximos Passos:**
1. Projetar smart contract detalhado com registros (sem minting)
2. Implementar sistema de posições por rodada
3. Implementar settlement automático ao resolver rodada
4. Testar custos reais na testnet da Stacks
5. Otimizar para minimizar custos de gas
