# Plano: Bitpredix on-chain na Stacks Testnet

Análise e arquitetura para colocar o app em testnet (Xverse, test-usdcx, contrato de rodadas em Clarity).  
**Objetivo:** ter base teórica e técnica (Clarity + Stacks) e um plano de execução claro — sem implementar ainda.

---

## Parte 1 — Base teórica e técnica: Clarity e Stacks

### 1.1 Clarity em resumo

| Aspecto | Descrição |
|--------|------------|
| **Natureza** | Linguagem **decidível** e **interpretada**; o código é publicado on-chain tal como escrito ([Clarity Overview](https://docs.stacks.co/clarity/overview)). |
| **Segurança** | Sem reentrância; overflow/underflow abortam; respostas de chamadas públicas **não podem ser ignoradas**; pós-condições protegem transferências. |
| **Sintaxe** | Estilo LISP: `(define-public (fun (a uint)) (ok a))`. |
| **Tipos** | `int`, `uint` (128-bit), `bool`, `principal`, `(buff n)`, `(string-ascii n)`, `(string-utf8 n)`, `(list n T)`, `{k: v}`, `(optional T)`, `(response ok err)`. |
| **Funções** | `define-public` (estado + externo), `define-private`, `define-read-only` (somente leitura). |
| **Composição** | **Traits** (interfaces); `impl-trait`; sem herança. |
| **Token nativo** | `define-fungible-token`, `ft-mint?`, `ft-transfer?`, `ft-get-balance`, `ft-get-supply`. |
| **Bitcoin** | Contratos podem **ler** estado da base chain (ex.: verificar tx Bitcoin). |

Principais diferenças em relação a Solidity: sem “gas” indeterminado (decidível), sem reentrância, sem compilador (WYSIWYG), `(response ok err)` obrigatório em funções públicas.

---

### 1.2 SIP-010 (Fungible token)

- **Trait:** [SIP-010](https://github.com/stacksgov/sips/blob/main/sips/sip-010/sip-010-fungible-token-standard.md): `transfer`, `get-name`, `get-symbol`, `get-decimals`, `get-balance`, `get-total-supply`, `get-token-uri`.
- **Built-ins:** `define-fungible-token`, `ft-mint?`, `ft-transfer?`, `ft-get-balance`, `ft-get-supply`.
- **Testnet:** trait em `ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard.sip-010-trait` ([Hiro Explorer](https://explorer.hiro.so/txid/ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard?chain=testnet)).
- **Allowance / transfer-from:** o SIP-010 base não define `approve`/`transfer-from`. Para o Bitpredix **puxar** USDCx/test-usdcx do usuário, o token precisa de um mecanismo de permissão. Opções: (a) implementar `transfer-from` + map de allowance no nosso **test-usdcx**; (b) ou, em cenários simplificados, o usuário faz `transfer` direto para o contrato no mesmo fluxo (menos atômico). **Recomendação:** test-usdcx com `allowance` + `transfer-from` (comportamento análogo a ERC‑20) para alinhar ao fluxo de `FUNDS_ARCHITECTURE` (approve + buy-shares).

---

### 1.3 Stacks: rede e execução

- **Testnet:** [Hiro API](https://api.testnet.hiro.so), faucet para STX.
- **Blocos:** ancorados em Bitcoin; ~1 bloco Stacks por bloco Bitcoin (e portanto latência na ordem de minutos).
- **Transações:** custo em STX (read/write/runtime); estimativas: chamada simples ~0.001–0.01 STX, publicação de contrato bem maior.

---

### 1.4 Clarinet

- **CLI:** desenvolvimento, testes, e **deploy** ([Contract Deployment](https://docs.stacks.co/clarinet/contract-deployment)).
- **Comandos relevantes:**  
  - `clarinet check`  
  - `clarinet test`  
  - `clarinet deployments generate --testnet --medium-cost`  
  - `clarinet deployments apply --testnet`
- **Settings:** `settings/Testnet.toml` com `mnemonic` (ou `encrypted_mnemonic`), `node_rpc_address`. Faucet para STX em testnet.
- **Requisitos:** `requirements` em `Clarinet.toml` para traits (ex.: SIP-010) já deployados; Clarinet trata o remapeamento em devnet.

---

### 1.5 Stacks Connect e Xverse

- **@stacks/connect:** [Connect Wallet](https://docs.stacks.co/stacks-connect/connect-wallet): `connect()`, `disconnect()`, `isConnected()`, `getLocalStorage()`, `request('stx_getAccounts')`, `request('stx_transferStx', …)`, e para contract calls: `request('stx_contractCall', …)` ou uso de `@stacks/transactions` + `broadcastTransaction`.
- **Xverse:** Suporta Stacks (auth + assinatura de tx); compatível com Stacks Connect / `request()`. [Wallet Connect (Xverse)](https://docs.xverse.app/wallet-connect) cobre WalletConnect; para web “normal”, o fluxo via `@stacks/connect` + popup Xverse/Leather é o usual.
- **Rede:** configurar `network: 'testnet'` (ou objeto de rede) em todas as chamadas e transações.

---

### 1.6 USDCx e “test USDCx”

- **USDCx (produção):** [Bridging USDCx](https://docs.stacks.co/more-guides/bridging-usdcx): USDC (Ethereum) → xReserve → attestation → mint em Stacks.  
  - Testnet: `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx` (ou `.usdcx-v1` conforme doc).  
  - Obter USDCx em testnet exige: USDC em Sepolia, ETH para gas, e o fluxo de bridge (~15 min).
- **test-usdcx (nosso token para testnet):**  
  - SIP-010; 6 decimais (como USDC).  
  - **`mint()`** (sem argumentos): qualquer user chama e recebe **1 000 USD** (`1_000_000_000` em 6 decimais) em `tx-sender`. **Uma única vez por principal:** se já mintou, a tx falha. Map `minted: principal -> uint`; `get-minted(who)` para a UI.  
  - `allowance` + `approve` + `transfer-from(from, to, amount, memo)` (extensão ao SIP-010).  
  - Uso: botão **“Mint test tokens”** no app chama `mint()`; o user fica com 1 000 USD “teste” para apostar; não pode mintar de novo.

---

## Parte 2 — O que já existe vs o que falta

### 2.1 Já existente

| Item | Onde | Notas |
|------|------|-------|
| Contrato base (stubs) | `contracts/bitpredix.clar` | `rounds`, `positions`; `create-round`, `place-bet`, `resolve-round`, `claim-winnings` vazios. |
| Arquitetura de fundos | `docs/FUNDS_ARCHITECTURE.md` | approve + `transfer-from` + escrow por rodada + `resolve-round` + taxa 3% + distribuição. |
| Arquitetura de tokens | `docs/TOKEN_ARCHITECTURE.md` | Opção 2: **registros** (sem mint de shares), settlement imediato; USDCx como meio de pagamento. |
| AMM LMSR | `lib/amm.ts` | `buyShares`, `getPriceUp`, `getPriceDown`; `b = B0 + volumeTraded`. |
| Regras de rodada | `lib/rounds.ts` | 60s, `tradingClosesAt` 10–14s antes, `priceAtStart`/`priceAtEnd`, outcome UP/DOWN. |

### 2.2 O que falta para testnet

| Item | Descrição |
|------|------------|
| **Contrato test-usdcx** | SIP-010 + `mint()` (1 000 USD, **uma única vez** por user) + `allowance`/`approve`/`transfer-from`. |
| **Contrato bitpredix (Clarity)** | Lógica real: `place-bet` com transfer-from (trava no escrow), `resolve-round` lendo preço do oráculo on-chain e repartindo fees 10/10/80 (dev, consultant, PO), `claim-winnings` (libera payout); `trading-closes-at`; referência ao token e ao contrato oráculo. |
| **Projeto Clarinet** | `Clarinet.toml`, `settings/Testnet.toml`, `contracts/`, possivelmente `tests/`. |
| **Integração Xverse** | `@stacks/connect` no frontend: Connect wallet, rede testnet, `stx_getAccounts`, assinatura de `mint`, `place-bet`, etc. |
| **Frontend: Connect + Mint + Apostar** | Substituir “Connect wallet” por fluxo real; tela ou botão “Mint test tokens (test-usdcx)”; `place-bet` chamando o contrato com token configurado. |
| **Contrato oráculo on-chain** | Oráculo que armazena/atestando o preço on-chain; `resolve-round` lê o preço do oráculo (não recebe via parâmetro). Em testnet: oráculo mínimo com `set-price(round-id, price)` restrito ao principal `ORACLE`. |
| **Backend (fonte de preço → on-chain)** | Ao fim da rodada: (1) obtém o preço — **testnet:** Bitstamp (ou Pyth); **mainnet:** **Pyth** (VAA Hermes → `verify-and-update-price-feeds` → `read-price-feed` → converter para 6 decimais); (2) `oracle.set-price(round-id, price)`; (3) após confirmação, `bitpredix.resolve-round(round-id)`. |
| **Config e CI** | Endereços de contratos (test-usdcx, oracle, bitpredix) e dos recipients de fee (dev, consultant, PO) para testnet; variáveis de ambiente no frontend. |

---

## Parte 3 — Arquitetura para testnet

### 3.1 Contratos

```
contracts/
├── test-usdcx.clar      # SIP-010 + mint + approve/transfer-from
├── oracle.clar          # Oráculo on-chain: set-price(round-id, price), get-price(round-id)
├── bitpredix.clar       # Rodadas, place-bet, resolve-round, claim/settlement
└── (opcional) traits/
    └── sip-010-ft.clar  # Só se não usarmos o trait já deployado em testnet
```

**Ordem de deploy (Clarinet):**

1. `test-usdcx` (sem dependência).
2. `oracle` (sem dependência do bitpredix).
3. `bitpredix` (depende do `test-usdcx` e do `oracle`; em mainnet: token = USDCx, fonte de preço para o nosso oracle = **Pyth**).

### 3.2 test-usdcx.clar (esboço lógico)

- `impl-trait` do SIP-010 (trait testnet).
- `define-fungible-token test-usdcx` (supply máximo opcional, ex. 1_000_000 * 10^6).
- Read-only: `get-name`, `get-symbol`, `get-decimals`, `get-balance`, `get-total-supply`, `get-token-uri`.
- `transfer` conforme SIP-010.
- **Extensão:** map `allowances: (principal, principal) -> uint`; `approve(spender, amount)`, `transfer-from(from, to, amount, memo?)`. Regra: se `from = contract-caller`, permitir a transferência usando o saldo de `from` **sem** allowance (para o bitpredix enviar do escrow). Caso contrário, exige `allowance(from, contract-caller) >= amount`.
- **`mint()`** (sem argumentos): qualquer `tx-sender`; credita **1 000 USD** (`1_000_000_000`) em `tx-sender`. **Uma única vez:** exige `(default-to u0 (map-get? minted tx-sender)) = u0`; caso contrário `(err u?)`. Atualiza `minted[tx-sender] = 1_000_000_000` e chama `ft-mint?`.
- **Read-only** `get-minted(who principal)`: retorna `u0` ou `1_000_000_000` (para a UI mostrar “Já usou o mint” ou “Receber 1 000 USD teste”).

### 3.2b oracle.clar (esboço) — cache round-id → price

- **Objetivo:** guardar o preço **por rodada** (round-id → price). O bitpredix lê `get-price(round-id)`; não recebe preço nem outcome por parâmetro.
- **Dados:** `prices: (round-id uint) -> (price uint)` em **6 decimais** (ex.: 97 500,25 USD → `97500250000`).
- **Funções:**
  - `set-price (round-id uint) (price uint)`: só `tx-sender = ORACLE`. Se já existe preço para esse `round-id`, retorna erro (sem overwrite). Caso contrário, grava.
  - `get-price (round-id uint)`: read-only; retorna `(optional uint)`.
- **Fonte do preço (quem chama set-price):**  
  - **Testnet:** Bitstamp (ou Pyth, se quiser validar o fluxo).  
  - **Mainnet:** **Pyth** (oráculo de preços da Stacks) — ver 3.2c.

### 3.2c Pyth na Stacks (oráculo de preços)

Na Stacks, o oráculo de preços é o **Pyth Network** (modelo **pull**). Contratos e feeds:

| Rede   | Contrato principal   | Storage              |
|--------|----------------------|----------------------|
| Mainnet| `SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-oracle-v4`   | `...pyth-storage-v4` |
| Testnet| `STR738QQX1PVTM6WTDF833Z18T8R0ZB791TCNEFM.pyth-oracle-v4`   | `...pyth-storage-v4` |

- **BTC/USD feed ID:** `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`
- **Atualizar preço (pull):** `verify-and-update-price-feeds(price-feed-bytes, {pyth-storage-contract, pyth-decoder-contract, wormhole-core-contract})` com **VAA** da [Hermes](https://hermes.pyth.network); custo 1 uSTX. O VAA vem do `@pythnetwork/hermes-client` ou da API Hermes.
- **Ler sem atualizar:** `read-price-feed(price-feed-id, pyth-storage-address)` devolve `{price, expo, ...}`. Formato: `price` com ponto fixo; `expo` define a potência (ex.: expo -8 ⇒ preço ≈ `price * 10^−8`). Converter para 6 decimais antes de gravar em nosso `oracle.set-price`.

**Papel do nosso `oracle.clar`:** O Pyth não guarda por `round-id`; guarda o último preço por feed. Nosso `oracle.clar` é um **cache round-id → price**: no momento de resolver, o backend obtém o preço (Pyth em mainnet, Bitstamp em testnet), converte para 6 decimais, chama `oracle.set-price(round-id, price)` e em seguida `bitpredix.resolve-round(round-id)`.

**Mainnet — fluxo com Pyth:** (1) Backend busca VAA (Hermes) para BTC/USD no intervalo de fecho da rodada; (2) chama `pyth-oracle-v4.verify-and-update-price-feeds(vaa, {...})`; (3) chama `read-price-feed(BTC_FEED_ID, pyth-storage-v4)`, converte `{price, expo}` para 6 decimais; (4) chama nosso `oracle.set-price(round-id, price)`; (5) após confirmação, `bitpredix.resolve-round(round-id)`.

Refs: [Pyth + Stacks](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/stacks), [Stacks Oracles](https://docs.stacks.co/guides-and-tutorials/oracles), [stacks-pyth-bridge](https://github.com/Trust-Machines/stacks-pyth-bridge).

### 3.3 bitpredix.clar (esboço)

- **Trava e libera (explícitos):**
  - **Trava:** em `place-bet`, `contract-call? .TOKEN transfer-from tx-sender (as-contract tx-sender) amount-uint none` — os fundos **saem da carteira do usuário** e ficam no contrato (escrow). O valor fica travado até a resolução.
  - **Libera:** em `resolve-round` e `claim-winnings`, o contrato envia tokens via `contract-call? .TOKEN transfer-from SELF recipient amount none` (o test-usdcx trata `from = contract-caller` como “enviar do próprio saldo”, sem allowance). Destinos: (a) os três `FEE_RECIPIENT_*` e (b) o vencedor em `claim-winnings`. (O `ft-transfer?` só vale para tokens definidos no próprio contrato; o token está em test-usdcx.)

- **Dados:**
  - `rounds`: `round-id (uint)` → `{ start-at, ends-at, trading-closes-at, price-at-start, price-at-end, outcome, status, pool-up, pool-down, volume-traded }`.
  - `positions`: `(round-id, user, side)` → `{ shares, cost, settled }`.
  - Constantes: `TOKEN`, `ORACLE`, `FEE_BPS` (300), `MIN_BET` (1_000_000 = 1 USD), `SELF` (principal do contrato bitpredix, preenchido no deploy), `FEE_RECIPIENT_DEV`, `_CONSULTANT`, `_PO`. **Valores definidos:** `FEE_RECIPIENT_DEV` = `SP22EZVX13VM85AK6D3TRMZCZDT9K5441PMKSDJ6J` (10%; dev); `FEE_RECIPIENT_PO` = `SP21SQ28WQRQ10TBK72261QXQAEC67K5Y1YMMYFZV` (80%); `FEE_RECIPIENT_CONSULTANT` = `SP2J0T54Z1SZJWAKY0QJ624CQRHB88CYC469RBF4A` (10%; consultant). Para enviar do escrow: `transfer-from(SELF, recipient, amount, none)`; o test-usdcx aceita `from = contract-caller` (bitpredix) sem allowance.

- **Funções públicas:**
  - `create-round (round-id uint) (price-at-start uint)`  
    - Só `tx-sender = ORACLE`. **Idempotente:** se `round-id` já existir, `(ok true)` sem alterar.  
    - `round-id` = timestamp Unix (s) do início do minuto. `ends-at = round-id + 60`; `trading-closes-at = ends-at - 12` (12 s fixo). Em `place-bet`, "agora" = `(get-block-info? (context) 'time)`.  
    - Pool: `pool-up = 0`, `pool-down = 0`, `volume-traded = 0` (convenção `lib/amm`: pool-up=qUp, pool-down=qDown).
  - `place-bet (round-id uint) (side (string-ascii 4)) (amount-uint uint)`  
    - Verifica: `(get-block-info? (context) 'time) < trading-closes-at`, `status = TRADING`, `amount-uint >= MIN_BET` (= 1 USD = `1_000_000` em 6 decimais).  
    - **Trava:** `contract-call? .TOKEN transfer-from tx-sender (as-contract tx-sender) amount-uint none` — fundos para o escrow (assumindo `transfer-from(from, to, amount, memo)` no test-usdcx).  
    - LMSR (integers; fórmula com 1e6); atualiza `rounds` (pool, volume) e `positions`.
  - `resolve-round (round-id uint)`  
    - Só `tx-sender = ORACLE`.  
    - **Preço on-chain:** `let (price-at-end (unwrap! (contract-call? .oracle get-price round-id) (err u1003)))`; `outcome` = se `> price-at-end price-at-start` então `"UP"` senão `"DOWN"` (empate → `"DOWN"`).  
    - `fee_total = (pool-up + pool-down) * FEE_BPS / 10_000`;  
      `fee_dev = fee_total * 10 / 100`, `fee_consultant = fee_total * 10 / 100`, `fee_po = fee_total - fee_dev - fee_consultant` (o dust fica com o PO).  
    - **Libera (fees):** três `contract-call? .TOKEN transfer-from SELF FEE_RECIPIENT_* <valor> none`.  
    - Marca `status = RESOLVED`, grava `price-at-end` e `outcome`.
  - `claim-winnings (round-id uint)`  
    - Round `RESOLVED`; usuário com `positions` não `settled` no lado vencedor; calcula payout (proporcional às shares vencedoras, sobre o pool já descontada a `fee_total`); **libera:** `contract-call? .TOKEN transfer-from SELF tx-sender payout none`; marca `settled`.

- **LMSR em Clarity (MVP testnet):**  
  - Clarity não tem `exp`/`log`. **Usar fórmula simplificada** (linear ou “LMSR-light”): 50/50 no início, preço sobe/desce no sentido certo com as apostas. Trabalhar em `uint` com 6 decimais. LMSR com tabela/polinómio fica para versão posterior.

### 3.4 Fluxo no app (testnet)

```
1. Usuário abre o app (testnet).
2. Connect wallet (Xverse): @stacks/connect, network=testnet.
3. “Mint test tokens”: chama `test-usdcx.mint()`; o user recebe **1 000 USD** em `tx-sender`. **Uma única vez** por carteira; se já mintou, o botão desactiva ou mostra “Já usou”.
4. Apostar:
   - approve(bitpredix, amount) no test-usdcx;
   - place-bet(round-id, "UP" ou "DOWN", amount) no bitpredix.
5. Ao fim da rodada: backend (chave ORACLE) chama `oracle.set-price(round-id, price)`; **após confirmação on-chain**, chama `bitpredix.resolve-round(round-id)` (o contrato lê `get-price` no oráculo — se `set-price` ainda não foi minerado, o `get-price` retorna `none` e o resolve falha). O resolve calcula outcome, desconta a fee (3%) e reparte 10% / 10% / 80% para dev, consultant e PO, e marca a rodada como RESOLVED.
6. Usuário: `claim-winnings(round-id)` — o contrato libera o payout para a carteira do vencedor.
```

### 3.5 Integração Xverse (frontend)

- `npm install @stacks/connect @stacks/transactions @stacks/network`.
- Antes de qualquer tx: `connect({...})` com `appDetails`, `redirectTo`, `onFinish`; rede testnet.
- Para contract call:  
  - `makeContractCall({ contractAddress, contractName, functionName, functionArgs, senderKey })` em modo “headless” ou  
  - `request('stx_contractCall', { ... })` para o wallet assinar (recomendado: usuário assina na Xverse).
- Endereços dos contratos:  
  - testnet: `ST...test-usdcx`, `ST...oracle`, `ST...bitpredix` (a definir após deploy).

---

## Parte 4 — Plano de execução em fases

### Fase 0 — Preparação (leitura e ambiente)

- [ ] Ler [Clarity of Mind](https://book.clarity-lang.org/) (capítulos principais) e [Clarity Crash Course](https://docs.stacks.co/get-started/clarity-crash-course).
- [ ] Instalar Clarinet; integrar no repo: `Clarinet.toml` e `contracts/` na **raiz** (junto a bitpredix.clar, test-usdcx, oracle).
- [ ] Configurar `settings/Testnet.toml` com mnemonic e faucet; conseguir STX testnet.
- [ ] Xverse em testnet: criar/importar carteira e conferir que a app consegue `connect` em testnet.

### Fase 1 — Token test-usdcx

- [ ] Implementar `test-usdcx.clar`: SIP-010 + `mint()` (1 000 USD, uma única vez; map `minted`) + `allowance`/`approve`/`transfer-from`.
- [ ] `impl-trait` do SIP-010 testnet; adicionar como `requirements` no Clarinet.
- [ ] Testes unitários (Clarinet) para mint, transfer, approve, transfer-from.
- [ ] `clarinet deployments generate --testnet` e `apply`; anotar `CONTRACT_ID` (principal + nome).

### Fase 2 — Oráculo e Contrato bitpredix (rodadas)

- [ ] Implementar e fazer deploy de `oracle.clar` em testnet (antes do bitpredix); anotar o **principal do contrato** `oracle` (para o bitpredix chamar `get-price`) e o **principal ORACLE** (carteira) usado em `set-price` e em `create-round`/`resolve-round` — o mesmo principal em ambos os contratos.
- [ ] Especificar LMSR em inteiros (ou regra simples para MVP testnet).
- [ ] Implementar `create-round`, `place-bet` (com `transfer-from` ao test-usdcx — **trava** no escrow), `resolve-round` (lê preço do oráculo, **libera** fees 10/10/80 para dev/consultant/PO), `claim-winnings` (**libera** payout ao vencedor).
- [ ] `trading-closes-at`: parâmetro em `create-round` ou constante.
- [ ] Constantes no deploy/init do bitpredix: `TOKEN` = test-usdcx, `ORACLE`, `FEE_BPS` = 300 (3%), `FEE_RECIPIENT_DEV`, `FEE_RECIPIENT_CONSULTANT`, `FEE_RECIPIENT_PO` (endereços: dev, consultant, PO).
- [ ] Testes: criar rodada, place-bet, resolve (com oráculo pré-populado), claim; edge cases; verificar repartição 10/10/80 das fees.
- [ ] Deploy do bitpredix em testnet após test-usdcx e oracle; anotar `BITPREDIX_ID`.

### Fase 3 — Integração Xverse no frontend

- [ ] Instalar `@stacks/connect`, `@stacks/transactions`, `@stacks/network`.
- [ ] Substituir “Connect wallet” por `connect()` (Stacks Connect) com `network: testnet` e `appDetails`.
- [ ] Após connect: `getLocalStorage()` / `request('stx_getAccounts')` para `stxAddress`; exibir endereço e “Disconnect”.
- [ ] Verificar que Xverse (e Leather, se desejado) funcionam em testnet.

### Fase 4 — Mint test tokens e place-bet no app

- [ ] Botão “Mint test tokens”: `test-usdcx.mint()` — o user assina e recebe **1 000 USD** uma única vez. Mostrar “Já usou o mint” ou “Receber 1 000 USD teste” via `get-minted`.
- [ ] Tela de apostas: ao escolher UP/DOWN e valor,  
  - 1) `approve(bitpredix, amount)` no test-usdcx;  
  - 2) `place-bet(round-id, side, amount)` no bitpredix.  
  Transações em sequência (ou, quando suportado, em batch).
- [ ] Mostrar txid e link para o explorer (Hiro testnet).
- [ ] Manter chamadas read-only ao contrato (round, positions, pool) para preços e estado na UI (via `@stacks/blockchain-api` ou RPC).

### Fase 5 — Oráculo on-chain e Backend

- [ ] Oráculo e bitpredix já deployados (Fase 2), com `FEE_RECIPIENT_DEV`, `_CONSULTANT`, `_PO` configurados.
- [ ] **Cron único** a cada :00: (1) preço de fecho: **testnet** Bitstamp (ou Pyth); **mainnet** **Pyth** (VAA → `verify-and-update-price-feeds` → `read-price-feed` → 6 decimais) → `oracle.set-price(round-id, price)`; (2) **após confirmação**, `bitpredix.resolve-round(round-id)`; (3) preço de abertura → `create-round(round-id novo, price-at-start)`. ORACLE = chave do deployer em testnet (em env).

### Fase 6 — Claim e settlement no frontend

- [ ] Após `resolve-round`, mostrar modal de resultado (como hoje) e botão “Claim winnings”.
- [ ] `claim-winnings(round-id)`: contract call com assinatura via Xverse; atualizar saldo/posições após confirmação.
- [ ] (Opcional) Listar rodadas e posições do usuário via read-only calls.

### Fase 7 — Ajustes e documentação

- [ ] Config (`.env.example`): `VITE_*` ou `NEXT_PUBLIC_*` para `TEST_USDCX`, `ORACLE_CONTRACT_ID`, `BITPREDIX_ID`, `STACKS_NETWORK=testnet`; para deploy/backend: endereços dos `FEE_RECIPIENT_*` e chave `ORACLE`.
- [ ] README ou `docs/TESTNET.md`: como rodar Clarinet, deploy, faucet, Xverse testnet, e fluxo mint → bet → resolve → claim.
- [ ] **Testnet:** só test-usdcx. USDCx real fica para mainnet.

---

## Resumo de dependências e referências

| Recurso | URL |
|---------|-----|
| Stacks Docs | https://docs.stacks.co/ |
| Clarity Overview | https://docs.stacks.co/clarity/overview |
| SIP-010 / Fungible token | https://docs.stacks.co/guides-and-tutorials/tokens/creating-a-fungible-token |
| Stacks Connect | https://docs.stacks.co/stacks-connect/connect-wallet |
| Clarinet Contract Deployment | https://docs.stacks.co/clarinet/contract-deployment |
| **Pyth on Stacks** | https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/stacks |
| Stacks Price Oracles (Pyth, DIA) | https://docs.stacks.co/guides-and-tutorials/oracles |
| stacks-pyth-bridge (mainnet/testnet) | https://github.com/Trust-Machines/stacks-pyth-bridge |
| Bridging USDCx | https://docs.stacks.co/more-guides/bridging-usdcx |
| Xverse Wallet Connect | https://docs.xverse.app/wallet-connect |

---

## Próximo passo

Antes do deploy: ver **`docs/PRE_DEPLOY_TESTNET.md`** (checklist, dados a preencher, contratos em falta).  
Em seguida: **Fase 0** (Clarinet, Xverse testnet) e **Fase 1** (implementar `test-usdcx.clar`); depois Fase 2 (completar `bitpredix.clar`, deploy oracle e bitpredix).
