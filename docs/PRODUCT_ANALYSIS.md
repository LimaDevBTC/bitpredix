# Análise de Produto — Bitpredix

**Autor:** Análise de Especialista em Produto  
**Data:** 2025-01  
**Objetivo:** Avaliar a experiência do utilizador, o fluxo de resolução das pools e o “fit” do produto em alto nível.

---

## 1. Estado atual: o que existe

### 1.1 Fluxo implementado

```
[Carrega] → [Rodada actual: TRADING] → [User compra UP/DOWN] → [Último trade mostrado]
                ↓ (countdown 0)
         [GET /api/round] → backend: resolve rodada N, cria rodada N+1
                ↓
         [UI recebe rodada N+1] → Card mostra nova rodada (pool 10k/10k novo)
```

- **Uma única “pool” por rodada:** cada minuto = nova pool 50/50. A anterior é descartada (em termos de UI; no backend fica em memória).
- **Sem identidade de utilizador:** não há login. Não há persistência de “quem comprou o quê”.
- **Sem posições:** o frontend não guarda “tenho X UP e Y DOWN nesta rodada”. Só guarda o último trade na sessão (`lastTrade`).
- **Resolução:** ao acabar o minuto, o backend calcula `outcome` (UP/DOWN) e `priceAtEnd`. A API passa a devolver a **nova** rodada. A antiga (com resultado) deixa de ser a “current” e **não é mostrada** de forma dedicada.

### 1.2 O que o utilizador vê (e não vê)

| Momento | O que vê | O que não vê / falta |
|---------|----------|------------------------|
| **Durante o minuto** | Preço BTC, countdown, UP/DOWN com preços, input USD, “Último: X shares @ Y¢” | Sua **posição agregada** (ex.: 120 UP + 50 DOWN). Histórico dos seus trades na rodada. |
| **Imediatamente após 0:00** | O card é actualizado com a **nova** rodada (novo preço de abertura, pool 50/50, countdown cheio). | O **resultado da rodada que acabou** (UP/DOWN, preço abertura/fecho). **Quanto ganhou ou perdeu.** |
| **Rodada resolvida** | Só se ainda houver um estado “RESOLVED” brevemente no header (ex.: badge “Resultado: UP”) antes de ser substituída pela nova. Na prática, a UI tende a mostrar já a nova rodada. | Um **ecrã ou bloco de resolução** claro. “A rodada X terminou: UP. Preço $97 000 → $97 200.” |
| **Transição** | Quase instantânea: countdown a 0 → refetch → nova rodada. | **Continuidade narrativa:** “Rodada 12:34 acabou. Eis o resultado. A seguir: rodada 12:35.” |

### 1.3 Conclusão do estado actual

- O utilizador **não vê o que ganhou** porque:
  1. Não há **registo de posições por utilizador** (não sabemos o que “ele” comprou).
  2. Não há **ecrã (ou secção) de resolução** que dure um tempo útil.
  3. A **transição** é “substituir a rodada anterior pela nova” sem uma fase explícita “rodada N — resultado”.

- A **pool “imendada” na seguinte** no sentido de “uma única pool contínua” **não está** feita; e, de certa forma, **não é o modelo**: cada minuto é um mercado independente que resolve. O que está em falta é a **sensação de continuidade** (uma rodada acabou → vemos o resultado → a seguir começa outra), não a fusão de liquidez entre pools.

---

## 2. Análise de UX por tema

### 2.1 Posições e P&L (o que ganhei/perdi)

**Problema:** Não existe o conceito de “minha posição” nem “meu resultado”.

**Impacto:**  
O coração de um prediction market é “ apostei, acertei/errei, ganhei/perdi ”. Sem isto, a experiência é incompleta e pouco recompensadora.

**Opções (por ordem de complexidade):**

- **A) Sessão/localStorage (MVP):**  
  - Guardar no cliente: `{ roundId, side, shares, amountUsd }` por trade.  
  - Na resolução (ou ao ver o resultado de uma rodada): calcular  
    - se `outcome === side` → ganho = `shares * 1 - amountUsd` (ou P&L líquido);  
    - senão → perda = `amountUsd`.  
  - Mostrar: “Nesta rodada: +$X” ou “−$Y” num bloco de resolução.

- **B) Conta anónima (ex.: deviceId):**  
  - Backend guarda trades por `deviceId`.  
  - Permite histórico entre sessões e vários dispositivos (se sincronizar o id).  
  - Exige persistência (DB) e algum desenho de privacidade.

- **C) Auth (Wallet, email, etc.):**  
  - Posições e histórico atrelados à identidade.  
  - Necessário para payout real (sBTC, etc.).

Para o **fit** actual do produto, **A) é suficiente** para “o user ver o que ganhou” no MVP.

---

### 2.2 Momento de resolução e transição de rodadas

**Problema:** O resultado da rodada N é efémero ou invisível; a seguir aparece só a rodada N+1. Parece que “a pool foi imendada” noutra sem fechar o ciclo da anterior.

**Princípio:**  
Cada rodada deve ter um **ciclo fechado e visível**:  
*Apostar → (opcional: acompanhar) → Resolver → Ver resultado (e P&L) → Próxima rodada.*

**Proposta de fluxo:**

1. **Fase 1 — Resolução (3–8 s)**  
   - Countdown chega a 0.  
   - Estado: `RESOLVING` (ou equivalente).  
   - UI: mensagem clara, ex.: “A resolver… a verificar preço de fecho.”  
   - Evita: “saltar” directo para a nova rodada sem explicar o que aconteceu.

2. **Fase 2 — Ecrã (ou secção) de resultado da rodada N**  
   - Mostrar de forma estável (não substituída em 1–2 segundos):
     - “Rodada [HH:MM] terminou”
     - Resultado: **UP** ou **DOWN** (destaque visual)
     - Preço abertura → preço fecho (ex.: $97 000 → $97 200)
     - Opcional: volume da pool (ex.: total comprado em UP/DOWN)
   - **Se** houver posições do user (MVP: localStorage):  
     - “A tua posição: X UP, Y DOWN”  
     - “Ganhaste +$Z” ou “Perdeste $W”  
   - CTA: “Próxima rodada já começou” ou “Apostar na próxima” que leva o foco para a nova rodada.

3. **Fase 3 — Nova rodada (N+1)**  
   - Card principal volta a ser o “mercado activo” da rodada N+1 (preço de abertura, countdown, UP/DOWN, input).  
   - A rodada N pode passar a aparecer em **histórico** (lista, timeline ou “últimas rodadas”) em vez de no card principal.

**Sobre “imendar” a pool na próxima:**  
- **Não** unir liquidez (reservas) entre rodadas: cada minuto é um contrato binário que resolve. Mantém a semântica clara e a lógica do AMM simples.  
- **Sim** “imendar” no sentido de **narrativa e layout**:  
  - Uma **timeline** ou **feed** (ex.: “Rodada 12:33 — UP | 12:34 — DOWN | 12:35 — a decorrer”)  
  - O **bloco de resolução** da rodada N visível **antes** de o foco ir todo para N+1.  
Isto dá a sensação de “uma sequência de mercados”, não de “uma pool que se desliga e liga” sem fecho.

---

### 2.3 Consistência e clareza da pool

**Pool por rodada:**  
- Cada rodada = uma pool nova 50/50.  
- No fim: os vencedores recebem $1/share; os perdedores 0. A pool “fecha” nessa rodada.  
- Isto é **consistente** com o desenho (binário, 1 minuto, AMM por mercado).

**O que pode confundir:**  
- Se a UI não deixar explícito “esta é a rodada [X], que começou em [T] e termina em [T+60s]”, pode parecer que é “a mesma” pool a mudar de preço.  
- Mitigação: **sempre** mostrar um **ID ou instante da rodada** (ex.: “Rodada 12:34” ou “Minuto 12:34”) no header do card.

**Resumo:**  
- **Não** mudar a regra “uma pool por rodada”.  
- **Melhorar** a explicitação da rodada e a forma como mostramos o fecho e a passagem para a próxima.

---

### 2.4 Durante o minuto: feedback e posição

- **Último trade:**  
  - “Último: X UP @ Y¢” é útil, mas insuficiente se o user fizer vários.  
  - Ideal: **posição acumulada** na rodada: “UP: 120 (≈ $62) | DOWN: 50 (≈ $24)”.

- **Input e confirmação:**  
  - Antes de comprar: preview “Recebes ~Z shares” (já há `estimateShares` no AMM).  
  - Após compra: feedback imediato e claro (“+Z UP @ W¢”) e actualização da posição.

- **Preço BTC em tempo real:**  
  - Já existe. Pode ser reforçado com uma mini indicação de tendência (ex.: “+0.1% desde o início da rodada”) para dar contexto.

---

## 3. Fit do produto em alto nível

### 3.1 Proposta de posicionamento

> **Bitpredix** é o prediction market de **1 minuto** sobre o preço do Bitcoin. Apostas UP/DOWN, resolução automática e clara. O utilizador deve **saber sempre** em que rodada está, o que apostou, e **o que ganhou ou perdeu** assim que a rodada resolve.

### 3.2 Princípios de experiência

1. **Clareza da rodada:**  
   - Em cada ecrã relevante: qual a rodada (ID/tempo), se está a apostar, a resolver ou já resolvida.

2. **Ciclo fechado por rodada:**  
   - Apostar → (se possível: ver posição) → Resolução breve → **Ver resultado e P&L** → Próxima rodada.  
   - O “ganhei/perdi” é um momento **explícito**, não implícito.

3. **Continuidade entre rodadas:**  
   - Transição **narrativa** (resultado N → “próxima: N+1”), não só técnica (substituir o objeto da API).  
   - Histórico ou feed opcional para ver últimas resoluções.

4. **Simplicidade primeiro:**  
   - Uma decisão por minuto (UP/DOWN). Posição e P&L claros. Sem imendar liquidez entre pools; “imendar” apenas a história que contamos ao user.

### 3.3 Jornada-alvo (alto nível)

```
Entrar → Ver rodada actual (ID, countdown, preço abertura, UP/DOWN)
    → [Opcional: ver “minha posição” na rodada]
    → Apostar (com preview de shares) → Ver confirmação e posição actualizada
    → Countdown a 0 → “A resolver…”
    → Ecrã/secção de RESULTADO: UP/DOWN, preço abertura/fecho, “Ganhaste +$X” / “Perdeste $Y”
    → “Próxima rodada” / foco na nova rodada
    → Repetir
```

### 3.4 O que NÃO fazer (para manter o fit)

- **Não** fundir reservas de rodadas diferentes (complexidade e semântica confusa).  
- **Não** esconder o resultado da rodada N atrás da rodada N+1.  
- **Não** manter apenas “último trade” como representação da posição; evoluir para “posição na rodada”.  
- **Não** fazer o “próxima rodada” aparecer sem uma fase clara de resolução (mesmo que curta).

---

## 4. Resumo: priorização de melhorias

| # | Melhoria | Impacto | Esforço | Prioridade |
|---|----------|---------|---------|------------|
| 1 | **Ecrã / secção de resolução** (resultado da rodada N visível; preço abertura/fecho; UP/DOWN) | Alto | Médio | P0 |
| 2 | **Posições na sessão** (localStorage: trades por rodada; mostrar “posição: X UP, Y DOWN” e **P&L na resolução**) | Alto | Médio | P0 |
| 3 | **Fase RESOLVING** (countdown 0 → “A resolver…” 3–5 s → resultado) e **transição** clara para a nova rodada | Alto | Baixo | P0 |
| 4 | **ID/instante da rodada** sempre visível no card (ex.: “Rodada 12:34”) | Médio | Baixo | P1 |
| 5 | **Preview “Recebes ~Z shares”** no input antes de comprar | Médio | Baixo | P1 |
| 6 | **Histórico / feed de rodadas** (últimas N com resultado) para sensação de continuidade | Médio | Médio | P1 |
| 7 | **Indicador de tendência** na rodada (ex.: “+0.05% desde abertura”) | Baixo | Baixo | P2 |

---

## 5. Conclusão

- O problema central não é “imendar” a liquidez de uma pool na outra; é **fechar o ciclo** de cada rodada (resolução + P&L) e **ligar** rodadas pela **narrativa** (resultado N → próxima N+1).  
- Para o user “acompanhar o que está a acontecer” e “ver o que ganhou”, é essencial:  
  1. **Posições** (mínimo: em sessão/localStorage) por rodada.  
  2. **Momento de resolução** dedicado (fase RESOLVING + bloco de resultado com P&L).  
  3. **Transição** explícita para a próxima rodada, sem apagar o resultado da anterior.  
- O produto “fitta” em alto nível como um **prediction market de 1 minuto, bitcoin, com ciclo claro por rodada e P&L visível**, mantendo uma pool independente por minuto e “imendando” apenas a experiência entre rodadas (fluxo e história).

---

*Documento base para decisão de roadmap e refinamento de UX. Próximo passo: desenho de fluxo (wireframes) e implementação de P0.*
