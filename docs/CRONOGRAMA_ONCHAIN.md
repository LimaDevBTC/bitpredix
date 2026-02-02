# Cronograma — Jogo on-chain

Documento para rever o que falta para o **jogo rodar de facto on-chain**: apostas com test USDC, botões só ativos com carteira ligada, dados das rodadas e posições vindos da blockchain.

---

## 1. O que já está feito

| Item | Estado |
|------|--------|
| **C1** Connect wallet | ✅ Header: Connect / Disconnect, testnet |
| **C2** Mint test USDC | ✅ Botão "mint test usdc", `get-minted` + `mint()`; script `npm run mint-test` |
| **Contratos** | ✅ test-usdcx, oracle, bitpredix deployados em testnet |
| **B4** Deploy | ✅ CONTRACT_IDs em `.env.local` |
| **MarketCard (simulado)** | ✅ UP/DOWN, amount, countdown, POST /api/round → `lib/rounds` (em memória) |

---

## 2. O que falta para o jogo ser on-chain

### 2.1 Visão geral

Hoje: o MarketCard usa **`/api/round`** (GET = `lib/rounds` em memória, POST = `executeTrade` em memória). O dinheiro é simulado.

Para on-chain:

1. **Rodadas** vêm do contrato **bitpredix** (map `rounds`), criadas pelo **oráculo/cron**.
2. **Apostas** = `approve` (test-usdcx) + `place-bet` (bitpredix), assinadas pela carteira do user.
3. **Dinheiro** = **test-usdcx** (tokens de teste). O user precisa de ter feito mint (e de ter saldo).
4. **Botões** UP/DOWN e input: só **clicáveis/úteis com carteira conectada** (e, se quisermos, com saldo > 0).

### 2.2 Dependência crítica: oráculo (cron)

As rodadas on-chain são criadas **só** pelo oráculo:

- **`create-round(round-id, price-at-start)`** no início de cada minuto
- **`set-price(round-id, price)`** no oracle + **`resolve-round(round-id)`** no bitpredix no fim do minuto

**Sem D1+D2 (cron + ORACLE_MNEMONIC), não há rodadas no contrato** — a app pode estar pronta para `place-bet`, mas não há round onde apostar. Para o jogo “rodar” on-chain é preciso **ter o cron a correr** (local, VPS, ou serviço agendado).

---

## 3. Tarefas por bloco

### Bloco D — Oráculo (pré-requisito para haver rounds on-chain)

| # | Tarefa | O quê |
|---|--------|-------|
| **D1** | Cron a cada :00 | 1) Preço (Bitstamp ou similar) → `oracle.set-price(round-id, price)`; 2) `bitpredix.resolve-round(round-id)` (minuto que acaba); 3) `bitpredix.create-round(round-id novo, price-at-start)` (minuto novo) |
| **D2** | Config ORACLE | `ORACLE_MNEMONIC` ou `ORACLE_PRIVATE_KEY` no ambiente do script/cron (em testnet = chave do deployer) |

Pode ser um script Node que corre a cada minuto (cron do OS ou `setInterval` em processo longo). Sem D1+D2, a app on-chain mostra “À espera da próxima rodada” e não há round no contrato.

---

### Bloco C3 — place-bet no app (jogo on-chain)

| # | Tarefa | O quê |
|---|--------|-------|
| **C3a** | **Wallet gate** | Botões UP/DOWN e área do amount só ativos (ou mostram “Connect wallet to trade”) quando há `stx` em `getLocalStorage`. Desativar/ocultar quando não conectado. |
| **C3b** | **`/api/round` GET on-chain** | Quando `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` está definido: em vez de `getOrCreateCurrentRound` (memória), ler o round do contrato: `round-id = Math.floor(Date.now()/1000/60)*60` (início do minuto em Unix s). Usar Hiro `map_entry` para o map `rounds` com chave `{ round-id: roundId }`. Mapear `pool-up`/`pool-down` → `pool: { qUp, qDown }`, e derivar `priceUp`/`priceDown` (ex.: `priceUp = poolDown/(poolUp+poolDown)` para o modelo 1:1). Se não existir round → `round: null`, `priceUp`/`priceDown` 0.5 ou “waiting”. Manter fallback para memória quando BITPREDIX_CONTRACT_ID não está definido (modo simulado). |
| **C3c** | **`buy()` → approve + place-bet** | Em vez de `POST /api/round`: 1) `openContractCall` **test-usdcx** `approve(spender, amount)` com `spender` = principal do bitpredix (ex. `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID`) e `amount` em unidades de 6 decimais (`amountUsd * 1e6`). 2) No `onFinish` do approve, `openContractCall` **bitpredix** `place-bet(round-id, side, amount)` com `round-id` = `Math.floor(round.startAt/1000)`, `side` = `"UP"` ou `"DOWN"`, `amount` = mesmo valor em 6 decimais. Tratar `onCancel` e erros. |
| **C3d** | **Montantes e mínimo** | UI em USD; contrato em 6 decimais: `amountUint = Math.round(amountUsd * 1e6)`. `MIN_BET` no bitpredix = `1_000_000` (= 1 USD). Ajustar `MIN_AMOUNT_USD` no MarketCard para **1** (ou superior) para evitar rejeição no contrato. |
| **C3e** | **Posições on-chain (opcional, fase 2)** | “Your shares” a partir do map `positions` do bitpredix: chave `{ round-id, user, side }` para `"UP"` e `"DOWN"`. 2× `map_entry` ou, se se adicionar, um read-only `get-position(round-id, user)` no contrato. Pode ficar para depois da primeira versão que só faz approve+place-bet. |

Notas:

- **round-id** on-chain = `uint` = início do minuto em **segundos** Unix. No MarketCard, `round.startAt` está em ms → `roundIdUint = Math.floor(round.startAt/1000)`.
- **approve** e **place-bet** são 2 transações (2 assinaturas na carteira). Para MVP é aceitável; mais à frente pode-se ver `allowance` e só aprovar quando necessário.
- Se **bitpredix** não tiver read-only `get-round`, usar **Hiro `map_entry`** para o map `rounds` com chave `{ round-id: Cl.uint(roundId) }`.

---

### Bloco C4 — claim-winnings

| # | Tarefa | O quê |
|---|--------|-------|
| **C4** | **claim-winnings** | Após a rodada estar `RESOLVED`, botão ou acção no modal de resolução: `openContractCall` **bitpredix** `claim-winnings(round-id)`. `round-id` = `Math.floor(round.startAt/1000)`. Mostrar feedback de sucesso/erro. |

---

## 4. Ordem sugerida (cronograma)

```
D1 + D2 (cron oráculo)     ←  Sem isto não há rounds on-chain
        │
        ▼
C3a (wallet gate)          ←  Rápido, desbloqueia a UX
C3b (GET /api/round on-chain)
        │
        ├──► C3c (approve + place-bet)   ←  Aqui o jogo passa a ser on-chain
        ├──► C3d (montantes / MIN 1 USD)
        │
        └──► C3e (posições on-chain)     ←  Opcional; pode ser depois
                    │
                    ▼
              C4 (claim-winnings)
```

- **Fase 1 (mínimo para “jogo on-chain”)**: D1, D2, C3a, C3b, C3c, C3d.  
  Com o cron a correr, rounds passam a existir no contrato; a app lê round on-chain, exige carteira para apostar e usa `approve` + `place-bet` com test USDC.

- **Fase 2**: C3e (posições from chain), C4 (claim).

- **Paralelismo**: D1+D2 pode ser desenvolvido em paralelo com C3a–C3d. Para *testar* o fluxo completo, o cron tem de estar a correr.

---

## 5. Checklist rápida “o que falta”

- [ ] **D1** — Script/cron :00: set-price → resolve-round → create-round (e D2: ORACLE_MNEMONIC)
- [ ] **C3a** — Botões UP/DOWN e amount desativados ou “Connect wallet to trade” quando sem carteira
- [ ] **C3b** — GET /api/round a ler `rounds` do bitpredix (map_entry) quando BITPREDIX_CONTRACT_ID está definido
- [ ] **C3c** — `buy()` → approve(test-usdcx, bitpredix, amount) + place-bet(bitpredix, round-id, side, amount)
- [ ] **C3d** — MIN 1 USD na UI; converter USD → 6 decimais
- [ ] **C3e** — (opcional) “Your shares” a partir do map `positions`
- [ ] **C4** — claim-winnings(round-id) no modal de resolução

---

## 6. Variáveis de ambiente

Para o frontend on-chain:

- `NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID` — já usado no mint
- `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` — para approve(spender) e place-bet / claim-winnings

Para o cron (D1, D2):

- `ORACLE_MNEMONIC` ou `ORACLE_PRIVATE_KEY`
- Contract IDs do oracle e bitpredix (para as chamadas do oráculo)

---

## 7. Contrato bitpredix — nota

Em `place-bet` aparece `(get-block-info? time block-height)`. Em Clarity o habitual é `(get-block-info? 'time)` (key como quoted symbol). Se ao testar `place-bet` der erro u1099, pode ser preciso corrigir para a assinatura correta de `get-block-info?` na versão de Clarity em uso.

---

## 8. Resumo para rever o cronograma

| Próximo passo | Tarefas | Depende de |
|---------------|---------|------------|
| **Oráculo a correr** | D1, D2 | B4 (deploy), chave ORACLE |
| **Jogo on-chain (apostas)** | C3a, C3b, C3c, C3d | D1+D2 (para haver rounds), CONTRACT_IDs |
| **Posições + claim** | C3e, C4 | C3c a funcionar |

Sim: o **próximo passo lógico** para o jogo usar as funcionalidades que já tens (carteira, mint, contratos) é **C3 (place-bet on-chain)** e, para haver rounds onde apostar, **D1+D2 (cron)**. D1+D2 e C3 podem ser feitos em paralelo; para ver o jogo a correr de ponta a ponta on-chain, o cron tem de estar ativo.
