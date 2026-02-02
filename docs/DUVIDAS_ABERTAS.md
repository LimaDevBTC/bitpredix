# Decisões de produto e Stacks — Bitpredix testnet

As dúvidas foram fechadas: **decisão do produto** (mint por user) + **decisões de especialista** (produto + Stacks) para o resto. Este doc registra o que vale para o plano e para a implementação.

---

## Decisão do produto (você)

**4.1 Mint:** Cada **user** pode mintar test-usdcx para si **uma única vez**: **1 000 USD** (em 6 decimais: `1_000_000_000`). Chamada `mint()` sem argumentos; se já mintou, a tx falha.

---

## Decisões de especialista (produto + Stacks)

### 1. Identificadores e tempo

| # | Decisão |
|---|---------|
| **1.1** | `round-id` = **timestamp Unix (segundos)** do início do minuto (ex.: `1737654000`). Alinha com `lib/rounds` e backend. `ends-at = round-id + 60`. |
| **1.2** | `ends-at = round-id + 60`; `trading-closes-at = ends-at - 12` (**12 s fixo**). Em Clarity, “agora” = `(get-block-info? (context) 'time)` (burn block, segundos). |
| **1.3** | `create-round` **idempotente**: se `round-id` já existe, retorna `(ok true)` sem alterar estado (retries do cron não quebram). |

### 2. LMSR e pool

| # | Decisão |
|---|---------|
| **2.1** | Pool inicial: **`(0, 0, 0)`** (`pool-up`, `pool-down`, `volume-traded`), alinhado ao `lib/amm`. |
| **2.2** | **MVP testnet:** fórmula **simplificada** (linear ou “LMSR-light”) que: 50/50 no início, preço sobe/desce no sentido certo com as apostas. LMSR completo (tabela/polinómio de `exp`) fica para depois. |
| **2.3** | **`pool-up` = qUp**, **`pool-down` = qDown**, **`volume-traded` = volumeTraded** (convenção do `lib/amm`). |

### 3. Regras de negócio

| # | Decisão |
|---|---------|
| **3.1** | Empate (`price-at-end == price-at-start`): outcome = **`"DOWN"`** (padrão comum, evita reembolso complexo). |
| **3.2** | **`MIN_BET` = 1 USD** = `1_000_000` (6 decimais). |
| **3.3** | **12 s fixo** antes do fim para `trading-closes-at` (já em 1.2). |

### 4. test-usdcx e mint

| # | Decisão |
|---|---------|
| **4.1** | **User minta para si uma única vez: 1 000 USD.** `mint()` sem args. Ver acima. |
| **4.2** | **`transfer-from(from, to, amount, memo)`** com memo opcional; manter compatível com SIP-010. |
| **4.3** | **Só test-usdcx em testnet.** USDCx real fica para mainnet. |

### 5. Oráculo e backend

| # | Decisão |
|---|---------|
| **5.1** | Preço no oráculo: **6 decimais** (1 USD = `1_000_000`). Ex.: 97 500,25 → `97500250000`. |
| **5.2** | **`set-price` não permite overwrite:** se já existe preço para o `round-id`, retorna erro. Evita correções e abusos. |
| **5.3** | **Um único cron** a cada :00: (1) `set-price(round-id do minuto que *terminou*`, priceAtEnd); (2) após confirmação, `resolve-round(round-id)`; (3) `create-round(round-id do minuto *novo*`, priceAtStart). Rodada nova e resolve da antiga no mesmo tick. |
| **5.4** | **Oráculo de preços na Stacks = Pyth.** Em **mainnet** a fonte é o **Pyth** (`pyth-oracle-v4`, `pyth-storage-v4`; modelo pull, VAA Hermes). Nosso `oracle.clar` segue como cache **round-id → price**; o backend obtém o preço via Pyth, converte para 6 decimais e chama `oracle.set-price`. Testnet: Bitstamp ou Pyth. |

### 6. Clarity / Stacks

| # | Decisão |
|---|---------|
| **6.1** | Manter `(contract-call? .oracle get-price round-id)` com `get-price` retornando `(optional uint)` e `unwrap!` no bitpredix. **Na implementação:** se a chain não suportar bem, trocar `get-price` para `(response uint uint)` e usar `try!` ou `unwrap!` conforme o caso. |
| **6.2** | **`SELF`** = constante no bitpredix com o principal do contrato (`'deployer.bitpredix`), preenchida no deploy (ex.: Clarinet / build). Usar como `from` em `transfer-from` ao enviar do escrow. |

### 7. Operação e config

| # | Decisão |
|---|---------|
| **7.1** | **Testnet:** ORACLE = mesma chave do **deployer**. Em mainnet, usar conta separada. |
| **7.2** | **Testnet:** `FEE_RECIPIENT_*` como **constantes de deploy**. Setter só se for necessário em mainnet. |
| **7.3** | **`Clarinet.toml` e `contracts/` na raiz** do repo (o `contracts/` já existe com `bitpredix.clar`). |
| **7.4** | **Fee recipients (principais):** Dev (10%) = `SP22EZVX13VM85AK6D3TRMZCZDT9K5441PMKSDJ6J`; PO (80%) = `SP21SQ28WQRQ10TBK72261QXQAEC67K5Y1YMMYFZV`; Consultant (10%) = `SP2J0T54Z1SZJWAKY0QJ624CQRHB88CYC469RBF4A`. |

---

## test-usdcx: mint uma única vez (1 000 USD)

- **`mint()`** — sem argumentos. Qualquer um pode chamar; credita **1 000 USD** (`1_000_000_000` em 6 decimais) em `tx-sender`.
- **Uma única vez por principal:** Map `minted: principal -> uint` (0 = ainda não mintou; `1_000_000_000` = já mintou). Exige `(default-to u0 (map-get? minted tx-sender)) = u0`; caso contrário `(err u?)`.
- Após o mint, o user fica com 1 000 USD de saldo “teste” para usar no app; não pode mintar de novo.
- **`get-minted(who)`** read-only: retorna `u0` ou `1_000_000_000` (para a UI mostrar “Já usou o mint” ou “Receber 1 000 USD teste”).
- *(Opcional para depois: `mint-admin(amount, to)` só owner, sem teto, para testes.)*

---

## Resumo rápido

| Tema | O que vale |
|------|------------|
| round-id | Timestamp Unix (s) do início do minuto |
| ends-at / trading-closes-at | `round-id + 60`; `ends-at - 12` (12 s fixo) |
| create-round duplicado | Idempotente |
| Pool inicial | (0, 0, 0) |
| LMSR | Simplificado no MVP; LMSR completo depois |
| Empate | DOWN |
| MIN_BET | 1 USD |
| Mint | User, 1 000 USD, **uma única vez** (`mint()`) |
| transfer-from | (from, to, amount, memo) |
| testnet token | Só test-usdcx |
| Preço oráculo | 6 decimais |
| set-price | Sem overwrite |
| **Fonte de preço (mainnet)** | **Pyth** (pyth-oracle-v4, pull, VAA Hermes) |
| Cron | Um job: set-price → resolve → create (nova rodada) |
| SELF | Constante no bitpredix |
| ORACLE | Deployer em testnet |
| FEE_RECIPIENT | Constantes no deploy |
| Clarinet | Raiz do repo |
