# Oráculo / Cron — Rounds on-chain

## Problema: “Nenhuma rodada on-chain” e saldo a zeros

Se a app em modo on-chain mostra:

- **“Nenhuma rodada on-chain. O cron do oráculo (create-round) está a correr?”** — o mapa `rounds` do contrato **bitpredix** está vazio. As entradas só passam a existir quando o oráculo chama **`create-round`** no início de cada minuto.

- **Saldo em test USDC a 0** após ter feito mint — além do mint, o `/api/mint-status` chama **`get-balance`**. O parsing do `(ok uint)` foi corrigido (`type === 'ok'` em vez de `9`). Se ainda estiver a zeros, verificar que o `NEXT_PUBLIC_TEST_USDCX_CONTRACT_ID` corresponde ao contrato onde se fez mint e que o endereço em `get-local-storage` é o usado na carteira.

---

## ⚠️ IMPORTANTE: Contratos atualizados (2026-01-23)

Os contratos foram **corrigidos** para garantir rounds sequenciais infalíveis:

### Alterações nos contratos:

1. **`bitpredix.resolve-round`** agora recebe `price-at-end` como **segundo argumento** (não depende mais de `oracle.get-price`)
2. **`bitpredix.resolve-round`** é **idempotente** (retorna ok se já RESOLVED)
3. **`bitpredix.resolve-round`** não falha se pool vazio (usa `match` para transfers de fees)
4. **`oracle.set-price`** é **idempotente** (aceita duplicate com mesmo preço)

### Alterações no cron:

- **Aguarda confirmação** de `set-price` (até 2 min) antes de enviar `resolve-round`
- **Aguarda confirmação** de `resolve-round` (até 3 min) antes de enviar `create-round`
- Total por ciclo: **~540s (9 min)** — garante que cada tx confirma antes da seguinte

**⚠️ REDEPLOY OBRIGATÓRIO:** É necessário fazer **redeploy dos contratos** (oracle e bitpredix) para aplicar estas correções.

---

## Solução: correr o cron oráculo

O script **`scripts/cron-oracle.mjs`** faz, a cada execução:

1. **`oracle.set-price(round-id-ant, price)`** — guarda o preço de “fecho” do minuto que terminou.
2. **`bitpredix.resolve-round(round-id-ant, price)`** — resolve a rodada anterior passando o preço (não depende mais do oracle).
3. **`bitpredix.create-round(round-id-actual, price)`** — cria a rodada do minuto atual.

### Pré-requisitos

- **Chave do oráculo** — uma de:
  - **ORACLE_PRIVATE_KEY** — chave privada (hex) da carteira ORACLE. Leather permite exportar; Xverse **não**.
  - **ORACLE_MNEMONIC** — mnemonic (12 ou 24 palavras) da carteira ORACLE. O script deriva a chave (path `m/44'/5757'/0'/0/0`). Útil se usas Xverse e não tens export de private key; usa a mesma frase que criou a carteira.

- **Contract IDs** — `NEXT_PUBLIC_ORACLE_CONTRACT_ID` e `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` em `.env.local` (o script carrega `.env.local`).

### Executar uma vez (teste)

```bash
ORACLE_PRIVATE_KEY=0x... npm run cron-oracle
# ou com mnemonic (ex.: Xverse sem export de chave). Aspas obrigatórias:
ORACLE_MNEMONIC="word1 word2 ... word12" npm run cron-oracle
```

O script obtém o preço BTC (Bitstamp), envia as 3 transações: pausa de 60 s entre `set-price` e `resolve-round` para o preço estar disponível em `get-price`; **espera até 3 minutos** pela confirmação de **resolve-round** antes de enviar **create-round** (assim evita 3 tx pendentes em simultâneo no mempool). Usa **fee fixo de 200 000 uSTX** (0,2 STX) por tx para a testnet — fees baixos faziam com que as tx fossem aceites no mempool mas **nunca mineradas**. Após o broadcast de **create-round**, o script **espera até 4 minutos** pela confirmação na API Hiro; se não confirmar, falha (e o daemon volta a tentar no próximo ciclo). Com **`CONTINUE_ON_CREATE_TIMEOUT=1`** o daemon não para quando create-round não confirma a tempo — continua a correr e a tentar no minuto seguinte.

### Rounds automáticos (daemon) — recomendado para dev

Para os rounds aparecerem **automaticamente** sem configurar crontab, arranca o **daemon** e deixa-o a correr num terminal:

```bash
ORACLE_PRIVATE_KEY=0x... npm run oracle-daemon
# ou com mnemonic (aspas obrigatórias; sem elas o shell trata cada palavra como comando):
ORACLE_MNEMONIC="word1 word2 ... word12" npm run oracle-daemon
```

**Importante:** o mnemonic tem de estar entre **aspas**. Caso contrário o shell interpreta cada palavra como comando (ex. `treat: command not found`).

O daemon executa um ciclo completo (set-price → espera 60 s → resolve-round → espera confirmação → create-round) e volta a correr no início do minuto seguinte. Mantém o processo aberto; ao fechá-lo, os rounds deixam de ser criados.

### Executar a cada minuto (crontab)

Para que haja **sempre** uma rodada nova no início de cada minuto:

```bash
# Crontab: ao minuto 0 de cada hora (exemplo; o ideal é à :00 de cada minuto)
0 * * * * cd /caminho/para/bitpredix && ORACLE_PRIVATE_KEY=0x... node scripts/cron-oracle.mjs >> /var/log/bitpredix-cron.log 2>&1
```

Para correr **à :00 de cada minuto** (a cada 60 s):

```bash
* * * * * cd /caminho/para/bitpredix && ORACLE_PRIVATE_KEY=0x... node scripts/cron-oracle.mjs >> /var/log/bitpredix-cron.log 2>&1
```

(Recomenda-se à :00 para alinhar com o `round-id = floor(now/60)*60`.)

### Variáveis de ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `ORACLE_PRIVATE_KEY` | Sim** | Chave privada hex (com ou sem `0x`) da carteira ORACLE. |
| `ORACLE_MNEMONIC` | Sim** | Mnemonic (12 ou 24 palavras) da carteira ORACLE. Deriva a chave em `m/44'/5757'/0'/0/0`. Útil se a carteira (ex. Xverse) não exporta private key. |
| `ORACLE_CONTRACT_ID` | Não* | Ex. `ST1....oracle`. Default: `NEXT_PUBLIC_ORACLE_CONTRACT_ID` de `.env.local`. |
| `BITPREDIX_CONTRACT_ID` | Não* | Ex. `ST1....bitpredix`. Default: `NEXT_PUBLIC_BITPREDIX_CONTRACT_ID` de `.env.local`. |
| `CONTINUE_ON_CREATE_TIMEOUT` | Não | Se `1`, `true` ou `yes`: em timeout da confirmação de create-round o daemon não falha e continua no próximo minuto. |

\* Necessário se não estiver em `.env.local`.  
\** É obrigatório **uma** de `ORACLE_PRIVATE_KEY` ou `ORACLE_MNEMONIC`.

### create-round não aparece nas transações

Se só **set-price** (e talvez resolve-round) aparecem na carteira e **create-round** nunca — muitas vezes era **reutilização de nonce**: as 3 tx usavam o mesmo nonce e só a primeira era aceite. O script usa agora **nonces sequenciais** (N, N+1, N+2) para as três chamadas. Reinicia o daemon e volta a testar.

### Se as tx não aparecem no explorer

Se o daemon mostra `create-round X tx: abc123...` mas o explorer (testnet) não exibe essa tx ou a página fica em branco, a tx foi **aceite no mempool mas nunca minerada** (ex.: fee demasiado baixo). O script **espera primeiro** que **resolve-round** confirme (até 3 min) e só depois envia **create-round**, para não ter 3 tx pendentes em simultâneo. Usa **200 000 uSTX** (0,2 STX) por tx e espera até **4 minutos** pela confirmação de **create-round**. Em timeout, imprime o link do explorer para verificação manual. Com **`CONTINUE_ON_CREATE_TIMEOUT=1`** o daemon continua em vez de falhar (útil se a testnet estiver lenta).

### Verificar endereço ORACLE (mnemonic)

Para confirmar que o mnemonic deriva para o ORACLE do contrato:

```bash
ORACLE_MNEMONIC="tua frase..." npm run oracle-check-address
```

Deve aparecer “Coincidem? Sim”. Se não, o `create-round` falharia com `(err u401)` (sender não autorizado).

---

## Resumo

- **Rounds vazios** → arrancar o **daemon** (`npm run oracle-daemon`) ou executar `npm run cron-oracle` de minuto a minuto (crontab).
- **Saldo a zeros** com mint já feito → verificar parsing de `get-balance` (já corrigido) e CONTRACT_ID / endereço da carteira.
- **Tx não aparecem no explorer** → fee 200k uSTX; garantir que a conta ORACLE tem STX para fees (~0,6 STX por ciclo). Opcional: `CONTINUE_ON_CREATE_TIMEOUT=1` se a testnet estiver lenta.
