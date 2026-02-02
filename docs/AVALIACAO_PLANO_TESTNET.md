# Avaliação do plano testnet — falhas e discrepâncias

Documento de análise do `PLANO_TESTNET_STACKS.md` e documentos relacionados.  
Data: 2025-01-23.

---

## 1. Discrepâncias entre documentos

### 1.1 FUNDS_ARCHITECTURE vs PLANO

| Aspecto | FUNDS_ARCHITECTURE | PLANO_TESTNET |
|---------|--------------------|---------------|
| Nome da função de aposta | `buy-shares` | `place-bet` |
| `resolve-round` | `(round-id, outcome)` — outcome por parâmetro | `(round-id)` — lê preço do oráculo, calcula outcome |
| Settlement aos vencedores | `distribute-payouts` dentro de `resolve-round` (automático) | `claim-winnings(round-id)` por usuário (não no resolve) |
| Taxa | `PLATFORM_ADDRESS` único | 10% / 10% / 80% para DEV, CONSULTANT, PO |
| Exemplo “$300 → PLATFORM_ADDRESS” | Ainda presente no “Exemplo Completo” | Deveria refletir 10/10/80 |

**Ação:** Atualizar `FUNDS_ARCHITECTURE` (exemplos, `resolve-round`, `distribute-payouts`, Exemplo Completo) para: `place-bet`, `resolve-round(round-id)` lendo oráculo, fees 10/10/80, e `claim-winnings` em vez de distribuição automática no resolve.

---

### 1.2 Estrutura de `positions`

| Documento | Chave | Campos |
|-----------|-------|--------|
| FUNDS_ARCHITECTURE | `{user, round}` | `shares-up`, `shares-down`, `cost` |
| PLANO / bitpredix.clar | `(round-id, user, side)` | `shares`, `cost`, `settled` |

São modelos diferentes: um registro por (round, user) com `shares-up`/`shares-down` vs um registro por (round, user, side) com `shares` e `settled`.

**Impacto:** O plano e o contrato seguem `(round-id, user, side)`. O `claim-winnings` usa apenas a posição no lado vencedor `(round-id, tx-sender, outcome)`. É coerente. O FUNDS está desatualizado.

**Ação:** Alinhar FUNDS (e TOKEN_ARCHITECTURE, se necessário) à estrutura `(round-id, user, side)` e à existência de `settled`.

---

### 1.3 TOKEN_ARCHITECTURE vs PLANO

- TOKEN usa `redeem-shares(round-id, user)`; PLANO usa `claim-winnings(round-id)` com `user = tx-sender`.
- TOKEN: `resolve-round(round-id, price-at-end, outcome)`; PLANO: `resolve-round(round-id)` lendo oráculo.

**Ação:** Considerar nota no TOKEN_ARCHITECTURE referenciando o PLANO para: `claim-winnings`, `resolve-round(round-id)` e oráculo.

---

## 2. Falhas e lacunas no plano

### 2.1 test-usdcx: contrato precisar **enviar** do próprio saldo

No `place-bet`, o bitpredix **recebe** tokens com `transfer-from(user, bitpredix, amount)`. Em `resolve-round` e `claim-winnings`, o bitpredix precisa **enviar** do seu saldo para terceiros.

- O SIP-010 base tem `transfer(amount, sender, recipient, memo)` com `sender = tx-sender`. O contrato não é `tx-sender`; quem assina é o ORACLE.
- Com `transfer-from(from, to, amount)`, a regra típica é `allowance(from, contract-caller) >= amount`. O `contract-caller` seria o bitpredix, `from` o bitpredix. Seria necessário `allowance(bitpredix, bitpredix)`, o que um contrato não consegue gerar de forma normal chamando `approve`.

**Solução:** No test-usdcx, em `transfer-from`, tratar o caso **`from = contract-caller`**: se o `contract-caller` (bitpredix) está movendo seu próprio saldo, permitir a transferência **sem** verificação de allowance (apenas checando saldo).

**Correção aplicada:** Regra no test-usdcx e uso de `transfer-from` (em vez de `ft-transfer?`) no bitpredix foram incluídos no plano. Ação original: incluir no esboço do test-usdcx, algo como: *“Se `from = contract-caller`, permitir transferência desde que `balance(from) >= amount`, sem allowance (para o bitpredix enviar do escrow).”*

---

### 2.2 Assinatura e ordem de args de `transfer-from`

- Esboço test-usdcx (3.2): `transfer-from(from, to, amount)`.
- place-bet (3.3): `transfer-from amount-uint tx-sender (as-contract tx-sender) none` → na prática `(amount, from, to, memo)`.

Ordem e presença de `memo` não batem.

**Ação:** Definir uma assinatura e usar em todo o plano e no contrato, por exemplo:
- `(transfer-from (from principal) (to principal) (amount uint) (memo (optional (buff 34))))`
- Chamada: `(contract-call? .TOKEN transfer-from tx-sender (as-contract tx-sender) amount-uint none)`.

---

### 2.3 `create-round`: origem de `ends-at` e `trading-closes-at`

`create-round` no plano só recebe `(round-id uint) (price-at-start uint)`.

- `rounds` tem `ends-at` e `trading-closes-at`.
- O texto diz `trading-closes-at = ends-at - 12s`, mas não de onde vem `ends-at`.

Em `lib/rounds.ts`: `endsAt = startAt + 60_000` (60 s). Se `round-id` for o Unix de início em segundos, por exemplo `ends-at = round-id + 60` (em segundos no contrato).

**Ação:** No plano, definir de forma explícita, por exemplo:  
*“`ends-at` = `round-id + 60` (se `round-id` for o timestamp de início em segundos) ou `(block-height) + N`; `trading-closes-at` = `ends-at - 12` (ou parâmetro).”*

---

### 2.4 `create-round`: idempotência e `round-id` duplicado

Se o backend reenvia `create-round` com o mesmo `round-id` (retry, bug), um segundo `map-set` pode sobrescrever a rodada.

**Ação:** Exigir que `create-round` verifique se `round-id` já existe; se existir, retornar `(err u?)` ou `(ok true)` sem alterar estado (idempotente), e documentar essa regra no plano.

---

### 2.5 Empate: `price-at-end == price-at-start`

O plano: `outcome = (if (> price-at-end price-at-start) "UP" "DOWN")`. Em igualdade, fica `"DOWN"`.

Em `lib/rounds.ts` (linha 88): `round.outcome = priceAtEnd > round.priceAtStart ? 'UP' : 'DOWN'` — mesmo critério.

**Ação:** Deixar explícito no plano: *“Em caso de empate (`price-at-end = price-at-start`), outcome = `DOWN` (ou definir outra regra, e.g. reembolso).”*

---

### 2.6 Regra de `amount >= min` e constante `min`

Em `place-bet` o plano exige `amount-uint >= min`, mas `min` não aparece em constantes nem em dados.

**Ação:** Incluir `MIN_BET` (ou similar) nas constantes do bitpredix e descrever no plano, ou remover a checagem se não for usada.

---

### 2.7 Dust no split 10/10/80

Com divisão inteira:

- `fee_dev = fee_total * 10 / 100`
- `fee_consultant = fee_total * 10 / 100`
- `fee_po = fee_total * 80 / 100`

a soma pode ser menor que `fee_total` (ex.: `fee_total = 333` → 33+33+266 = 332).

**Ação:** Definir no plano: e.g. dar o dust ao PO (`fee_po = fee_total - fee_dev - fee_consultant`) ou outra regra explícita.

---

### 2.8 Pool inicial (LMSR) em `create-round`

- `lib/amm`: `createInitialPool()` → `qUp: 0, qDown: 0, volumeTraded: 0`.
- TOKEN_ARCHITECTURE: `pool-up: u10000, pool-down: u10000`.

O plano usa `pool-up`, `pool-down`, `volume-traded` mas não define valores iniciais.

**Ação:** Especificar no plano os iniciais e a relação com o LMSR (e com `lib/amm` se for espelhado), e.g. `pool-up: 0`, `pool-down: 0`, `volume-traded: 0` ou a parametrização equivalente (ex. `b0`).

---

### 2.9 Oráculo: `ORACLE` vs contrato `oracle`

- **Contrato** `oracle`: expõe `set-price`, `get-price`; o bitpredix chama `(contract-call? .oracle get-price round-id)`.
- **Principal** `ORACLE`: carteira que pode `set-price`, `create-round`, `resolve-round`.

Na Fase 2 está: *“anotar o principal do oráculo (ORACLE)”*, o que pode ser lido como “principal do contrato” (i.e. endereço do contrato).

**Ação:** No plano, distinguir claramente:
- **Contrato** `oracle` (principal do contrato, para `get-price` e dependências do bitpredix).
- **Principal** `ORACLE` (carteira) para `set-price`, `create-round`, `resolve-round`. Especificar que ambos (oracle e bitpredix) usam o **mesmo** principal `ORACLE` nas verificações de `tx-sender`.

---

### 2.10 Chamada read-only entre contratos em Clarity

O plano usa `(contract-call? .oracle get-price round-id)`. `get-price` é read-only e pode retornar `(optional uint)`.

- `contract-call?` em Clarity é pensado para funções que retornam `(response A B)`.
- Para read-only que retorna `(optional uint)`, a forma de chamada pode diferir.

**Ação:** Confirmar na documentação da Stacks/Clarity a chamada correta a read-only de outro contrato (e o uso de `unwrap!` em optional) e, se necessário, ajustar o plano e o comentário no `resolve-round`.

---

### 2.11 `bitpredix.clar` (stub) vs plano

O stub atual tem:

```clarity
(define-public (resolve-round (round-id uint) (price-at-end uint) (outcome (string-ascii 4)))
  (ok true))
```

O plano prevê `resolve-round (round-id uint)` apenas.

**Ação:** Atualizar o stub em `bitpredix.clar` para `(define-public (resolve-round (round-id uint)) (ok true))` (ou a assinatura final adotada) para não induzir implementação errada.

---

### 2.12 Nomenclatura: `place-bet` vs `buy-shares`

O plano e o bitpredix usam `place-bet`; FUNDS e partes do TOKEN usam `buy-shares`. O 1.2 do plano e a referência ao FUNDS falam em “approve + buy-shares”.

**Ação:** Padronizar no plano (e nos docs que forem alterados) para `place-bet` e ajustar as menções a `buy-shares` para “place-bet (equivalente ao buy-shares do FUNDS)” ou similar.

---

### 2.13 Pool: `pool-up` / `pool-down` vs `qUp` / `qDown` e `volumeTraded`

- Plano/bitpredix: `pool-up`, `pool-down`, `volume-traded`.
- `lib/amm` / `lib/types`: `qUp`, `qDown`, `volumeTraded`.

No LMSR, `qUp`/`qDown` são as quantidades de shares vendidas (acumuladas). O plano não diz se `pool-up`/`pool-down` são exatamente isso ou outra métrica (ex. reservas).

**Ação:** No plano, definir: `pool-up` = `qUp`, `pool-down` = `qDown` (ou a convenção escolhida) e `volume-traded` = `volumeTraded`, e referir `lib/amm` para as fórmulas.

---

### 2.14 Endereços em 3.5 e Fase 7

- 3.5: *“testnet: `ST...test-usdcx`, `ST...bitpredix`”* — falta `oracle`.
- Fase 7 (`.env.example`): `TEST_USDCX`, `BITPREDIX_ID`, `STACKS_NETWORK=testnet` — faltam `ORACLE` (ou `ORACLE_CONTRACT_ID`) e os `FEE_RECIPIENT_*` (ao menos para deploy/docs).

**Ação:** Incluir `oracle` na lista de 3.5 e no exemplo de config (Fase 7) as variáveis necessárias para oráculo e fees (mesmo que só usadas em deploy/backend).

---

## 3. Ordem de execução e timing

### 3.1 `set-price` antes de `resolve-round`

O fluxo diz: (1) `oracle.set-price(round-id, price)`, (2) `bitpredix.resolve-round(round-id)`.

Se (2) for minerado antes de (1), `get-price` pode retornar `none` e o `unwrap!` aborta com `(err u1003)`. O plano não fala em ordering nem em sequência atômica.

**Ação:** Deixar explícito que o backend deve garantir que `set-price` está confirmado on-chain antes de enviar `resolve-round`, ou desenhar um fluxo atômico (ex. oráculo chama o bitpredix após set-price na mesma tx, se a stack permitir).

---

### 3.2 `create-round` no início do minuto

A Fase 5 diz que o ORACLE chama `create-round` no início de cada minuto. A confirmação on-chain pode atrasar; o primeiro `place-bet` pode só ser possível alguns blocos depois.

**Ação:** Considerar no plano (ou em TESTNET.md) que o “início” efectivo da rodada pode ser o bloco em que `create-round` entra, e que `ends-at`/`trading-closes-at` devem ser definidos de forma consistente com isso (timestamp vs block-height), para evitar janelas de trading negativas ou confusas.

---

## 4. Resumo de ações recomendadas

| # | Onde | Ação |
|---|------|------|
| 1 | FUNDS_ARCHITECTURE | Ajustar exemplos: `place-bet`, `resolve-round(round-id)`, oráculo, fees 10/10/80, `claim-winnings`; Exemplo Completo sem PLATFORM_ADDRESS único. |
| 2 | FUNDS_ARCHITECTURE | Alinhar estrutura `positions` com `(round-id, user, side)` e `settled`. |
| 3 | TOKEN_ARCHITECTURE | Nota referenciando PLANO para `claim-winnings`, `resolve-round(round-id)` e oráculo. |
| 4 | PLANO 3.2 test-usdcx | Regra: se `from = contract-caller` em `transfer-from`, permitir envio pelo saldo, sem allowance. |
| 5 | PLANO 3.2 e 3.3 | Definir assinatura única de `transfer-from` e corrigir a chamada em `place-bet`. |
| 6 | PLANO 3.3 create-round | Definir `ends-at` e `trading-closes-at` (e relation com `round-id`/block-height). |
| 7 | PLANO 3.3 create-round | Regra de idempotência ou rejeição de `round-id` já existente. |
| 8 | PLANO 3.3 | Regra explícita para empate (`price-at-end = price-at-start`). |
| 9 | PLANO 3.3 place-bet | Incluir `MIN_BET` ou remover a checagem `>= min`. |
| 10 | PLANO 3.3 resolve-round | Regra para dust no split 10/10/80 (ex.: `fee_po = fee_total - fee_dev - fee_consultant`). |
| 11 | PLANO 3.3 create-round | Valores iniciais de `pool-up`, `pool-down`, `volume-traded` e relação com LMSR. |
| 12 | PLANO Fase 2 e 3.2b | Separar “contrato oracle” e “principal ORACLE”; dizer que o mesmo principal é usado nos dois contratos. |
| 13 | PLANO 3.3 | Verificar/ajustar uso de `contract-call?` para `get-price` read-only. |
| 14 | bitpredix.clar | Atualizar stub `resolve-round` para `(round-id uint)` só. |
| 15 | PLANO 3.5 e Fase 7 | Incluir `oracle` nos endereços e `ORACLE`/`FEE_RECIPIENT_*` no exemplo de config. |
| 16 | PLANO 3.4 / Fase 5 | Garantir que `set-price` está confirmado antes de `resolve-round`; documentar. |
| 17 | PLANO 3.3 / 2.13 | Definir `pool-up`/`pool-down`/`volume-traded` em termos de `qUp`/`qDown`/`volumeTraded` e de `lib/amm`. |

---

## 5. Consistências positivas

- Oráculo on-chain: `set-price`/`get-price` e `resolve-round` lendo do oráculo estão coerentes.
- Trava: `place-bet` com `transfer-from` para o contrato; Libera: fees em `resolve-round`, payouts em `claim-winnings`.
- Fees 10/10/80 e constantes `FEE_RECIPIENT_*` estão definidas de forma clara.
- Deploy: test-usdcx → oracle → bitpredix está na ordem correta de dependências.
- `(round-id, user, side)` com `settled` e um único `claim-winnings(round-id)` para `claim-winnings` é coerente com o desenho de registro por lado.
- Uso de `claim-winnings` em vez de loop de distribuição no `resolve-round` evita limites de iteração em Clarity e está bem alinhado ao plano.
