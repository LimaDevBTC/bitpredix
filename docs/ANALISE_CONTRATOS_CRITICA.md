# Análise Crítica: Falhas Lógicas nos Contratos para Rounds Sequenciais

**Data:** 2026-01-23  
**Objetivo:** Identificar e corrigir todas as falhas que impedem rounds sequenciais e infalíveis a cada minuto on-chain.

---

## 🔴 PROBLEMAS CRÍTICOS IDENTIFICADOS

### 1. **FALHA LÓGICA: `resolve-round` tenta transferir fees quando pool está vazio**

**Localização:** `bitpredix.clar` linhas 113-115

```clarity
(if (> fee-dev u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_DEV fee-dev none)) true)
(if (> fee-consultant u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_CONSULTANT fee-consultant none)) true)
(if (> fee-po u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_PO fee-po none)) true)
```

**Problema:**
- Quando **ninguém aposta** numa rodada (pool-up = 0, pool-down = 0), as fees são 0
- MAS o `transfer-from` **pode falhar** se o saldo de SELF for 0 (ex.: última rodada zerou o saldo)
- Mesmo com `(> fee-dev u0)` o `try!` ainda PODE abortar a tx se houver erro no transfer-from
- **RESULTADO**: `resolve-round` FALHA → round fica TRADING forever → `create-round` do minuto seguinte é CRIADO mas o anterior nunca resolve → sistema quebra

**Impacto:** 🔴 **CRÍTICO** — Um round sem apostas bloqueia toda a sequência

**Solução:**
```clarity
;; Remover try! e usar catch (ok true) para não abortar:
(if (> fee-dev u0)
  (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_DEV fee-dev none)
    ok-val true
    err-val true)  ;; ignora erro e continua
  true)
```

OU melhor ainda: **só processar fees se pool-sum > 0**:

```clarity
(if (> pool-sum u0)
  (begin
    (if (> fee-dev u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_DEV fee-dev none)) true)
    (if (> fee-consultant u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_CONSULTANT fee-consultant none)) true)
    (if (> fee-po u0) (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_PO fee-po none)) true))
  true)
```

---

### 2. **FALHA LÓGICA: `resolve-round` precisa de `get-price` do oracle — mas `set-price` pode NÃO ter confirmado**

**Localização:** `bitpredix.clar` linha 105

```clarity
(let ((price-at-end (unwrap! (contract-call? .oracle get-price round-id) (err u1003)))
```

**Problema:**
- O cron faz: `set-price` → sleep 60s → `resolve-round`
- **MAS** se `set-price` não confirmar em 60s (testnet lenta), quando `resolve-round` executa, `get-price` retorna `none`
- `unwrap!` com `none` → `(err u1003)` → `resolve-round` **FALHA**
- Round fica **TRADING** forever

**Impacto:** 🔴 **CRÍTICO** — Rounds param de resolver em testnet lenta

**Solução:**

**Opção A (recomendada):** Aguardar confirmação de `set-price` no cron antes de enviar `resolve-round`

**Opção B:** Tornar `resolve-round` **tolerante** — se não houver preço, usar o mesmo `price-at-start`:
```clarity
(let ((maybe-price (contract-call? .oracle get-price round-id)))
  (let ((price-at-end (match maybe-price
                        some-val some-val
                        (get price-at-start r))))  ;; fallback: preço abertura
```

**Opção C (MELHOR — design robusto):** Guardar o preço diretamente no `create-round`/`resolve-round` via parâmetro (já obtido no backend), **sem depender do oracle**:

```clarity
(define-public (resolve-round (round-id uint) (price-at-end uint))
  ;; Recebe o preço como argumento; não chama oracle
```

Assim o backend (cron) obtém o preço UMA vez e passa para ambas as chamadas.

---

### 3. **FALHA LÓGICA: `oracle.set-price` rejeita overwrite — retry/reenvio falha**

**Localização:** `oracle.clar` linha 13

```clarity
(asserts! (is-none existing) (err u1)) ;; sem overwrite
```

**Problema:**
- Se o cron reenvia `set-price(1234, price)` (ex.: timeout, retry), a 2ª chamada **falha** com `(err u1)`
- O cron trata isso como erro e pode parar
- **Pior:** se o daemon reenviar `set-price` do MESMO round-id mas com preço DIFERENTE (ex.: flutuação), o preço fica "congelado" no 1º valor

**Impacto:** 🟡 **MÉDIO** — Impede retries; pode causar paragem do daemon

**Solução:** Tornar `set-price` **idempotente** (aceita duplicate com mesmo preço; rejeita se preço diferente):

```clarity
(define-public (set-price (round-id uint) (price uint))
  (let ((existing (map-get? prices { round-id: round-id })))
    (match existing
      old-price (if (is-eq old-price price)
                  (ok true)  ;; idempotente: mesmo preço, ok
                  (err u1))  ;; preço diferente, rejeita
      (begin
        (asserts! (is-eq tx-sender ORACLE) (err u2))
        (map-set prices { round-id: round-id } price)
        (ok true)))))
```

---

### 4. **FALHA DE DESIGN: `trading-closes-at` é FIXO (12s antes do fim) — inconsistente com versão em memória**

**Localização:** `bitpredix.clar` linha 48

```clarity
(trading-closes-at (- (+ round-id u60) u12)))
```

**Versão em memória:** `lib/rounds.ts` linhas 20-23

```typescript
function randomTradingCloseSeconds(): number {
  return 10 + Math.floor(Math.random() * 5)  // 10-14s
}
```

**Problema:**
- Contrato: **sempre 12s** antes do fim
- Memória: **aleatório 10-14s**
- **INCONSISTÊNCIA**: comportamento diferente on-chain vs off-chain

**Impacto:** 🟡 **MÉDIO** — Experiência de usuário diferente; apostas podem ser rejeitadas em timings diferentes

**Solução:** Uniformizar — escolher UMA abordagem:

**Opção A:** Fixo 12s em ambos (mais simples, previsível)
**Opção B:** Passar `trading-closes-at` como parâmetro no `create-round`:

```clarity
(define-public (create-round (round-id uint) (price-at-start uint) (trading-closes-at uint))
```

Backend calcula o valor aleatório e passa.

---

### 5. **FALHA DE ARQUITETURA: Backend não espera confirmações → mempool sobrecarga**

**Localização:** `cron-oracle.mjs`

**Problema atual:**
- Envia `set-price` (nonce N)
- Sleep 60s
- Envia `resolve-round` (nonce N+1) — **SEM esperar set-price confirmar**
- Envia `create-round` (nonce N+2) — **SEM esperar resolve-round confirmar**
- Resultado: **3 tx pendentes** na testnet
- Testnet pode processar devagar ou DESCARTAR txs se mempool encher

**Impacto:** 🔴 **CRÍTICO** — Rounds não são criados; txs ficam pendentes ou abortadas

**Solução (JÁ INICIADA mas INCOMPLETA):**
Esperar confirmações:
1. `set-price` → **aguardar confirm** (120s)
2. `resolve-round` → **aguardar confirm** (180s)
3. `create-round` → **aguardar confirm** (240s)

Mas: se **TODO O CICLO** levar > 60s, o próximo tick sobrepõe!

**SOLUÇÃO DEFINITIVA:** 
- Aumentar intervalo do daemon para **90s** (1.5 min) OU
- Usar **fila com lock**: se um ciclo ainda não terminou, o próximo tick aguarda

---

### 6. **FALHA DE PRODUTO: `place-bet` usa `block-time` — pode estar FORA de sinc com `round-id`**

**Localização:** `bitpredix.clar` linha 69

```clarity
(block-time (unwrap! (get-block-info? time block-height) (err u1099))))
```

**Problema:**
- `round-id` = timestamp unix (ex.: 1769702220)
- `trading-closes-at` = `round-id + 60 - 12` = timestamp unix (ex.: 1769702268)
- `block-time` = timestamp do **bloco atual** (pode estar 10-30s atrasado em relação ao relógio real)
- **RESULTADO**: User tenta apostar aos :50s (real), mas block-time ainda está aos :40s → aposta aceite quando JÁ devia estar fechada

**Impacto:** 🟡 **MÉDIO** — Apostas podem entrar após o "deadline" visual do frontend

**Solução:**

**Opção A:** Usar `block-height` em vez de timestamp:
- `round-id` = block-height do início
- `trading-closes-at` = round-id + 10 blocos (10 min testnet ~= 1 min?)
- **Problema:** testnet tem blocos irregulares

**Opção B (MELHOR):** Aceitar a dessincronização e DOCUMENTAR:
- Frontend avisa: "Trading fecha em X segundos (pode variar devido a blocos)"
- Contrato usa `block-time` (mais justo — todos veem o mesmo)

**Opção C:** Não usar `block-time` — aceitar qualquer aposta até `resolve-round` ser chamada (status muda para RESOLVED). Mais simples e robusto.

---

### 7. **FALHA CRÍTICA: `create-round` é idempotente MAS `resolve-round` NÃO É**

**Localização:** `bitpredix.clar` linhas 42-44 (create-round OK) vs 104 (resolve-round rejeita)

```clarity
;; create-round: idempotente ✅
(if (is-some existing)
  (ok true)

;; resolve-round: NÃO idempotente ❌
(asserts! (is-eq (get status r) "TRADING") (err u1002))
```

**Problema:**
- Se o cron reenvia `resolve-round` (retry), a 2ª chamada **FALHA** com `(err u1002)` (status já é RESOLVED)
- Isso pode parar o daemon ou causar logs de erro confusos

**Impacto:** 🟡 **MÉDIO** — Impede retries seguros de resolve-round

**Solução:** Tornar `resolve-round` idempotente:

```clarity
(define-public (resolve-round (round-id uint) (price-at-end uint))
  (begin
    (asserts! (is-eq tx-sender ORACLE) (err u401))
    (let ((r (unwrap! (map-get? rounds { round-id: round-id }) (err u1001))))
      (if (is-eq (get status r) "RESOLVED")
        (ok true)  ;; já resolvido, idempotente
        (begin
          ;; lógica de resolve
          ...
          (ok true))))))
```

---

## 📊 RESUMO DE PRIORIDADES

| Prioridade | Problema | Impacto | Esforço | Solução |
|------------|----------|---------|---------|---------|
| 🔴 P0 | `resolve-round` falha com pool vazio (fees) | Bloqueia sequência | Baixo | Wrap transfer-from com match ou guard pool-sum > 0 |
| 🔴 P0 | `resolve-round` depende de `get-price` não confirmado | Rounds não resolvem | Médio | Passar preço como param OU aguardar set-price no cron |
| 🔴 P0 | Backend não aguarda confirmações | Txs não mineradas | Baixo | Adicionar waitForTx em TODAS as 3 chamadas |
| 🟡 P1 | `set-price` não é idempotente | Impede retries | Baixo | Aceitar duplicate com mesmo preço |
| 🟡 P1 | `resolve-round` não é idempotente | Impede retries | Baixo | Retornar (ok true) se já RESOLVED |
| 🟡 P2 | `trading-closes-at` inconsistente | UX diferente | Baixo | Fixar em 12s (contrato) ou passar como param |
| 🟡 P2 | `place-bet` usa block-time (dessincronizado) | Apostas após deadline | — | Documentar comportamento |

---

## ✅ PLANO DE CORREÇÃO

### Fase 1: Correções Críticas (P0) — **OBRIGATÓRIAS para rounds sequenciais**

1. **Corrigir `resolve-round` fees:**
   - Envolver transfer-from em `match` para não abortar em erro
   - OU adicionar guard `(> pool-sum u0)` antes dos transfers

2. **Eliminar dependência de `oracle.get-price` em `resolve-round`:**
   - **OPÇÃO RECOMENDADA:** Alterar assinatura:
     ```clarity
     (define-public (resolve-round (round-id uint) (price-at-end uint))
     ```
   - Backend passa o preço (já obtido) como argumento
   - Remove chamada a `contract-call? .oracle get-price`

3. **Aguardar confirmações no cron:**
   - `set-price` → **waitForTx** 120s
   - `resolve-round` → **waitForTx** 180s
   - `create-round` → **waitForTx** 240s
   - **Total:** ~540s (9 min) por ciclo → AJUSTAR intervalo do daemon para **10 min** OU usar **fila com lock**

### Fase 2: Robustez (P1) — **Recomendadas para produção**

4. **Tornar `set-price` idempotente** (aceita duplicate)
5. **Tornar `resolve-round` idempotente** (retorna ok se já RESOLVED)

### Fase 3: Consistência (P2) — **Nice to have**

6. **Uniformizar `trading-closes-at`** (fixo 12s em contrato E memória)
7. **Documentar comportamento de `block-time`** em `place-bet`

---

## 🚀 IMPLEMENTAÇÃO PROPOSTA

### Contrato `bitpredix.clar` (novo):

```clarity
;; resolve-round: recebe preço como argumento (não chama oracle)
(define-public (resolve-round (round-id uint) (price-at-end uint))
  (begin
    (asserts! (is-eq tx-sender ORACLE) (err u401))
    (let ((r (unwrap! (map-get? rounds { round-id: round-id }) (err u1001))))
      ;; Idempotência: se já RESOLVED, retorna ok
      (if (is-eq (get status r) "RESOLVED")
        (ok true)
        (let ((pool-sum (+ (get pool-up r) (get pool-down r)))
              (price-at-start (get price-at-start r))
              (outcome (if (> price-at-end price-at-start) "UP" "DOWN")))
          ;; Só processa fees se houver pool
          (if (> pool-sum u0)
            (let ((fee-total (/ (* pool-sum FEE_BPS) u10000))
                  (fee-dev (/ (* fee-total u10) u100))
                  (fee-consultant (/ (* fee-total u10) u100))
                  (fee-po (- fee-total (+ fee-dev fee-consultant))))
              ;; Match para não abortar em erro
              (if (> fee-dev u0)
                (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_DEV fee-dev none)
                  ok-val true
                  err-val true)
                true)
              (if (> fee-consultant u0)
                (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_CONSULTANT fee-consultant none)
                  ok-val true
                  err-val true)
                true)
              (if (> fee-po u0)
                (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_PO fee-po none)
                  ok-val true
                  err-val true)
                true))
            true)
          (map-set rounds { round-id: round-id }
            (merge r {
              status: "RESOLVED",
              price-at-end: price-at-end,
              outcome: outcome
            }))
          (ok true))))))
```

### Contrato `oracle.clar` (novo):

```clarity
(define-public (set-price (round-id uint) (price uint))
  (let ((existing (map-get? prices { round-id: round-id })))
    (match existing
      old-price (if (is-eq old-price price)
                  (ok true)  ;; idempotente
                  (err u1))  ;; preço diferente
      (begin
        (asserts! (is-eq tx-sender ORACLE) (err u2))
        (map-set prices { round-id: round-id } price)
        (ok true)))))
```

### Cron `cron-oracle.mjs` (novo fluxo):

```javascript
// 1) set-price
const rSet = await broadcastTransaction(txSet)
if (rSet.txid) {
  await waitForTx(rSet.txid, 'set-price', 120_000)  // AGUARDA confirmação
}

await sleep(10_000)  // 10s extra para propagação

// 2) resolve-round (PASSA O PREÇO como argumento)
const txRes = await makeContractCall({
  functionName: 'resolve-round',
  functionArgs: [Cl.uint(roundIdEnd), Cl.uint(price6)],  // ← preço como param
  ...
})
const rRes = await broadcastTransaction(txRes)
if (rRes.txid) {
  await waitForTx(rRes.txid, 'resolve-round', 180_000)  // AGUARDA confirmação
}

// 3) create-round
const txCreate = await makeContractCall({ ... })
const rCreate = await broadcastTransaction(txCreate)
if (rCreate.txid) {
  await waitForTx(rCreate.txid, 'create-round', 240_000)
}
```

**Total por ciclo:** ~120s (set-price) + 10s + 180s (resolve) + 240s (create) = **~550s (9 min)**

**SOLUÇÃO:** Daemon com intervalo de **10 minutos** (600s) OU usar **múltiplos rounds por chamada** (criar N+0, N+1, N+2... se estiverem em falta).

---

## 🎯 PRÓXIMOS PASSOS

1. **VALIDAR** esta análise com equipa
2. **PRIORIZAR** P0 (críticos) para implementação imediata
3. **REDESENHAR** contrato `bitpredix.clar` (resolve-round recebe preço)
4. **REDESENHAR** contrato `oracle.clar` (set-price idempotente)
5. **AJUSTAR** cron para aguardar TODAS as confirmações
6. **TESTAR** em testnet com rounds sequenciais (5+ rounds sem falhas)
7. **REDEPLOY** contratos em testnet
8. **EXECUTAR** daemon e validar 100% de sucesso em 10+ rounds

---

**Conclusão:** Os contratos atuais TÊM falhas lógicas que impedem rounds sequenciais infalíveis. As correções P0 são **OBRIGATÓRIAS** e relativamente simples de implementar. Com estas mudanças, o sistema on-chain será tão robusto quanto a versão em memória.
