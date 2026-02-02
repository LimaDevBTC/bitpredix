# Pré-requisitos para deploy em testnet Stacks

Checklist do que falta para poder rodar o primeiro deploy (test-usdcx → oracle → bitpredix) na Stacks testnet.

**Em resumo:** faltam (1) **test-usdcx.clar** e (2) a **lógica completa do bitpredix.clar**; (3) os **3 endereços FEE_RECIPIENT_*** (em testnet podem ser o deployer); (4) **Clarinet** instalado, **settings/Testnet.toml** com mnemonic e **STX em testnet**. O **oracle.clar** e a estrutura (Clarinet.toml, settings, .env.example) já existem.

---

## 1. Dados que alguém precisa fornecer

Antes do deploy, estes valores têm de estar definidos e inseridos nos contratos (ou em config de deploy).

| Dado | Onde entra | Quem define |
|------|------------|-------------|
| **FEE_RECIPIENT_DEV** | `bitpredix.clar` (constante) | Endereço Stacks (ST1...) da carteira do dev. Em testnet, pode ser o mesmo do deployer para os 3. |
| **FEE_RECIPIENT_CONSULTANT** | `bitpredix.clar` (constante) | Endereço Stacks da carteira do consultant. |
| **FEE_RECIPIENT_PO** | `bitpredix.clar` (constante) | Endereço Stacks da carteira do product owner. |
| **ORACLE** | `oracle.clar` e `bitpredix.clar` (constante) | Em testnet = principal do **deployer** (ST1... ou SP... da carteira que assina o deploy e o cron). |
| **SELF** | `bitpredix.clar` (constante) | Principal do contrato bitpredix = `'{deployer}.bitpredix` (ex.: `'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.bitpredix`). Só é fixo **depois** do primeiro deploy; para o primeiro deploy usamos o principal do deployer: `'{deployer}.bitpredix`. |
| **Mnemonic (ou chave)** | `settings/Testnet.toml` | Carteira com STX em testnet para assinar o deploy. Deixar fora do repositório. |

**Testnet simplificado:** se os 3 endereços de fee ainda não existirem, usar o **deployer** para `FEE_RECIPIENT_DEV`, `_CONSULTANT` e `_PO`. Não usar isso em mainnet.

### 1.1 Valores já definidos para FEE_RECIPIENT

| Constante | Principal Stacks | % das fees | Estado |
|-----------|------------------|------------|--------|
| **FEE_RECIPIENT_DEV** | `SP22EZVX13VM85AK6D3TRMZCZDT9K5441PMKSDJ6J` | 10% | ✓ Definido (dev; desenvolvimento + destino das fees) |
| **FEE_RECIPIENT_PO** | `SP21SQ28WQRQ10TBK72261QXQAEC67K5Y1YMMYFZV` | 80% | ✓ Definido (owner) |
| **FEE_RECIPIENT_CONSULTANT** | `SP2J0T54Z1SZJWAKY0QJ624CQRHB88CYC469RBF4A` | 10% | ✓ Definido (consultant) |

### 1.2 Carteira, STX e faucet (testnet) — o que precisamos e o que falta

**Em testnet usamos faucet: não é preciso STX real.** O STX de testnet não tem valor; serve só para pagar fees (deploy dos contratos e chamadas do cron: `set-price`, `resolve-round`, `create-round`).

---

#### O que vamos precisar

| Item | Para quê | STX real? |
|------|----------|-----------|
| **Carteira deployer (mnemonic)** | Assinar o deploy dos 3 contratos e, no cron, as chamadas ORACLE (`set-price`, `resolve-round`, `create-round`). Em testnet, **ORACLE = deployer**. | Não |
| **STX em testnet** | Pagar fees de deploy e do cron. Obter no **faucet** (ex.: Hiro). | Não — faucet |
| **Carteira para testes no frontend** (opcional) | Xverse/Leather em **testnet** para testar mint, place-bet, claim. Pode ser outra carteira com STX de faucet (para as fees das txs do user). | Não — faucet |

**Mainnet (futuro):** aí sim será preciso STX real para deploy e para o ORACLE. Em testnet, **só faucet**.

---

#### O que ainda NÃO está configurado

| # | O quê | Onde | Como resolver |
|---|-------|------|----------------|
| 1 | **`settings/Testnet.toml`** | Ficheiro não existe (só `.example`) | Copiar `settings/Testnet.toml.example` para `settings/Testnet.toml` e pôr as **12 ou 24 palavras** da carteira deployer em `[accounts.deployer] mnemonic = "..."`. Esta carteira será o deployer e o ORACLE em testnet. |
| 2 | **STX testnet na carteira deployer** | A conta derivada do mnemonic em Testnet.toml | 1) Obter o endereço ST1 (ou SP) do deployer — p. ex. com `clarinet deployments generate --testnet` (o plano ou os logs mostram o endereço) ou importando o mnemonic na Xverse em testnet. 2) Pedir STX no **faucet**: [Hiro Explorer Sandbox](https://explorer.hiro.so/sandbox/faucet?chain=testnet) (conectar a carteira ou colar o endereço, conforme a UI) ou API `POST https://api.testnet.hiro.so/extended/v1/faucets/stx` com o endereço. Dá ~500 STX por pedido. |
| 3 | **Constante ORACLE em `oracle.clar`** | `contracts/oracle.clar` | Substituir o placeholder pelo **principal** (ST1 ou SP) do deployer. Esse principal é o que deriva do mnemonic em Testnet.toml. |
| 4 | **Constantes ORACLE e SELF em `bitpredix.clar`** | `contracts/bitpredix.clar` (quando tiver lógica) | **ORACLE** = mesmo principal do deployer. **SELF** = `'{deployer}.bitpredix` (ex.: `'ST1PQ...xxx.bitpredix`). O `deployer` é o principal da conta em Testnet.toml. |
| 5 | **`ORACLE_MNEMONIC` (ou `ORACLE_PRIVATE_KEY`) no backend** | `.env` do serviço do cron (quando existir) | O cron que chama `set-price`, `resolve-round` e `create-round` precisa de assinar com a chave do ORACLE. Em testnet = chave do **deployer**. Por segurança: variável de ambiente, nunca no repo. Pode ser o mesmo mnemonic de Testnet.toml (em env do backend) ou uma chave derivada. |

---

#### Faucet STX testnet (links)

- **Hiro Explorer Sandbox:** https://explorer.hiro.so/sandbox/faucet?chain=testnet  
- **API (ex.):** `POST https://api.testnet.hiro.so/extended/v1/faucets/stx` com body `{ "address": "ST1..." }`  
- **Leather (doc):** [Getting testnet STX](https://leather.gitbook.io/guides/testing/getting-testnet-stx)

---

#### Erro `BadAddressVersionByte` no faucet

Se ao pedir STX no faucet (Hiro ou API) a tx for rejeitada com **`BadAddressVersionByte`**, o endereço que a carteira está a usar **não é de testnet**.

- **Testnet:** endereços **`ST`** (single-sig) ou **`SN`** (multi-sig).
- **Mainnet:** endereços **`SP`** ou **`SM`**.

O faucet e o pool da testnet só aceitam `ST`/`SN`. Se a carteira estiver em **mainnet**, ela devolve `SP`/`SM` e a tx é rejeitada.

**Como resolver:**

- **Xverse:** Definições (⚙️) → **Network** → escolher **Testnet** (Stacks). O endereço passará a ser `ST...`. Voltar ao faucet, reconectar se precisar, e pedir STX de novo.
- **Leather:** Mudar a rede para **Testnet** nas definições da carteira; o endereço deve começar por `ST...`.
- **API do faucet:** Enviar no body um endereço **`ST1...`** (obtido com a carteira em testnet ou com `stx make_keychain -t`).

---

#### Carteira deployer: nova ou existente?

- **Nova (recomendado para testnet):** criar uma carteira só para testnet (Xverse, Leather ou gerador BIP39), guardar o mnemonic e usar em `Testnet.toml`. Assim evitas expor uma carteira com fundos reais.
- **Existente:** podes usar o mnemonic de uma carteira que já tenhas. Em testnet só esse endereço recebe STX de faucet; não uses essa carteira com STX mainnet no mesmo fluxo. O mnemonic em si não é “de testnet” ou “de mainnet” — o que muda é a rede ao fazer o deploy e as chamadas.

---

## 2. Contratos que ainda não existem

Só o `bitpredix.clar` existe (e em modo stub). Faltam as implementações completas e os outros dois .clar.

| Contrato | Ficheiro | Estado | Referência |
|----------|----------|--------|------------|
| **test-usdcx** | `contracts/test-usdcx.clar` | **A criar** | `PLANO_TESTNET_STACKS.md` § 3.2: SIP-010, `mint()` **1 000 USD uma única vez** por user, `allowance`/`approve`/`transfer-from` (incl. regra `from = contract-caller`), `get-minted`. |
| **oracle** | `contracts/oracle.clar` | **A criar** | `PLANO_TESTNET_STACKS.md` § 3.2b: `prices: (round-id uint) -> (price uint)`, `set-price` (só ORACLE, sem overwrite), `get-price` (optional uint). |
| **bitpredix** | `contracts/bitpredix.clar` | **Stub** | Completar: map `rounds` com `trading-closes-at`, `price-at-end`, `outcome`, `volume-traded`; constantes (TOKEN, ORACLE, SELF, FEE_*); lógica de `create-round`, `place-bet`, `resolve-round`, `claim-winnings` conforme § 3.3. |

Até `test-usdcx.clar` e `oracle.clar` existirem e estiverem no `Clarinet.toml`, não há deploy.

---

## 3. Estrutura do projeto Clarinet

| Item | Estado | Acção |
|------|--------|-------|
| **Clarinet.toml** | A criar | Adicionar `[project]` e `[contracts]` para `test-usdcx`, `oracle`, `bitpredix`. Incluir `requirements` com o trait SIP-010 (testnet) para o test-usdcx. |
| **settings/** | Não existe | Criar `settings/Testnet.toml` (ou `.example`); quem faz deploy copia, preenche mnemonic e node RPC. |
| **tests/** | Não existe | Opcional para o primeiro deploy; depois: testes Clarinet para os 3 contratos. |

---

## 4. Dependências do test-usdcx (SIP-010)

O `test-usdcx` precisa de `impl-trait` do SIP-010. Em testnet o trait costuma estar em:

- `ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.sip-010-trait-ft-standard.sip-010-trait`

No `Clarinet.toml` isto deve ir em `[project]` ou em `[contracts.test-usdcx]` como `requirements`. Para `clarinet check` e deploy em testnet, o `requirements` tem de apontar para o contrato/trait já deployado em testnet. Ver [SIP-010](https://github.com/stacksgov/sips/blob/main/sips/sip-010/sip-010-fungible-token-standard.md) e doc da Hiro.

### 4.1 Como o token test-usdcx é criado (deploy) em testnet

O test-usdcx **não** existe na rede até ser publicado como um **contrato Clarity** pela equipa. Não há faucet da Hiro nem “criar token” na Stacks; o token é definido **dentro** do nosso contrato `test-usdcx.clar` e passa a existir quando esse contrato é deployado.

**Fluxo:**

1. **Escrever o contrato** — `contracts/test-usdcx.clar` com `define-fungible-token test-usdcx`, SIP-010, `mint()` (1 000 USD, uma vez), `approve`/`transfer-from`, `get-minted`.
2. **Clarinet** — adicionar `[contracts.test-usdcx]` e `requirements` (trait SIP-010) no `Clarinet.toml`.
3. **Gerar o plano de deploy** — `clarinet deployments generate --testnet`. O Clarinet monta a transacção de **publicação do contrato** (contract publish).
4. **Assinar e enviar** — `clarinet deployments apply --testnet` (ou assinar manualmente com a carteira de deploy). A tx é broadcast para a Stacks testnet.
5. **Após confirmação** — o contrato fica live no endereço `{deployer}.test-usdcx` (ex.: `ST1PQ...deployer.test-usdcx`). O **token** passa a existir porque está definido nesse contrato; o supply inicial é 0.
6. **Users a receber tokens** — cada user chama `mint()` **no contrato já deployado** a partir da Xverse (ou outra carteira). O contrato credita 1 000 USD em `tx-sender` e marca `minted[tx-sender]`; não é preciso nenhum “faucet” externo — o próprio contrato é o “faucet”, limitado a 1 000 USD por principal, uma vez.

**Resumo:** a “criação” do token em testnet é o **deploy do contrato** `test-usdcx.clar` pela equipa. Depois desse deploy, qualquer user com carteira Stacks (testnet) pode ligar-se ao app, clicar “Mint test tokens” e assinar a chamada `mint()`; recebe 1 000 USD de saldo nesse contrato, uma única vez.

---

## 5. Ordem de deploy

1. **test-usdcx** — sem dependências de outros nossos contratos; só do trait SIP-010.
2. **oracle** — sem dependências.
3. **bitpredix** — precisa dos **principais** de `test-usdcx` e `oracle` já deployados para as constantes `TOKEN` e do oráculo (ou do contrato `.oracle` no mesmo deployment). Em Clarinet, se os 3 forem deployados no mesmo plano, `TOKEN` pode referir `.test-usdcx` e o oráculo `.oracle`.

Antes do deploy do bitpredix: anotar os `CONTRACT_ID` de test-usdcx e oracle (ou garantir que o plano de deploy do Clarinet os usa nas referências).

---

## 6. Constantes no bitpredix (resumo)

Devem ficar definidas no código ou via mecanismo de deploy (se o Clarinet suportar):

- `TOKEN` = principal do test-usdcx (ex.: `.test-usdcx` no mesmo deployment, ou `'ST...test-usdcx`).
- `ORACLE` = principal da carteira ORACLE (deployer em testnet).
- `SELF` = principal do contrato bitpredix = `'{deployer}.bitpredix`.
- `FEE_BPS` = 300.
- `MIN_BET` = 1_000_000 (1 USD, 6 decimais).
- `FEE_RECIPIENT_DEV` = `'SP22EZVX13VM85AK6D3TRMZCZDT9K5441PMKSDJ6J`; `FEE_RECIPIENT_PO` = `'SP21SQ28WQRQ10TBK72261QXQAEC67K5Y1YMMYFZV`; `FEE_RECIPIENT_CONSULTANT` = `'SP2J0T54Z1SZJWAKY0QJ624CQRHB88CYC469RBF4A`.

O contrato do oráculo é chamado com `(contract-call? .oracle get-price round-id)` — o nome `.oracle` depende de como o Clarinet mapeia o contrato `oracle.clar` no mesmo deployment.

---

## 7. Config da aplicação (frontend) após o deploy

Depois do deploy, a app Next.js precisa dos contract IDs. Exemplo de variáveis (`.env.example` → `.env.local`):

```
NEXT_PUBLIC_STACKS_NETWORK=testnet
NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID=ST1....test-usdcx
NEXT_PUBLIC_ORACLE_CONTRACT_ID=ST1....oracle
NEXT_PUBLIC_BITPREDIX_CONTRACT_ID=ST1....bitpredix
```

O backend do cron precisa ainda da chave/mnemonic do ORACLE e dos endereços (opcional) para monitoring.

---

## 8. Checklist mínimo “pronto para primeiro deploy”

- [ ] **test-usdcx.clar** implementado e em `contracts/`.
- [ ] **oracle.clar** implementado e em `contracts/`.
- [ ] **bitpredix.clar** com lógica completa e constantes preenchidas (ou mapeadas no deploy) para: TOKEN, ORACLE, SELF, FEE_BPS, MIN_BET, FEE_RECIPIENT_*.
- [ ] **Clarinet.toml** com `[contracts]` para test-usdcx, oracle, bitpredix e `requirements` SIP-010 para test-usdcx.
- [ ] **settings/Testnet.toml** (a partir de `.example`) com mnemonic e config de rede para testnet.
- [ ] Carteira de deploy com **STX em testnet** (faucet se necessário).
- [ ] **Endereços FEE_RECIPIENT_*** definidos (em testnet podem ser iguais ao deployer).
- [ ] **`clarinet check`** e **`clarinet test`** (quando existirem testes) a passar.
- [ ] **`clarinet deployments generate --testnet`** e revisão do plano.
- [ ] **`clarinet deployments apply --testnet`** (ou o fluxo de deploy adoptado).

---

## 9. O que já está feito

- `docs/PLANO_TESTNET_STACKS.md` — desenho e fases.
- `docs/DUVIDAS_ABERTAS.md` — decisões (mint, Pyth, etc.).
- `docs/PRE_DEPLOY_TESTNET.md` — este checklist.
- `contracts/bitpredix.clar` — estrutura (stub); map `rounds` e `positions` e assinaturas das funções alinhadas ao plano.
- `contracts/oracle.clar` — implementação mínima: `set-price`, `get-price`, sem overwrite; constante `ORACLE` a substituir no deploy.
- `Clarinet.toml` — projecto com `oracle` e `bitpredix`; `test-usdcx` a adicionar quando o contrato existir.
- `settings/Testnet.toml.example` — modelo para testnet; copiar para `Testnet.toml` e preencher mnemonic.
- `.env.example` — variáveis para o app (NEXT_PUBLIC_* e backend/cron).
- Decisão de usar **Pyth** em mainnet; em testnet o nosso `oracle.clar` é alimentado por Bitstamp ou Pyth.

---

## 10. Próximo passo imediato

1. Implementar **test-usdcx.clar** (SIP-010 + `mint()` 1 000 USD uma única vez + allowance/transfer-from). Ver § 4.1 para o fluxo de criação do token em testnet.
2. Implementar **oracle.clar** (set-price, get-price, sem overwrite).
3. Adicionar os dois ao `Clarinet.toml` e configurar `requirements` do SIP-010.
4. Completar **bitpredix.clar** (lógica + constantes) e manter/no `Clarinet.toml`.
5. Criar **settings/Testnet.toml** (a partir do exemplo), preencher mnemonic, obter STX testnet.
6. Correr `clarinet check`, `clarinet test`, `clarinet deployments generate --testnet` e `apply`.

Quando 1–5 estiverem feitos, o deploy em testnet fica desbloqueado.
