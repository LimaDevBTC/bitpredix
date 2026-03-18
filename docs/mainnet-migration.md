# Predix v1 — Plano de Implementação

> **Objetivo:** Implementar a arquitetura predixv1 completa (gateway-only, timelocks, price bounds, jackpot off-chain) em **testnet**. Quando estável, migrar para mainnet com deploy idêntico + troca de env vars.
> **Estratégia em 3 fases:**
> 1. **Agora:** Implementar tudo em testnet (contratos, gateway, API hardening, settlement, jackpot)
> 2. **Mainnet Fase 1:** Deploy dos mesmos contratos em mainnet + test-token (USDCx mintável)
> 3. **Mainnet Fase 2:** Token real (pós-auditoria externa)
>
> **Rede atual:** Stacks testnet → Stacks mainnet (pós-Nakamoto, block time ~10s)

---

## Índice

### Parte I — Arquitetura e Especificação (implementar agora em testnet)

1. [Arquitetura predixv1](#1-arquitetura-predixv1)
2. [Vulnerabilidades Corrigidas](#2-vulnerabilidades-corrigidas)
3. [Contrato: predixv1.clar](#3-contrato-predixv1clar)
4. [Contrato: gatewayv1.clar](#4-contrato-gatewayv1clar)
5. [Token Strategy](#5-token-strategy)
6. [Wallets e Fee Split](#6-wallets-e-fee-split)
7. [Configuração de Rede](#7-configuração-de-rede)
8. [API Routes — Hardening](#8-api-routes--hardening)
9. [Settlement Engine (Cron)](#9-settlement-engine-cron)
10. [Frontend](#10-frontend)
11. [Anti-Abuse](#11-anti-abuse)
12. [Jackpot 2.0 — Loteria Diária](#12-jackpot-20--loteria-diária)

### Parte II — Deploy Testnet (agora)

13. [Deploy Testnet — Sequence](#13-deploy-testnet--sequence)
14. [Testes e Validação](#14-testes-e-validação)

### Parte III — Mainnet Migration (posterior)

15. [Migração para Mainnet](#15-migração-para-mainnet)
16. [Auditoria de Segurança](#16-auditoria-de-segurança)
17. [Monitoramento Pós-Launch](#17-monitoramento-pós-launch)
18. [Incident Response](#18-incident-response)
19. [Fase 2 — Token Real](#19-fase-2--token-real)
20. [Comunicação e Status](#20-comunicação-e-status)
21. [Checklist Final](#21-checklist-final)

---

## 1. Arquitetura predixv1

### 1.1 Princípios

| Princípio | Implementação |
|-----------|--------------|
| **Gateway-only** | Toda interação (bets + settlement) passa pelo gateway. predixv1 rejeita chamadas diretas. |
| **Sponsor-only settlement** | Usuários nunca claimam. O cron resolver (sponsor wallet) resolve rounds e distribui payouts automaticamente. |
| **Pre-settlement window** | Apostas fecham aos 50s. Últimos 10s são janela de computação server-side (fees, bilhetes jackpot off-chain, validação). |
| **Zero trust no client** | Preços definidos apenas pelo cron (Pyth Benchmarks). Nenhum usuário toca em preços on-chain. |
| **Defense-in-depth** | Mesmo que o sponsor seja confiável, o contrato aplica price bounds on-chain e timelocks em funções admin. Camadas de defesa redundantes. |
| **Timelock em admin functions** | `set-gateway` e `set-sponsor` exigem delay de 144 blocks (~24h). Mudanças críticas são visíveis on-chain antes de ativarem. |

### 1.2 Fluxo de Dados

```
APOSTAS:
  User wallet → Xverse sign → /api/sponsor → Gateway → predixv1.place-bet

SETTLEMENT (automático):
  Vercel Cron (1x/min)
    → /api/cron/resolve
    → Pyth Benchmarks (preço determinístico)
    → /api/sponsor → Gateway → predixv1.resolve-and-distribute

FALLBACK:
  resolver-daemon.mjs (Railway/Render, contínuo)
    → mesmo fluxo do cron
```

### 1.3 Timeline de uma Round (60s)

```
0s          20s              50s        60s
|-- early --|--- normal ------|-- pre ---|
|           |                 |          |
| bilhetes  | bets normais   | servidor |
| jackpot   |                | computa  |
| (off-chain)|               | fees,    |
|           |                | valida   |
| TRADING_WINDOW (u50)       | round    |
|<-------------------------->|          |
                              | CLOSE   |
                              | cron    |
                              | resolve |
                              | + calc  |
                              | bilhetes|
                              | off-chain|
```

---

## 2. Vulnerabilidades Corrigidas

### 2.1 Jackpot Drain sem Contraparte → ELIMINADO

**Problema (predixv2):** `process-claim` distribuía jackpot bonus com apenas um lado apostando. Bypass do sponsor permitia drain.

**Fix (predixv1):** Jackpot é 100% off-chain (Redis). O contrato não tem nenhuma lógica de jackpot — cobra 3% flat de fee e o backend separa 1% para o fundo do jackpot. Sem contraparte: refund integral sem fee, zero acúmulo no jackpot.

**Defesa adicional:** Como settlement é sponsor-only via gateway, o vetor de bypass direto não existe mais. O jackpot no Redis é controlado exclusivamente pelo backend.

### 2.2 Claim Direto com Preços Fabricados → ELIMINADO

**Problema (predixv2):** `claim-round-side` era público. Qualquer usuário com STX podia definir preços arbitrários como primeiro claimer.

**Fix (predixv1):** Não existe função de claim pública. Settlement é exclusivo do sponsor via gateway. Preços vêm do Pyth Benchmarks (determinísticos).

### 2.3 Early Flag Spoofing → ELIMINADO

**Problema (predixv2):** Flag `early` passado pelo caller poderia ser spoofado para ganhar bonus de jackpot.

**Fix (predixv1):** Não existe flag `early` on-chain. A elegibilidade para bilhetes do jackpot (janela 0-20s) é determinada 100% off-chain pelo sponsor/backend com base no timestamp de chegada da tx. O contrato não sabe e não precisa saber sobre a janela de 20s.

### 2.4 Oracle Trust → RESOLVIDO

**Problema (predixv2):** Primeiro claim definia preços sem verificação on-chain.

**Fix (predixv1):** Apenas o sponsor (via cron) define preços. Fonte: Pyth Benchmarks API (determinístico, mesmo resultado para qualquer caller). Nenhum usuário interage com preços on-chain.

### 2.5 Sponsor Comprometido → MITIGADO (defense-in-depth)

**Problema:** Se a `SPONSOR_MNEMONIC` vaza, o atacante pode resolver rounds com preços fabricados e drenar pools via gateway.

**Fix (predixv1):**
1. **Price bounds on-chain:** `resolve-and-distribute` rejeita preços que divergem >1% do `last-known-price`. BTC tipicamente move 0.01-0.1% em 60s — bound de 1% cobre flash crashes enquanto limita manipulação.
2. **Bootstrap protegido:** `set-initial-price` (deployer-only, one-shot) define `last-known-price` no deploy. `resolve-and-distribute` rejeita se `last-known-price == 0`. Sem janela de bootstrap vulnerável.
3. **Rotação de sponsor:** `schedule-sponsor` com timelock de 144 blocks (~24h). Se comprometido, pausar gateway imediatamente e agendar novo sponsor.
4. **Monitoramento:** Alertas se settlement usa preços próximos do bound (possível manipulação).

**Risco residual:** O sponsor pode resolver com preços dentro do bound de 1%, causando lucro/prejuízo indevido de até 1% por round. Mitigação: circuit breaker no cron (0.5% threshold — seção 9.6) + monitoramento ativo + rotação rápida da key. Para Fase 2, considerar validação on-chain via Pyth proof (quando disponível no Stacks).

### 2.6 Gateway Upgrade Malicioso → MITIGADO (timelock)

**Problema:** `set-gateway` instantâneo permitiria deployer (se comprometido) apontar para um gateway malicioso e drenar o contrato.

**Fix (predixv1):** Timelock de 144 blocks (~24h) no `schedule-gateway`. Qualquer mudança de gateway é visível on-chain antes de ativar. A comunidade pode detectar e reagir (pausar contrato, emergency withdraw).

---

## 3. Contrato: predixv1.clar

Fork de `predixv2.clar` com os seguintes diffs:

| Área | Mudança | Impacto |
|------|---------|---------|
| **TRADING_WINDOW** | `u55` → `u50` | 10s pre-settlement window |
| **Gateway-only enforcement** | TODA função pública exige `(is-eq contract-caller GATEWAY)` | Zero superfície de ataque direta |
| **Counterparty check** | `has-counterparty` em `process-claim`. Se false: refund sem fee | Elimina drain sem contraparte |
| **resolve-and-distribute** | Nova função: resolve round + distribui payouts em uma tx (sponsor-only via gateway) | Settlement atômico |
| **Remover claim público** | `claim-round-side` removido ou restrito a gateway | Sem claim do user |
| **Fee recipient** | `set-fee-recipient` (deployer-only) em vez de hardcoded | Flexibilidade |
| **set-gateway** | Deployer-only, permite upgrade de gateway sem redeploy do contrato | Upgradeability |
| **set-sponsor** | Deployer-only, data-var para sponsor address | Separação deployer/sponsor |
| **Jackpot off-chain** | Jackpot gerenciado via Redis (não on-chain). Contrato cobra 3% flat, backend separa 2% operacional + 1% jackpot | Simplicidade, menos gas, menos superfície de ataque |
| **Emergency withdraw** | Deployer-only. Requer `paused=true` por min 200 blocks (~33 min). Emite `(print)` para audit trail | Segurança com auditabilidade |
| **Price bounds on-chain** | `resolve-and-distribute` valida que `price-start` e `price-end` estão dentro de ±1% do `last-known-price` (data-var atualizada a cada settlement). Rejeita preços absurdos mesmo se sponsor comprometido. BTC move ~0.01-0.1% em 60s — 1% é margem segura para flash crashes. | Defense-in-depth |
| **set-initial-price** | Deployer-only. Define `last-known-price` no deploy, eliminando janela de bootstrap onde primeiro settlement aceita qualquer preço. `resolve-and-distribute` rejeita se `last-known-price == 0` (força inicialização). | Elimina vetor de ataque no bootstrap |
| **Timelock em set-gateway** | `set-gateway` agenda mudança para `block-height + 144` (~24h). Nova data-var `pending-gateway` + `gateway-activation-block`. `activate-gateway` efetiva após o delay. Mesmo padrão para `set-sponsor`. | Previne upgrade malicioso instantâneo |
| **set-initial-price** | Deployer-only, one-shot (só funciona se `last-known-price == 0`). Define preço inicial do BTC para calibrar price bounds. Chamada obrigatória logo após deploy, antes de qualquer settlement. | Elimina vetor de bootstrap |
| **Emergency withdraw parcial** | Em vez de drenar 100% dos fundos, `emergency-withdraw` transfere no máximo 50% do saldo por execução. Requer 200 blocks entre cada chamada. Para Fase 2, considerar multi-sig. | Limita blast radius se deployer comprometido |

### 3.1 Funções Públicas (todas gateway-only)

```clarity
;; Apostas (user via sponsor → gateway)
(place-bet (round-id uint) (side (string-ascii 4)) (amount uint))

;; Settlement (sponsor via cron → gateway)
;; Valida price bounds on-chain: |price - last-known-price| <= 1% do last-known-price
;; Rejeita se last-known-price == 0 (força inicialização via set-initial-price)
(resolve-and-distribute (round-id uint) (price-start uint) (price-end uint))

;; Admin (deployer-only, timelocked)
(set-initial-price (price uint))           ;; deployer-only, só funciona se last-known-price == 0 (one-shot bootstrap)
(set-fee-recipient (new principal))        ;; imediato (baixo risco)
(schedule-gateway (new principal))         ;; agenda para block-height + 144 (~24h)
(activate-gateway)                         ;; efetiva após timelock expirar
(schedule-sponsor (new principal))         ;; agenda para block-height + 144 (~24h)
(activate-sponsor)                         ;; efetiva após timelock expirar
(set-paused (paused bool))                 ;; imediato (emergency use)
(emergency-withdraw)                       ;; requer paused=true por 200+ blocks, max 50% por execução
```

### 3.1.1 Data Vars Adicionais

```clarity
;; Price bounds (defense-in-depth)
(define-data-var last-known-price uint u0)       ;; inicializado via set-initial-price, atualizado a cada settlement
(define-data-var price-bound-bps uint u100)      ;; 1% = 100 BPS (BTC move ~0.01-0.1% em 60s)

;; Timelocks
(define-data-var pending-gateway (optional principal) none)
(define-data-var gateway-activation-block uint u0)
(define-data-var pending-sponsor (optional principal) none)
(define-data-var sponsor-activation-block uint u0)
(define-constant TIMELOCK_BLOCKS u144)           ;; ~24h com blocks de 10s

;; Emergency withdraw tracking
(define-data-var last-withdraw-block uint u0)    ;; previne drains consecutivos rápidos
```

### 3.2 Dados Removidos

- `user-pending-rounds` → desnecessário (sponsor gerencia settlement)
- `claim-round-side` → removido (sem claim público)
- `claim-on-behalf` → substituído por `resolve-and-distribute`

### 3.3 ASCII Compliance

```bash
# OBRIGATÓRIO antes de deploy — deve retornar vazio
grep -P '[^\x00-\x7F]' contracts/predixv1.clar
```

---

## 4. Contrato: gatewayv1.clar

Fork de `predixv2-gateway.clar`:

| Área | Mudança |
|------|---------|
| **Contract reference** | Aponta para `predixv1` |
| **resolve-and-distribute** | Nova função proxy, restrita a sponsor |
| **Sponsor check** | Settlement functions exigem `(is-eq tx-sender SPONSOR)` |
| **Round sanity** | Mantém `current-round ± 1` para bets |

```clarity
;; Gateway verifica:
;; - place-bet: qualquer tx-sender (via sponsor), round sanity, not paused
;; - resolve-and-distribute: tx-sender == SPONSOR, not paused
```

---

## 5. Token Strategy

### Fase 1 — Mainnet com Test Token

- Redeployar `test-usdcx.clar` em mainnet (mesmo código, mintável)
- Qualquer usuário minta 1000 USDCx grátis (onboarding zero-friction)
- **Propósito:** Validar toda a infra em mainnet real sem risco financeiro
- **Duração:** 1-2 semanas de operação estável

### Fase 2 — Token Real (pós-validação)

> **PRE-REQUISITO:** Fase 1 estável por min 2 semanas + auditoria externa concluída.

#### 5.2.1 Escopo

| Área | Mudança |
|------|---------|
| **Token** | Substituir `test-usdcx` por token real (USDCX wrapped ou sBTC). Deploy novo contrato SIP-010 sem `mint` público. |
| **Deposit/Withdraw** | Novo flow: user deposita token real → recebe balance interno. Withdraw via request + cooldown de 1h. |
| **MIN_BET** | Reavaliar com base no valor real do token. Ex: se USDC, manter 1 USDC. Se sBTC, ajustar para ~$1 equivalente. |
| **Limites** | Max bet por round: 1,000 USDC (previne whale manipulation). Max exposure por wallet: 10,000 USDC. |
| **KYC** | Avaliar necessidade regulatória. Se necessário, integrar verificação antes do primeiro deposit. |
| **Emergency withdraw** | Multi-sig obrigatório (2-of-3). Não apenas deployer wallet. |
| **Auditoria externa** | **OBRIGATÓRIA** antes da Fase 2. Não recomendada — obrigatória. |
| **Insurance fund** | Reservar 5% das fees coletadas como fundo de seguro para cobrir bugs/exploits. |

#### 5.2.2 Migração Fase 1 → Fase 2

1. Pausar gatewayv1 (`set-paused(true)`)
2. Resolver todas as rounds pendentes
3. Comunicar aos usuários: "Fase de test token encerrada"
4. Deploy novos contratos com token real
5. Atualizar env vars + redeploy frontend
6. Período de grace: 7 dias para users resgatarem test tokens (se aplicável)

#### 5.2.3 Cronograma Estimado

| Etapa | Duração |
|-------|---------|
| Fase 1 estável | 2-4 semanas |
| Auditoria externa | 2-3 semanas |
| Desenvolvimento Fase 2 | 2-3 semanas |
| Testes Fase 2 em testnet | 1-2 semanas |
| Deploy Fase 2 mainnet | 1 semana |

**Este documento foca na Fase 1. A Fase 2 será detalhada em documento separado (`docs/phase2-real-token.md`).**

---

## 6. Wallets e Fee Split

### 6.1 Estrutura

| Wallet | Função | Funding |
|--------|--------|---------|
| **Deployer** | Deploy contratos, `set-*` admin functions, `emergency-withdraw` | ~5 STX (deploy). Guardar cold. |
| **Sponsor** | Sponsoring txs + cron settlement. Paga gas de todos. | ~100 STX inicial. Monitorar diariamente. |
| **Fee Collector** | Recebe 2% protocol fee | Passivo. |

### 6.2 Separação

- `DEPLOYER_MNEMONIC` — usada apenas no script de deploy. Não fica em env de produção.
- `SPONSOR_MNEMONIC` — usada pelo `/api/sponsor` e `/api/cron/resolve`. Env vars do Vercel + Railway.
- predixv1 define `DEPLOYER` como quem fez deploy, `SPONSOR` como data-var configurável.

### 6.3 Funding do Sponsor

| Volume | Gas/dia | Recomendação |
|--------|---------|-------------|
| 100 bets/dia | ~5 STX | 100 STX inicial |
| 1000 bets/dia | ~50 STX | 500 STX inicial |

- Se saldo < 10 STX → warning no log
- Se saldo < 2 STX → `/api/sponsor` retorna 503

---

## 7. Configuração de Rede

### 7.1 Config Central: `lib/config.ts`

```typescript
export const NETWORK_NAME = (process.env.NEXT_PUBLIC_STACKS_NETWORK || 'testnet') as 'testnet' | 'mainnet'

const BITPREDIX_CONTRACT = process.env.NEXT_PUBLIC_BITPREDIX_CONTRACT_ID
if (!BITPREDIX_CONTRACT) throw new Error('NEXT_PUBLIC_BITPREDIX_CONTRACT_ID is required')

const GATEWAY_CONTRACT = process.env.NEXT_PUBLIC_GATEWAY_CONTRACT_ID
if (!GATEWAY_CONTRACT) throw new Error('NEXT_PUBLIC_GATEWAY_CONTRACT_ID is required')

const TOKEN_CONTRACT = process.env.NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID
if (!TOKEN_CONTRACT) throw new Error('NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID is required')

export { BITPREDIX_CONTRACT, GATEWAY_CONTRACT, TOKEN_CONTRACT }
```

**Fail-fast:** Em mainnet, se qualquer env var estiver faltando, o app crasha imediatamente em vez de usar endereço testnet silenciosamente.

### 7.2 Hiro API: `lib/hiro.ts`

```typescript
export const HIRO_API = NETWORK_NAME === 'mainnet'
  ? 'https://api.mainnet.hiro.so'
  : 'https://api.testnet.hiro.so'
```

38+ arquivos importam `HIRO_API` — mudança se propaga automaticamente.

### 7.3 Network Object

```typescript
import { STACKS_TESTNET, STACKS_MAINNET } from '@stacks/network'
export const STACKS_NETWORK = NETWORK_NAME === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET
```

### 7.4 Arquivos com `'testnet'` hardcoded

| Arquivo | Mudança |
|---------|---------|
| `lib/sponsored-tx.ts` L52 | `network: NETWORK_NAME` |
| `app/api/sponsor/route.ts` L56, L218, L259 | `network: NETWORK_NAME` / `STACKS_NETWORK` |
| `app/api/cron/resolve/route.ts` L35-38 | Contract via env, network via config |
| `scripts/resolver-daemon.mjs` L44-46 | Contract + API via env |

### 7.5 Remover Fallbacks Hardcoded

Aplicar fail-fast em todos os arquivos que usam `|| 'ST1QPM...'`:

| Arquivo | Linhas |
|---------|--------|
| `components/MarketCardV4.tsx` | L20-22 |
| `components/MintTestTokens.tsx` | L6 |
| `app/api/sponsor/route.ts` | L23-28 |
| `app/api/allowance-status/route.ts` | L7-8 |
| `app/api/mint-status/route.ts` | L6 |
| `app/api/cron/resolve/route.ts` | L35-36 |
| `scripts/resolver-daemon.mjs` | L44-45 |

### 7.6 Env Vars — Template Completo

```env
# === Network ===
NEXT_PUBLIC_STACKS_NETWORK=mainnet

# === Contracts (preenchido após deploy) ===
NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=<DEPLOYER>.predixv1
NEXT_PUBLIC_GATEWAY_CONTRACT_ID=<DEPLOYER>.gatewayv1
NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID=<DEPLOYER>.test-usdcx

# === Wallets ===
SPONSOR_MNEMONIC=<sponsor wallet mnemonic>

# === Hiro API ===
HIRO_API_KEY=<mainnet API key — tier Developer ou superior>

# === Redis ===
UPSTASH_REDIS_REST_URL=<instance dedicado para mainnet>
UPSTASH_REDIS_REST_TOKEN=<token>

# === Cron ===
CRON_SECRET=<novo secret para mainnet>

# === Fees ===
SPONSOR_TX_FEE=50000

# === Alerting ===
DISCORD_ALERT_WEBHOOK=<discord webhook URL>

# === Circuit Breaker ===
PRICE_CHANGE_THRESHOLD=0.005
```

---

## 8. API Routes — Hardening

### 8.1 `/api/sponsor/route.ts`

| Mudança | Prioridade |
|---------|-----------|
| `ALLOWED_CONTRACTS` via env (predixv1 + gateway + token) | CRÍTICO |
| `SPONSOR_MNEMONIC` em vez de `ORACLE_MNEMONIC` | CRÍTICO |
| `NETWORK_NAME` em vez de `'testnet'` literal (L52, L218, L259) | CRÍTICO |
| Remover funções de claim de `ALLOWED_FUNCTIONS` | CRÍTICO |
| Fee via env `SPONSOR_TX_FEE` (default 50000) | ALTO |
| Fee estimation dinâmica: `GET /v2/fees/transfer` × 1.5, cap 500000 | ALTO |
| Body size limit: rejeitar `txHex` > 100KB | ALTO |
| Rate limit: 5 txs/min por wallet via Redis | MÉDIO |
| Timeout: AbortController 10s em `sponsorTransaction()` | MÉDIO |

### 8.2 `/api/round/route.ts`

| Mudança | Prioridade |
|---------|-----------|
| Contract IDs via config (sem fallback) | CRÍTICO |
| HIRO_API dinâmico (já usa import, só precisa fix 7.2) | CRÍTICO |
| Try-catch no deserialization de Clarity values | MÉDIO |

### 8.3 `/api/open-price/route.ts`

| Mudança | Prioridade |
|---------|-----------|
| Price bounds: ±1% do último preço Pyth conhecido | ALTO |
| Round ID bounds: aceitar apenas `currentRound` ou `currentRound + 1` | MÉDIO |

### 8.4 `/api/pool-update/route.ts`

| Mudança | Prioridade |
|---------|-----------|
| Rejeitar updates para rounds encerradas | MÉDIO |
| Retornar 503 se Redis offline (não silenciar) | MÉDIO |

### 8.5 `/api/mint-status` e `/api/allowance-status`

| Mudança | Prioridade |
|---------|-----------|
| Contract IDs via config (sem fallback) | CRÍTICO |

---

## 9. Settlement Engine (Cron)

O cron é **infraestrutura mission-critical**. Se parar, ninguém recebe payout.

### 9.1 Primary: Vercel Cron

`/api/cron/resolve/route.ts` — executa a cada minuto.

| Mudança | Prioridade |
|---------|-----------|
| Contract address/name via env (sem hardcode L35-36) | CRÍTICO |
| `STACKS_MAINNET` condicional | CRÍTICO |
| `SPONSOR_MNEMONIC` em vez de `ORACLE_MNEMONIC` | CRÍTICO |
| Fee dinâmica via env | ALTO |
| Adaptar para `resolve-and-distribute` (substituir claim-on-behalf) | CRÍTICO |
| Alerting: se 3 falhas consecutivas → `console.error('[ALERT] ...')` | ALTO |

**Requisito: Vercel Pro** (cron a cada 1 min, timeout 60s).

**Cron adicional — Jackpot Draw:**
- `/api/cron/jackpot-draw` — executa diariamente às 21h ET (`0 21 * * *` timezone America/New_York)
- Aguarda primeiro bloco Bitcoin após 21h ET (poll a cada 30s, timeout 15min)
- Calcula vencedor, executa pagamento on-chain, publica log

### 9.2 Secondary: Resolver Daemon (Railway/Render)

`scripts/resolver-daemon.mjs` rodando **continuamente** como processo background.

| Mudança | Prioridade |
|---------|-----------|
| Contract address via env (sem hardcode L44-45) | CRÍTICO |
| Hiro API URL via env (sem hardcode L46) | CRÍTICO |
| `STACKS_MAINNET` | CRÍTICO |
| Fee via env | ALTO |
| Adaptar para `resolve-and-distribute` | CRÍTICO |

**Deploy:** Railway free tier ou Render (processo contínuo, restarts automáticos).

O daemon verifica a cada 65s. Se o Vercel Cron já resolveu, o daemon detecta round já resolvida e pula.

### 9.3 Nonce Management

Sponsor e cron compartilham a mesma wallet e o mesmo nonce tracking via Redis.

| Item | Spec |
|------|------|
| **Lock** | Redis SETNX, TTL **20s** (auto-release se crash). 20s > block time de ~10s, previne conflito entre cron e daemon tentando resolver a mesma round. |
| **Round dedup** | Key `resolving:{round-id}` com TTL 120s. Antes de resolver, checar se key existe. Se sim, pular (outro processo já está resolvendo). |
| **Retry** | 3 tentativas, backoff 500ms → 1s → 2s |
| **Fallback** | Se Redis miss, query nonce on-chain: `GET /v2/accounts/{sponsor}` |
| **TTL das keys** | `sponsor-nonce`: 2 min. `sponsor-lock`: 20s. `resolving:{round-id}`: 120s. |

### 9.4 Pre-Settlement Window (50s-60s)

Durante os últimos 10s de cada round, o server pode:
1. Verificar se a round é válida (apostas nos dois lados)
2. Determinar primeiro apostador e maior aposta de cada lado (dados para bilhetes do jackpot)
3. Preparar dados de settlement
4. O cron inicia `resolve-and-distribute` no segundo 60

**Pós-settlement (off-chain):**
1. Backend calcula bilhetes de cada apostador (multiplicadores 1x/2x/4x)
2. Credita 1/3 do fee (= 1% do volume) no saldo do jackpot (Redis)
3. Acumula bilhetes do dia no Redis

Com blocks de ~10s (Nakamoto), é garantido pelo menos 1 block nessa janela.

### 9.5 instrumentation.ts

Sem mudanças necessárias. Usa Pyth Hermes (rede-agnóstico) e Redis via `pool-store`.

### 9.6 Circuit Breaker — Price Sanity no Cron

O cron DEVE validar preços antes de submeter settlement. Isso é a primeira linha de defesa (o contrato tem price bounds on-chain como segunda linha).

```typescript
// Em /api/cron/resolve e resolver-daemon.mjs
const PRICE_CHANGE_THRESHOLD = 0.005 // 0.5% em 60s = anormal para BTC (tipicamente 0.01-0.1%)
const PRICE_DIVERGENCE_THRESHOLD = 0.003 // 0.3% entre Hermes e Benchmarks

async function validatePrices(priceStart: number, priceEnd: number): Promise<{ valid: boolean; reason?: string }> {
  // 1. Variação excessiva em 60s
  const change = Math.abs(priceEnd - priceStart) / priceStart
  if (change > PRICE_CHANGE_THRESHOLD) {
    return { valid: false, reason: `Price change ${(change * 100).toFixed(2)}% exceeds ${PRICE_CHANGE_THRESHOLD * 100}% threshold` }
  }

  // 2. Cross-check: Pyth Benchmarks vs Hermes SSE
  const hermesPrice = await fetchHermesPrice() // preço live do SSE
  const benchmarkPrice = priceEnd
  const divergence = Math.abs(hermesPrice - benchmarkPrice) / hermesPrice
  if (divergence > PRICE_DIVERGENCE_THRESHOLD) {
    return { valid: false, reason: `Hermes/Benchmark divergence ${(divergence * 100).toFixed(2)}% exceeds ${PRICE_DIVERGENCE_THRESHOLD * 100}% threshold` }
  }

  // 3. Sanity: preço dentro de faixa razoável para BTC ($10k-$500k)
  if (priceEnd < 10_000 || priceEnd > 500_000) {
    return { valid: false, reason: `Price ${priceEnd} outside sane range ($10k-$500k)` }
  }

  return { valid: true }
}

// No fluxo do cron:
const validation = await validatePrices(priceStart, priceEnd)
if (!validation.valid) {
  console.error(`[CIRCUIT-BREAKER] Skipping round ${roundId}: ${validation.reason}`)
  await incrementAlertCounter('circuit-breaker')
  // Round fica pendente — será reavaliada no próximo ciclo
  // Se 3 rounds consecutivas falharem, emitir alerta CRITICAL
  return
}
```

**Thresholds ajustáveis:** Em períodos de alta volatilidade (ex: halving, crash), o threshold de 0.5% pode disparar frequentemente. Opções:
1. Env var `PRICE_CHANGE_THRESHOLD` (default 0.005)
2. Se circuit breaker disparar >3x em 10 min, aumentar threshold temporariamente para 2% (auto-escalation)
3. Log de todas as ativações para análise posterior
4. **Camadas de defesa:** cron (0.5%) → contrato on-chain (1%) → sanity range ($10k-$500k). Cada camada é mais permissiva que a anterior.

### 9.7 Stress Test do Settlement

> **OBRIGATÓRIO** antes do deploy mainnet.

| Cenário | Como Testar | Critério de Sucesso |
|---------|-------------|---------------------|
| 50 bets simultâneos em 1 round | Script que envia 50 `place-bet` via `/api/sponsor` em paralelo | Todos confirmados on-chain, nonce sem conflito |
| Cron + daemon competindo | Ambos ativos, verificar que apenas 1 resolve cada round | Round dedup key funciona, 0 erros de "already resolved" |
| Redis restart durante round | Kill Redis, aguardar 30s, restaurar | Cron faz fallback on-chain para nonce, resolve round |
| 10 rounds consecutivas sem pausa | 10 min de operação contínua | Todas resolvidas em <15s após encerramento |
| Sponsor com 2 STX (saldo baixo) | Fundar sponsor com apenas 2 STX | Alert emitido, rounds resolvidas até acabar gas, API retorna 503 |

---

## 10. Frontend

### 10.1 MarketCardV4.tsx

| Mudança | Prioridade |
|---------|-----------|
| Contract IDs via `lib/config.ts` (fail-fast) | CRÍTICO |
| Network via `NETWORK_NAME` em sponsoredContractCall | CRÍTICO |
| Badge/banner "MAINNET" se `NETWORK_NAME === 'mainnet'` | ALTO |
| Modal de confirmação antes de assinar tx em mainnet | ALTO |
| Remover lógica de claim (user não claima mais) | CRÍTICO |

### 10.2 ClaimButton.tsx

**Remover ou converter para componente de status.** No predixv1, o user não interage com claims. O componente pode mostrar status da round (resolvida/pendente) e payout recebido.

### 10.3 ConnectWalletButton.tsx

| Mudança | Prioridade |
|---------|-----------|
| `network: NETWORK_NAME` na conexão Xverse | ALTO |

### 10.4 MintTestTokens.tsx

- **Fase 1:** Mantém (test token mintável em mainnet)
- **Fase 2:** Substituir por deposit flow

### 10.5 Positions (localStorage)

**Fix obrigatório:** Prefixar chaves com network para evitar dados fantasma cross-network.

```typescript
// lib/positions.ts
const STORAGE_KEY = `predix:${NETWORK_NAME}:trades`
const RESULTS_KEY = `predix:${NETWORK_NAME}:results`
```

Sem isso, usuários que usaram testnet verão rounds fantasma em mainnet.

### 10.6 Token Allowance

Usuários que aprovaram predixv2/gateway precisam aprovar gatewayv1. O frontend deve:
1. Detectar allowance para o novo gateway
2. Se insuficiente, mostrar prompt de approval antes do primeiro bet

### 10.7 Security Headers (CORS/CSP)

Em mainnet, adicionar Content Security Policy restritiva no `next.config.js`:

```javascript
// next.config.js — headers()
{
  key: 'Content-Security-Policy',
  value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requer unsafe-eval em dev
    "style-src 'self' 'unsafe-inline'",                 // Tailwind usa inline styles
    "connect-src 'self' https://api.mainnet.hiro.so https://hermes.pyth.network https://benchmarks.pyth.network",
    "img-src 'self' data:",
    "font-src 'self'",
    "frame-ancestors 'none'",                           // previne clickjacking
  ].join('; ')
}
```

| Header | Valor | Propósito |
|--------|-------|-----------|
| `X-Frame-Options` | `DENY` | Previne clickjacking |
| `X-Content-Type-Options` | `nosniff` | Previne MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limita leak de dados via referrer |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Desabilita APIs desnecessárias |

### 10.8 localStorage Expiração

Adicionar TTL de 7 dias nos registros de trades para evitar acúmulo indefinido:

```typescript
// lib/positions.ts
const TRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

function cleanExpiredTrades(trades: Trade[]): Trade[] {
  const cutoff = Date.now() - TRADE_TTL_MS
  return trades.filter(t => t.ts > cutoff)
}

// Chamar ao carregar e ao salvar
```

---

## 11. Anti-Abuse

### 11.1 Rate Limiting no Sponsor

```
Key:    rl:bet:{walletAddress}
Valor:  contador (INCR com EXPIRE 60)
Limite: 10 txs/min por wallet (bets + approvals)

Key:    rl:mint:{walletAddress}
Valor:  contador (INCR com EXPIRE 3600)
Limite: 1 mint/hora por wallet
```

**Justificativa do limite de 10/min:** Um usuário pode legitimamente apostar UP e DOWN na mesma round (hedging) em rounds consecutivas. Com 5/min o fluxo normal seria bloqueado. 10/min permite uso normal sem facilitar abuse.

### 11.2 Request Size

- `txHex` max: 100KB (tx normal ~1-3KB)
- Body max: 200KB
- Validar via `content-length` header

### 11.3 Sponsor Balance Monitor

- Verificação a cada execução do cron
- < 10 STX → `console.error('[ALERT] Sponsor balance low: X STX')`
- < 2 STX → `/api/sponsor` retorna 503
- Armazenar saldo em Redis key `sponsor-balance` (TTL 120s) para evitar queries repetidas

### 11.4 Jackpot Balance Monitor

- Saldo do jackpot armazenado em Redis key `jackpot:balance` (persistente, sem TTL)
- Verificação a cada execução do cron: lê `jackpot:balance` do Redis
- Log do saldo atual a cada settlement para audit trail
- Bilhetes diários em Redis key `jackpot:tickets:{day}:{user}` (TTL 48h)
- Total de bilhetes do dia em Redis key `jackpot:ticket-count:{day}` (TTL 48h)

### 11.5 Fee Estimation

```typescript
// Em vez de fee hardcoded:
const baseFee = await fetch(`${HIRO_API}/v2/fees/transfer`).then(r => r.json())
const fee = Math.min(baseFee.estimated_cost * 1.5, 500000) // cap 0.5 STX
```

---

## 12. Jackpot 2.0 — Loteria Diária

> **Spec completo:** `public/predix-jackpot2-spec.docx`
> **Princípio:** Máximo off-chain, mínimo on-chain. O contrato não sabe que o jackpot existe.

### 12.1 Resumo

Loteria diária que premia apostadores que entram nos primeiros 20s de cada round. Incentiva liquidez early e cria engagement diário.

| Parâmetro | Valor |
|-----------|-------|
| Fee split | 3% flat on-chain → backend separa 2% operacional + 1% jackpot |
| Seed inicial | $200 (creditado no Redis no deploy) |
| Acúmulo | 1% do volume de cada round válido (= 1/3 do fee total) |
| Janela de elegibilidade | Primeiros 20s do round (validado pelo sponsor) |
| Sorteio | Diário às 21h ET |
| Pagamento por sorteio | 10% do fundo acumulado |
| Fonte de aleatoriedade | Hash do primeiro bloco Bitcoin minerado após 21h ET |
| Jackpot | Nunca zera — cresce indefinidamente |

### 12.2 O que fica on-chain vs off-chain

| Dado | Onde | Por quê |
|------|------|---------|
| Fee de 3% | On-chain | Cobrado no `resolve-and-distribute`, enviado ao fee-recipient |
| Split 2%+1% | Off-chain (backend) | Backend credita 1/3 do fee recebido no saldo jackpot (Redis) |
| Saldo do jackpot | Redis (`jackpot:balance`) | Volume alto de updates, sem necessidade de auditoria on-chain na Fase 1 |
| Bilhetes por usuário/dia | Redis (`jackpot:tickets:{day}:{user}`) | Calculado off-chain, TTL 48h |
| Quem foi primeiro/maior | Redis (determinado pelo sponsor) | Sponsor é source of truth para timing |
| Pagamento ao vencedor | On-chain | Transfer real de tokens via deployer wallet |
| Histórico de sorteios | Redis + log público | JSON publicado com todos os dados verificáveis |

### 12.3 Sistema de Bilhetes

#### Fórmula
```
bilhetes = valor_apostado_em_USD × multiplicador
```

Apenas apostas nos primeiros 20s do round geram bilhetes.

| Condição | Multiplicador |
|----------|--------------|
| Aposta comum (0-20s) | 1x |
| Primeiro apostador do lado | 2x |
| Maior aposta do lado (0-20s) | 2x |
| Primeiro E maior do lado | 4x (não 2x+2x) |

#### Regras
- **Janela**: 0-20s de cada round — timestamp de chegada no sponsor (off-chain)
- **Universo**: Apenas rounds válidos (ambos os lados com apostas) geram bilhetes
- **Lado**: Bilhetes gerados por lado separadamente (UP e DOWN independentes)
- **Empate na maior**: Ambos recebem multiplicador 2x
- **Fora da janela**: Zero bilhetes, sem exceção
- **Round inválido**: Zero bilhetes, jackpot congela (sem acúmulo)
- **Acúmulo**: Bilhetes de todos os rounds válidos do dia acumulam até o sorteio das 21h ET

#### Fluxo de cálculo (pós-settlement)

```
1. Settlement confirma on-chain (resolve-and-distribute)
2. Backend recebe confirmação
3. Para cada apostador do round:
   a. Checar se apostou dentro dos 20s (timestamp do sponsor)
   b. Checar se foi primeiro do lado (ordem de chegada no sponsor)
   c. Checar se foi maior aposta do lado dentro dos 20s
   d. Calcular multiplicador (1x/2x/4x)
   e. bilhetes = amount_usd × multiplicador
4. Salvar no Redis:
   - INCRBY jackpot:tickets:{day}:{user} {bilhetes}
   - INCRBY jackpot:ticket-count:{day} {bilhetes}
5. Creditar 1/3 do fee no jackpot:
   - INCRBYFLOAT jackpot:balance {fee_total / 3}
```

### 12.4 Sorteio Diário — 21h ET

#### Algoritmo

```typescript
// Cron job diário — 21h ET

// 1. Congela bilhetes do dia (nenhum round após 21h ET gera bilhetes para "hoje")
const today = getDayId() // YYYY-MM-DD ou unix day

// 2. Busca total de bilhetes do dia no Redis
const totalTickets = await redis.get(`jackpot:ticket-count:${today}`)

// 3. Guard: se nenhum bilhete, skip sorteio
if (!totalTickets || totalTickets === 0) {
  console.info('[JACKPOT] No tickets today, skipping draw')
  return
}

// 4. Aguarda primeiro bloco Bitcoin minerado APÓS 21h ET
//    Poll a cada 30s até encontrar bloco com timestamp >= 21h ET
const block = await waitForBitcoinBlockAfter(targetTimestamp)
const blockHash = block.hash

// 5. Calcula índice vencedor — determinístico e auditável
const seed = BigInt('0x' + blockHash)
const winnerIndex = seed % BigInt(totalTickets)

// 6. Busca dono do bilhete vencedor
//    Itera pelos usuários do dia no Redis, somando bilhetes até atingir winnerIndex
const winner = await resolveTicketOwner(today, winnerIndex)

// 7. Calcula prêmio: 10% do fundo acumulado
const jackpotBalance = await redis.get('jackpot:balance')
const prize = Math.floor(jackpotBalance * 0.10)

// 8. Executa pagamento on-chain (transfer simples do deployer para o vencedor)
await transferTokens(winner, prize)

// 9. Atualiza saldo do jackpot no Redis
await redis.decrby('jackpot:balance', prize)

// 10. Publica log público auditável
await publishDrawLog({
  date: today,
  blockHeight: block.height,
  blockHash,
  totalTickets,
  winnerIndex: winnerIndex.toString(),
  winner,
  prize,
  jackpotBalanceAfter: jackpotBalance - prize
})
```

#### Por que primeiro bloco APÓS 21h ET?

O bloco "vigente" às 21h pode ter sido minerado antes — qualquer pessoa com acesso rápido a um node poderia antecipar o resultado. Com o primeiro bloco após 21h:
- Ninguém sabe o hash antes do sorteio fechar
- É determinístico: dado um timestamp, existe exatamente um "primeiro bloco após"
- Janela de ~10min entre freeze e resultado gera suspense (bom pro produto)

#### Verificabilidade

| Dado | Como verificar |
|------|---------------|
| Hash do bloco Bitcoin | mempool.space, blockstream.info |
| Total de bilhetes do dia | Log público do sorteio |
| Cálculo do índice | `hash % total` — reproduzível por qualquer pessoa |
| Pagamento executado | Transação Stacks on-chain |

### 12.5 Redis Keys — Jackpot

| Key | Tipo | TTL | Descrição |
|-----|------|-----|-----------|
| `jackpot:balance` | float | Persistente | Saldo acumulado do fundo (micro-tokens) |
| `jackpot:tickets:{day}:{user}` | int | 48h | Bilhetes do usuário no dia |
| `jackpot:ticket-count:{day}` | int | 48h | Total de bilhetes do dia |
| `jackpot:first:{round-id}:{side}` | string (principal) | 120s | Primeiro apostador do lado |
| `jackpot:max-bet:{round-id}:{side}` | hash (amount, bettor) | 120s | Maior aposta do lado dentro dos 20s |
| `jackpot:draw:{day}` | JSON | 30 dias | Log do sorteio (resultado completo) |

### 12.6 Frontend — Componentes

| Componente | Descrição |
|------------|-----------|
| **Jackpot Banner** | Valor acumulado em destaque + countdown para sorteio 21h ET. Atualizado a cada settlement via `/api/round`. |
| **Indicador 0-20s** | Countdown visual nos primeiros 20s do round. Muda de cor após 20s. Exibe multiplicador potencial ("Você é o 1o UP — 2x ativo"). |
| **Meus Bilhetes** | Total de bilhetes do usuário hoje. Breakdown por round. Probabilidade estimada de ganhar. |
| **Histórico de Sorteios** | Últimos 7 sorteios: data, vencedor, premio, block hash. Link para verificação. |

### 12.7 Edge Cases

| Cenário | Comportamento |
|---------|--------------|
| Round inválido (um lado vazio) | Refund sem fee. Sem bilhetes. Jackpot congela. |
| Round inválido (ambos vazios) | Round cancela. Sem bilhetes. Jackpot congela. |
| Empate na maior aposta do lado | Ambos recebem 2x. |
| Primeiro E maior do lado | 4x (não 2x + 2x). |
| Aposta no segundo 20 exato | Elegível (janela 0-20s inclusive). |
| Nenhum bilhete no dia | Sorteio não ocorre. Jackpot acumula para o dia seguinte. |
| Redis perde dados de bilhetes | Sorteio do dia é cancelado. Jackpot balance é persistente (Upstash backup). |
| Usuário offline durante sorteio | Premio creditado on-chain — resgatável depois. |

### 12.8 API Routes — Jackpot

| Route | Method | Descrição |
|-------|--------|-----------|
| `/api/jackpot/status` | GET | Saldo atual, bilhetes do usuário hoje, countdown para sorteio |
| `/api/jackpot/history` | GET | Últimos 7 sorteios (do Redis) |
| `/api/cron/jackpot-draw` | POST | Cron diário 21h ET — executa sorteio (protegido por CRON_SECRET) |

### 12.9 Env Vars — Jackpot

```env
# Jackpot
JACKPOT_DRAW_HOUR=21              # Hora do sorteio (ET)
JACKPOT_PAYOUT_PCT=10             # % do fundo pago por sorteio
JACKPOT_TICKET_WINDOW=20          # Segundos de elegibilidade (0-20s)
JACKPOT_SEED=200000000            # Seed inicial em micro-tokens ($200)
```

---


# Parte II — Deploy Testnet (agora)

---

## 13. Deploy Testnet — Sequence

> **Objetivo:** Implementar toda a arquitetura predixv1 em testnet. O codigo que rodar aqui sera o mesmo que vai para mainnet.

### 13.1 Preparar Contratos

1. Fork `predixv2.clar` → `predixv1.clar`
2. Aplicar todas as mudancas da secao 3 (gateway-only, timelocks, price bounds, `set-initial-price`, emergency withdraw parcial)
3. Fork `predixv2-gateway.clar` → `gatewayv1.clar`
4. Aplicar mudancas da secao 4
5. ASCII scan: `grep -P '[^\x00-\x7F]' contracts/predixv1.clar contracts/gatewayv1.clar`
6. Review manual completo

### 13.2 Deploy Contratos (Testnet)

Ordem importa:
1. Deploy `test-usdcx` → anotar contract ID
2. Deploy `predixv1` → anotar ID, referencia token
3. Deploy `gatewayv1` → referencia predixv1
4. Chamar `set-initial-price(current-btc-price)` no predixv1 (obrigatorio antes de qualquer settlement)
5. Chamar `set-sponsor(sponsor-address)` no predixv1
6. Chamar `set-fee-recipient(fee-collector-address)` no predixv1

### 13.3 Aplicar Code Changes

1. Criar `lib/config.ts` (secao 7.1)
2. Atualizar `lib/hiro.ts` (secao 7.2)
3. Remover todos os hardcoded testnet addresses (secao 7.4-7.5) — fail-fast via env vars
4. Hardening das API routes (secao 8)
5. Adaptar cron + daemon para `resolve-and-distribute` (secao 9)
6. Frontend: remover claim, prefixar localStorage, re-approval flow (secao 10)
7. Anti-abuse: rate limiting, body size, sponsor balance monitor (secao 11)
8. Jackpot 2.0: bilhetes, sorteio, API routes, frontend (secao 12)
9. `npm run build` — zero erros

### 13.4 Configurar Environment (Testnet)

```env
NEXT_PUBLIC_STACKS_NETWORK=testnet
NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=<DEPLOYER>.predixv1
NEXT_PUBLIC_GATEWAY_CONTRACT_ID=<DEPLOYER>.gatewayv1
NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID=<DEPLOYER>.test-usdcx
SPONSOR_MNEMONIC=<sponsor wallet mnemonic>
UPSTASH_REDIS_REST_URL=<testnet redis instance>
UPSTASH_REDIS_REST_TOKEN=<token>
CRON_SECRET=<secret>
SPONSOR_TX_FEE=50000
DISCORD_ALERT_WEBHOOK=<discord webhook URL>
PRICE_CHANGE_THRESHOLD=0.005
JACKPOT_DRAW_HOUR=21
JACKPOT_PAYOUT_PCT=10
JACKPOT_TICKET_WINDOW=20
JACKPOT_SEED=200000000
```

### 13.5 Deploy e Validacao

1. Deploy Vercel preview → smoke tests
2. Deploy resolver-daemon (Railway/Render ou local)
3. Verificar crons ativos (settlement `* * * * *` + jackpot draw `0 21 * * *`)
4. **Jackpot seed:** `SET jackpot:balance 200000000` no Redis

### 13.6 Verificacoes Obrigatorias

> Todas estas verificacoes devem passar em testnet antes de considerar migracao para mainnet.

1. Verificar bootstrap: `resolve-and-distribute` antes de `set-initial-price` → deve rejeitar
2. Chamar `set-initial-price` → verificar que segunda chamada falha (one-shot)
3. Verificar timelocks: `schedule-gateway` → esperar 144 blocks → `activate-gateway`
4. Verificar price bounds: `resolve-and-distribute` com preco >1% do last-known → deve rejeitar
5. Verificar `emergency-withdraw`: pausar → esperar 200 blocks → withdraw → confirmar max 50%
6. Stress test (secao 9.7): 50 bets simultaneos, cron + daemon competindo
7. **Criterio de sucesso:** Operacao estavel por 1+ semana, zero erros criticos

---

## 14. Testes e Validacao

### 14.1 Smoke Tests

- [ ] Conectar wallet (Xverse) em testnet
- [ ] Mintar test-usdcx
- [ ] Aprovar token para gatewayv1
- [ ] Bet UP de 1 USDCx
- [ ] Verificar bet no UI (optimistic)
- [ ] Verificar bet on-chain
- [ ] Esperar round encerrar (60s)
- [ ] Verificar que cron resolveu a round automaticamente
- [ ] Verificar payout recebido automaticamente (sem claim do user)
- [ ] Verificar saldo atualizado na wallet

### 14.2 Security Tests

- [ ] Chamar `predixv1.place-bet` direto (sem gateway) → deve rejeitar
- [ ] Chamar `predixv1.resolve-and-distribute` direto → deve rejeitar
- [ ] Bet sem contraparte → cron refunda sem fee, jackpot nao acumula
- [ ] Bet apos 50s → rejeitado on-chain (TRADING_WINDOW)
- [ ] `/api/sponsor` com contrato nao-permitido → rejeitar
- [ ] txHex > 100KB → rejeitar
- [ ] 10 bets em 10s da mesma wallet → rate limit (429)
- [ ] Chamar gateway.resolve-and-distribute com wallet nao-sponsor → rejeitar

### 14.3 Edge Cases

- [ ] Round com 0 bets → cron ignora
- [ ] Round com bets apenas UP → refund integral sem fee, jackpot nao acumula
- [ ] TIE (price start = price end) → full refund sem fee
- [ ] Sponsor wallet saldo baixo → API retorna 503
- [ ] Redis down → API retorna 503 (nao silencia)
- [ ] Hiro API 429 → fallback per-IP (ja implementado em hiro.ts)

### 14.4 Jackpot Tests

- [ ] Seed creditado no Redis (`jackpot:balance = 200000000`)
- [ ] Bilhetes calculados corretamente pos-settlement (multiplicadores 1x/2x/4x)
- [ ] Janela 0-20s validada pelo sponsor (timestamp de chegada)
- [ ] Primeiro apostador do lado identificado corretamente
- [ ] Maior aposta do lado (dentro dos 20s) identificada corretamente
- [ ] Empate na maior → ambos recebem 2x
- [ ] Primeiro E maior → 4x (nao 2x+2x)
- [ ] Aposta no segundo 21 → zero bilhetes
- [ ] Round invalido → zero bilhetes, jackpot nao acumula
- [ ] 1% do volume creditado no jackpot a cada settlement valido
- [ ] Cron diario 21h ET funcional
- [ ] Sorteio usa primeiro bloco Bitcoin APOS 21h ET
- [ ] `hash % total_tickets` reproduz mesmo resultado em multiplas verificacoes
- [ ] Pagamento = 10% do fundo, transferido on-chain
- [ ] Saldo do jackpot atualizado apos pagamento
- [ ] Log publico do sorteio com todos os dados verificaveis
- [ ] Dia sem bilhetes → sorteio nao ocorre, jackpot acumula
- [ ] Frontend: banner, indicador 0-20s, meus bilhetes, historico de sorteios

### 14.5 Code Checklist

> Tudo implementado e funcionando em testnet.

#### Contratos
- [ ] `predixv1.clar` com todos os diffs da secao 3 (gateway-only, price bounds, timelocks, emergency withdraw parcial, `set-initial-price`)
- [ ] `predixv1.clar` sem nenhuma logica de jackpot (100% off-chain)
- [ ] `predixv1.clar` — `place-bet` sem parametro `early` (removido)
- [ ] `gatewayv1.clar` com diffs da secao 4
- [ ] ASCII scan: 0 non-ASCII bytes

#### Backend
- [ ] `lib/config.ts` — NETWORK_NAME, contract exports, fail-fast
- [ ] `lib/hiro.ts` — HIRO_API dinamico
- [ ] `lib/alerting.ts` — Discord webhook + console.error
- [ ] `lib/sponsored-tx.ts` — network dinamico
- [ ] `lib/positions.ts` — prefixo de network no localStorage + TTL 7 dias
- [ ] `lib/jackpot.ts` — logica de bilhetes, multiplicadores, acumulo Redis
- [ ] `app/api/sponsor/route.ts` — contracts, mnemonic, network, fee, rate limit (10/min), body size, remover claim functions
- [ ] `app/api/cron/resolve/route.ts` — contracts, network, mnemonic, fee, resolve-and-distribute, circuit breaker, jackpot acumulo
- [ ] `app/api/cron/jackpot-draw/route.ts` — sorteio diario 21h ET
- [ ] `app/api/jackpot/status/route.ts` — saldo, bilhetes, countdown
- [ ] `app/api/jackpot/history/route.ts` — historico de sorteios
- [ ] `app/api/round/route.ts` — contracts sem fallback
- [ ] `app/api/open-price/route.ts` — price bounds ±1%
- [ ] `app/api/pool-update/route.ts` — trading window check, 503 se Redis down
- [ ] `app/api/health/route.ts` — health check endpoint
- [ ] `app/api/allowance-status/route.ts` — contracts sem fallback
- [ ] `app/api/mint-status/route.ts` — contract sem fallback
- [ ] `scripts/resolver-daemon.mjs` — env vars, network, resolve-and-distribute, circuit breaker

#### Frontend
- [ ] `components/MarketCardV4.tsx` — contracts, network, remover claim
- [ ] `components/JackpotBanner.tsx` — valor acumulado, countdown 21h ET
- [ ] `components/TicketIndicator.tsx` — janela 0-20s, multiplicador ativo, bilhetes do dia
- [ ] `components/DrawHistory.tsx` — historico de sorteios com verificacao
- [ ] `components/ClaimButton.tsx` — converter para status display
- [ ] `components/ConnectWalletButton.tsx` — network param
- [ ] `next.config.js` — security headers (CSP, X-Frame-Options, etc.)

---

# Parte III — Mainnet Migration (posterior)

> **Pre-requisito:** Testnet estavel por 2+ semanas com arquitetura predixv1 completa.
> **Principio:** O codigo ja esta pronto. Migracao = deploy dos mesmos contratos + troca de env vars.

---

## 15. Migracao para Mainnet

### 15.1 Pre-requisitos

- [ ] Arquitetura predixv1 estavel em testnet por 2+ semanas
- [ ] Todos os testes da secao 14 passando
- [ ] Auditoria interna completa (secao 16)
- [ ] Zero findings CRITICAL/HIGH abertos
- [ ] `npm run build` — zero erros

### 15.2 Preparar Wallets Mainnet

1. Gerar deployer wallet **mainnet** (nova mnemonic, guardar cold/offline)
2. Gerar sponsor wallet **mainnet** (nova mnemonic)
3. Gerar fee-collector wallet **mainnet**
4. Fundar deployer com ~5 STX (mainnet)
5. Fundar sponsor com ~100 STX (mainnet)

### 15.3 Deploy Contratos (Mainnet)

> Mesmo codigo que esta rodando em testnet. Zero mudancas no `.clar`.

Ordem importa:
1. Deploy `test-usdcx` → anotar contract ID
2. Deploy `predixv1` → anotar ID
3. Deploy `gatewayv1` → referencia predixv1
4. `set-initial-price(current-btc-price)` no predixv1
5. `set-sponsor(sponsor-address)` no predixv1
6. `set-fee-recipient(fee-collector-address)` no predixv1

### 15.4 Redis Mainnet

- **Instance dedicado** para mainnet (separado do testnet, nunca compartilhar)
- Plano Upstash: 100MB+ (eviction policy: `noeviction`)
- Daily backup habilitado
- **Jackpot seed:** `SET jackpot:balance 200000000`

### 15.5 Trocar Env Vars

> Unica mudanca no codigo: env vars. Nenhum arquivo `.ts`/`.tsx`/`.clar` precisa mudar.

```env
# Muda de testnet → mainnet
NEXT_PUBLIC_STACKS_NETWORK=mainnet

# Novos contract IDs (mainnet deploy)
NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=<MAINNET_DEPLOYER>.predixv1
NEXT_PUBLIC_GATEWAY_CONTRACT_ID=<MAINNET_DEPLOYER>.gatewayv1
NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID=<MAINNET_DEPLOYER>.test-usdcx

# Nova wallet sponsor (mainnet)
SPONSOR_MNEMONIC=<mainnet sponsor mnemonic>

# Hiro mainnet (requer tier Developer+)
HIRO_API_KEY=<mainnet API key>

# Redis dedicado mainnet
UPSTASH_REDIS_REST_URL=<mainnet redis instance>
UPSTASH_REDIS_REST_TOKEN=<mainnet token>

# Restante: mesmos valores
CRON_SECRET=<novo secret para mainnet>
SPONSOR_TX_FEE=50000
DISCORD_ALERT_WEBHOOK=<discord webhook URL>
PRICE_CHANGE_THRESHOLD=0.005
JACKPOT_DRAW_HOUR=21
JACKPOT_PAYOUT_PCT=10
JACKPOT_TICKET_WINDOW=20
JACKPOT_SEED=200000000
```

### 15.6 Deploy e Validacao

1. Atualizar env vars no Vercel
2. Atualizar env vars no Railway/Render (resolver-daemon)
3. Deploy Vercel → smoke tests (secao 14.1, agora em mainnet)
4. Verificar crons ativos

### 15.7 Operacao Restrita (Equipe Only)

> 1-2h de operacao em mainnet apenas com wallets da equipe, antes de abrir ao publico.

1. **Nao divulgar URL** — apenas equipe core acessa
2. Cada membro executa fluxo completo: mint → approve → bet → settlement → payout
3. Monitorar metricas (secao 17.1) em tempo real
4. Verificar cron e daemon operando
5. Verificar sponsor saldo apos 20+ rounds
6. Se anomalia: `set-paused(true)` → investigar
7. **Criterio para abrir ao publico:** 30+ rounds sem erro, sponsor estavel

### 15.8 Rollback (se necessario)

| Cenario | Acao |
|---------|------|
| **Bug no frontend** | Rollback Vercel para deploy anterior. Fix, redeploy. |
| **Bug no cron/daemon** | Parar daemon. Fix. Rounds acumulam (resolvidas quando restaurar). |
| **Bug no contrato** | `set-paused(true)`. Se grave: `emergency-withdraw` apos 200 blocks. Redeploy contrato. |
| **Sponsor comprometido** | `set-paused(true)`. `schedule-sponsor(novo)`. Aguardar timelock 144 blocks. |
| **Redis inconsistente** | Flush Redis mainnet. Cron reconstroi estado do on-chain automaticamente. |

**Regra de ouro:** Na duvida, pausar primeiro, investigar depois.

### 15.9 Launch Publico

1. Smoke tests + security tests em mainnet
2. Comunicar launch (secao 20)
3. Monitorar 30+ rounds com usuarios reais

---

## 16. Auditoria de Seguranca

> Auditoria interna: executar durante operacao em testnet.
> Auditoria externa: recomendada antes do mainnet Fase 1, **obrigatoria** antes da Fase 2 (token real).

### 16.1 Escopo da Auditoria

| Componente | O que auditar | Prioridade |
|------------|--------------|-----------|
| **predixv1.clar** | Logica de apostas, settlement, payouts, emergency withdraw, controle de acesso (gateway-only), price bounds, timelocks, `set-initial-price` | CRITICO |
| **gatewayv1.clar** | Proxy de chamadas, verificacao de sponsor, round sanity, paused check | CRITICO |
| **test-usdcx.clar** | Mint logic, SIP-010 compliance, overflow/underflow | ALTO |
| **API Routes** | Validacao de inputs, rate limiting, sponsor allowlist, nonce management | ALTO |
| **Settlement Engine** | Cron + daemon: race conditions, nonce conflicts, fallback behavior, circuit breaker | ALTO |
| **Sponsored Tx Flow** | Serializacao/deserializacao, fee handling, replay protection | ALTO |

### 16.2 Checklist de Auditoria — Smart Contracts

#### Controle de Acesso
- [ ] Todas as funcoes publicas exigem `contract-caller == GATEWAY`
- [ ] `schedule-gateway`, `schedule-sponsor`, `set-fee-recipient`, `set-paused`, `set-initial-price` exigem `tx-sender == DEPLOYER`
- [ ] `set-initial-price` funciona apenas se `last-known-price == 0` (one-shot)
- [ ] `emergency-withdraw` exige `paused == true` por min 200 blocks, max 50% do saldo por execucao
- [ ] Gateway restringe `resolve-and-distribute` a `tx-sender == SPONSOR`

#### Timelocks e Price Bounds (defense-in-depth)
- [ ] `schedule-gateway` armazena `pending-gateway` e `gateway-activation-block = block-height + 144`
- [ ] `activate-gateway` so funciona apos `block-height >= gateway-activation-block`
- [ ] `schedule-sponsor` segue mesmo padrao com `pending-sponsor` e `sponsor-activation-block`
- [ ] `resolve-and-distribute` valida `|price - last-known-price| <= price-bound-bps` (100 BPS = 1%)
- [ ] `resolve-and-distribute` rejeita se `last-known-price == 0` (forca inicializacao)
- [ ] `last-known-price` e atualizado a cada settlement bem-sucedido
- [ ] `emergency-withdraw` max 50% e registra `last-withdraw-block` (200 blocks entre chamadas)

#### Logica Financeira
- [ ] Payout calculation: `(user_amount / winning_pool) * total_pool - fee` — sem overflow/underflow
- [ ] Fee de 3% aplicada corretamente (BPS = 300)
- [ ] Nenhuma logica de jackpot no contrato (jackpot e 100% off-chain)
- [ ] Fee de 3% flat enviada ao fee-recipient (backend separa 2%+1%)
- [ ] Refund integral sem fee quando nao ha contraparte
- [ ] Refund integral sem fee em caso de TIE (price-start == price-end)
- [ ] Nenhum cenario permite drenar fundos alem do saldo legitimo do usuario
- [ ] `MIN_BET` enforced (1,000,000 = 1 USDCx)

#### Timing e Estado
- [ ] `TRADING_WINDOW` (u50) enforced: bets apos 50s rejeitadas on-chain
- [ ] Round ID derivacao deterministica: `floor(block-timestamp / 60)`
- [ ] Round nao pode ser resolvida duas vezes (`resolved == true` check)
- [ ] Bets acumulam corretamente por lado (UP/DOWN) na mesma round
- [ ] `user-pending-rounds` removido (sem claim publico)

#### Reentrancia e Edge Cases
- [ ] Nenhuma chamada externa antes de atualizar estado (checks-effects-interactions)
- [ ] Token transfer via `contract-call?` com tratamento de erro adequado
- [ ] Round com 0 bets: cron ignora, nenhum estado inconsistente
- [ ] Round com bets em apenas 1 lado: refund sem side effects

### 16.3 Checklist de Auditoria — Backend/API

#### Sponsor Route (`/api/sponsor`)
- [ ] `ALLOWED_CONTRACTS` whitelist (predixv1, gatewayv1, test-usdcx)
- [ ] `ALLOWED_FUNCTIONS` whitelist (sem funcoes de claim/admin)
- [ ] Body size limit (100KB max para txHex)
- [ ] Rate limiting funcional (10 txs/min por wallet)
- [ ] Nonce tracking via Redis sem race conditions
- [ ] Fee estimation com cap (500,000 microSTX)
- [ ] Timeout de 10s em `sponsorTransaction()`

#### Cron/Settlement
- [ ] `resolve-and-distribute` chamado apenas para rounds com bets
- [ ] Nonce lock (SETNX, TTL 20s) previne conflitos entre cron e daemon
- [ ] Retry com backoff (500ms → 1s → 2s) em caso de falha
- [ ] Fallback de nonce on-chain se Redis miss
- [ ] 3 falhas consecutivas geram alerta
- [ ] Circuit breaker com threshold de 0.5%

#### Input Validation
- [ ] `/api/open-price`: price bounds ±1% do ultimo preco Pyth
- [ ] `/api/open-price`: round ID bounds (currentRound ou currentRound+1)
- [ ] `/api/pool-update`: rejeita updates para rounds encerradas
- [ ] Todos os endpoints retornam 503 se Redis offline

### 16.4 Checklist de Auditoria — Frontend

- [ ] Nenhuma chave privada ou mnemonic exposta no client bundle
- [ ] `NEXT_PUBLIC_*` env vars contem apenas dados publicos
- [ ] localStorage prefixado por network (sem dados fantasma cross-network)
- [ ] Nenhum fallback hardcoded para enderecos testnet
- [ ] Wallet connection usa network da env var
- [ ] Security headers configurados (CSP, X-Frame-Options, etc.)

### 16.5 Processo de Auditoria

| Fase | Descricao | Quando | Responsavel |
|------|-----------|--------|-------------|
| **Fase A — Auditoria Interna** | Review manual dos contratos + API. Documentar findings. | Durante operacao testnet | Equipe core |
| **Fase B — Testes Automatizados** | Coverage >= 90% nos contratos. | Durante operacao testnet | Equipe core |
| **Fase C — Auditoria Externa** | Auditor Clarity/Stacks (CoinFabrik, etc.). Recomendado Fase 1, **obrigatorio Fase 2**. | Antes do mainnet | Auditor externo |
| **Fase D — Correcoes** | Fix de findings HIGH/CRITICAL. Retestar. | Pos-auditoria | Equipe core |
| **Fase E — Sign-off** | Relatorio final. Todos HIGH/CRITICAL resolvidos. | Gate para mainnet | Equipe + auditor |

### 16.6 Classificacao de Findings

| Severidade | Definicao | Acao |
|-----------|-----------|------|
| **CRITICAL** | Perda de fundos, bypass de controle de acesso, drain de pool/jackpot | **Bloqueia mainnet.** Fix obrigatorio + retestar. |
| **HIGH** | Logica financeira incorreta, race condition exploravel, DOS do settlement | **Bloqueia mainnet.** Fix obrigatorio. |
| **MEDIUM** | Rate limit bypassavel, input validation incompleta, edge case nao tratado | Fix antes do mainnet ou aceitar com mitigacao documentada. |
| **LOW** | Gas optimization, code clarity, logging insuficiente | Fix opcional. Documentar se aceito. |
| **INFO** | Sugestoes de melhoria, best practices | Backlog. |

---

## 17. Monitoramento Pos-Launch

> Aplica tanto a testnet (agora) quanto mainnet (depois).

### 17.1 Metricas

| Metrica | Como | Alerta se |
|---------|------|-----------|
| Rounds resolvidas | Redis `rounds-with-bets` vs on-chain | Round pendente > 120s |
| Sponsor saldo | `GET /v2/accounts/{sponsor}` | < 10 STX |
| Hiro API quota | Response header `X-RateLimit-Remaining` | < 20% |
| Redis availability | `/api/round` response time | > 3s ou erro |
| Tx success rate | 200 vs erro em `/api/sponsor` | < 90% |
| Nonce conflicts | Retries no sponsor | > 5/hora |
| Cron execution | Timestamp da ultima run no Redis | Gap > 2 min |

### 17.2 Alerting

- `console.error('[ALERT] ...')` em condicoes criticas → Vercel Logs
- `/api/health` endpoint que verifica:
  - Redis connectivity (ping)
  - Hiro API reachability (GET /v2/info, timeout 5s)
  - Sponsor saldo (> 2 STX)
  - Ultima round resolvida (< 3 min atras)
  - Jackpot balance (Redis `jackpot:balance`)
- **Discord webhook** para alertas CRITICAL: sponsor baixo, cron parado, circuit breaker ativado

```typescript
// lib/alerting.ts
const DISCORD_WEBHOOK = process.env.DISCORD_ALERT_WEBHOOK

async function sendAlert(severity: 'INFO' | 'WARN' | 'CRITICAL', message: string) {
  console.error(`[ALERT:${severity}] ${message}`)
  if (DISCORD_WEBHOOK && severity !== 'INFO') {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**[${severity}]** ${message}`,
      }),
    }).catch(() => {}) // nao falhar se Discord estiver down
  }
}
```

### 17.3 Redis Backup e Resiliencia

| Item | Spec |
|------|------|
| **Backup** | Upstash Redis persistence automatica. Daily backup no plano pago (obrigatorio para mainnet). |
| **Rehydration** | Se Redis perder dados, cron reconstroi estado do on-chain automaticamente. |
| **Separacao** | Instance mainnet **separado** do testnet. Nunca compartilhar. |
| **Eviction policy** | `noeviction` — rejeitar writes em vez de evictar keys criticas. |

### 17.4 Hiro API Tier

| Tier | Limite | Suporta |
|------|--------|---------|
| Free | 50 req/min | ~5 usuarios (OK para testnet) |
| Developer | 500 req/min | ~50 usuarios (minimo mainnet) |
| Growth | 2000 req/min | ~200 usuarios |

---

## 18. Incident Response

### 18.1 Bug no Contrato

1. Pausar gateway: `set-paused(true)` → bloqueia novas apostas
2. Cron para de resolver (rounds ficam pendentes)
3. `emergency-withdraw` apos 200 blocks (~33 min) se necessario
4. Deploy novo contrato, migrar env vars
5. Se fundos em transito: resolver rounds pendentes manualmente antes de withdraw

### 18.2 Cron Parou

1. Vercel Cron falha → Railway daemon assume (verifica a cada 65s)
2. Ambos falharam → executar `resolver-daemon.mjs` manualmente
3. Rounds atrasadas: cron escaneia ultimas 5, resolve em sequencia

### 18.3 Sponsor Wallet Esgotou

1. Transferir STX para sponsor wallet
2. Apostas pausam ate refunding
3. Rounds pendentes resolvidas quando saldo restaurado

### 18.4 Hiro API Down

1. Cache de 5s ativo, UI funciona por curto periodo
2. Sponsor/cron param (dependem de Hiro para broadcast)
3. Esperar Hiro voltar

### 18.5 Redis Down

1. `/api/sponsor` e `/api/round` retornam 503
2. On-chain state nao e afetado

### 18.6 Migracao predixv1 → predixv2 (se necessario)

1. Pausar gatewayv1: `set-paused(true)`
2. Cron resolve rounds pendentes
3. `emergency-withdraw` apos 200 blocks → fundos para deployer
4. Deploy novo contrato + gateway
5. Atualizar env vars

---

## 19. Fase 2 — Token Real

> **Pre-requisito:** Mainnet Fase 1 estavel por 2+ semanas + auditoria externa concluida.
> Detalhes completos em documento separado (`docs/phase2-real-token.md`).

| Area | Mudanca Principal | Bloqueante? |
|------|-------------------|-------------|
| **Auditoria externa** | Obrigatoria (nao recomendada — obrigatoria) | SIM |
| **Token** | Substituir test-usdcx por token real (USDCX/sBTC) | SIM |
| **Emergency withdraw** | Multi-sig 2-of-3 (nao apenas deployer) | SIM |
| **Deposit/Withdraw** | Novo flow com cooldown de 1h no withdraw | SIM |
| **Limites** | Max bet 1,000 USDC/round, max exposure 10,000 USDC/wallet | SIM |
| **Insurance fund** | 5% das fees reservadas para cobrir bugs/exploits | SIM |
| **KYC** | Avaliar necessidade regulatoria | Depende da jurisdicao |
| **Hiro API fallback** | Node Stacks proprio como backup | Recomendado |
| **Pyth on-chain proof** | Validacao on-chain via Pyth (quando disponivel no Stacks) | Recomendado |

---

## 20. Comunicacao e Status

### 20.1 Canais de Comunicacao

| Canal | Proposito | Quando |
|-------|-----------|--------|
| **Twitter/X** | Anuncio de launch, atualizacoes | Launch, milestones |
| **Discord** | Comunidade, suporte, alertas | Continuo |
| **Banner no app** | Status operacional | Incidentes |

### 20.2 Status Page

Implementar `/status` no frontend ou servico externo (Instatus, Betteruptime):

| Componente | Check | Frequencia |
|------------|-------|-----------|
| Settlement Engine | Ultima round resolvida < 3 min | 1 min |
| Sponsor Wallet | Saldo > 2 STX | 5 min |
| Hiro API | Reachable + < 500ms | 1 min |
| Redis | Ping < 100ms | 1 min |
| Frontend | HTTP 200 | 1 min |

### 20.3 Plano de Comunicacao em Incidentes

| Severidade | Acao | Tempo |
|-----------|------|-------|
| **Degradacao** | Banner: "Operacao lenta, estamos investigando" | < 5 min |
| **Parcial** | Banner + Discord: "Settlement pausado. Fundos seguros." | < 10 min |
| **Total** | Banner + Discord + Twitter: "Operacao pausada. Fundos seguros on-chain." | < 15 min |
| **Resolucao** | Atualizar todos os canais | Imediato |

**Regra:** Nunca deixar usuarios no escuro.

---

## 21. Checklist Final

### Testnet (agora)

#### Contratos
- [ ] `predixv1.clar` completo (gateway-only, price bounds 1%, timelocks, `set-initial-price`, emergency withdraw parcial 50%)
- [ ] `predixv1.clar` sem logica de jackpot (100% off-chain)
- [ ] `predixv1.clar` — `place-bet` sem parametro `early`
- [ ] `gatewayv1.clar` completo
- [ ] ASCII scan: 0 non-ASCII bytes
- [ ] Deploy em testnet com wallets dedicadas
- [ ] `set-initial-price` + `set-sponsor` + `set-fee-recipient` chamados

#### Code (todos os arquivos da secao 14.5)
- [ ] `lib/config.ts`, `lib/hiro.ts`, `lib/alerting.ts`, `lib/sponsored-tx.ts`
- [ ] `lib/positions.ts` (prefixo network + TTL 7 dias)
- [ ] `lib/jackpot.ts` (bilhetes, multiplicadores, acumulo)
- [ ] API routes: sponsor, cron/resolve, cron/jackpot-draw, jackpot/status, jackpot/history, round, open-price, pool-update, health, allowance-status, mint-status
- [ ] Frontend: MarketCardV4, JackpotBanner, TicketIndicator, DrawHistory, ClaimButton→status, ConnectWalletButton
- [ ] `scripts/resolver-daemon.mjs`
- [ ] `next.config.js` (security headers)
- [ ] `npm run build` — zero erros

#### Testes
- [ ] Smoke tests (14.1) passando
- [ ] Security tests (14.2) passando
- [ ] Edge cases (14.3) passando
- [ ] Jackpot tests (14.4) passando
- [ ] Stress test (9.7) passando
- [ ] Bootstrap, timelocks, price bounds, emergency withdraw verificados (13.6)
- [ ] Operacao estavel por 1+ semana

#### Infra
- [ ] Vercel com crons ativos
- [ ] Redis instance testnet
- [ ] Resolver-daemon rodando
- [ ] Discord alerting funcional

---

### Mainnet (posterior)

> **Gate:** Tudo acima marcado + auditoria interna completa + testnet estavel 2+ semanas.

#### Pre-flight
- [ ] Auditoria interna completa (secao 16.2-16.4)
- [ ] Zero findings CRITICAL/HIGH abertos
- [ ] Relatorio em `docs/audit/`

#### Deploy
- [ ] Wallets mainnet geradas e fundadas (deployer ~5 STX, sponsor ~100 STX, fee-collector)
- [ ] Contratos deployados em mainnet (mesmo `.clar` do testnet)
- [ ] `set-initial-price` + `set-sponsor` + `set-fee-recipient` chamados
- [ ] Redis instance mainnet dedicado (100MB+, `noeviction`, daily backup)
- [ ] Env vars atualizados no Vercel e Railway/Render
- [ ] Hiro API tier Developer+

#### Validacao
- [ ] Smoke tests em mainnet
- [ ] Security tests em mainnet
- [ ] Operacao restrita equipe-only (15.7) — 30+ rounds sem erro
- [ ] Sponsor saldo estavel
- [ ] Health check respondendo OK
- [ ] Discord alerting funcional
- [ ] Launch publico comunicado
