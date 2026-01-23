# Bitpredix — Visão de Produto (Alto Nível)

## Posicionamento em uma frase

> **Bitpredix** é o prediction market de 1 minuto sobre o preço do Bitcoin: apostas UP/DOWN, resolução automática e **resultado e P&L sempre visíveis** para o utilizador.

---

## Princípios de experiência

| Princípio | O que significa |
|-----------|------------------|
| **Ciclo fechado** | Cada rodada tem um fim explícito: Apostar → Resolver → **Ver resultado e ganho/perda** → Próxima rodada. O user nunca fica sem saber “o que ganhei?”. |
| **Clareza da rodada** | Em todo o momento: qual a rodada (ex. 12:34), se está a decorrer, a resolver ou já resolvida. Uma pool por minuto; não misturar liquidez entre rodadas. |
| **Continuidade narrativa** | As rodadas “ligam-se” pela **história**: “Rodada 12:34 acabou: UP. A seguir, 12:35.” Não é uma sucessão técnica de pools, é uma sequência de mercados que o user acompanha. |
| **Simplicidade** | Uma decisão por minuto (UP ou DOWN). Posição e P&L compreensíveis. O AMM e as regras devem ser explicáveis em 2–3 linhas. |

---

## Jornada do utilizador (fit alvo)

```
Ver rodada actual (ID, countdown, preço abertura, UP/DOWN)
    → Ver minha posição na rodada (opcional mas recomendado)
    → Apostar (com preview de shares) → Confirmar e ver posição actualizada
    → Countdown a 0 → "A resolver…" (breve)
    → Ver RESULTADO: UP/DOWN, preço abertura→fecho, "Ganhaste +$X" ou "Perdeste $Y"
    → Ver que a "Próxima rodada" já começou e continuar a apostar
```

---

## O que NÃO queremos

- **Não** fundir reservas entre rodadas (cada minuto = um mercado que resolve).
- **Não** trocar a rodada N pela N+1 sem mostrar o **resultado** (e, quando houver, o P&L) da N.
- **Não** reduzir a “minha participação” ao “último trade”; o user deve poder ver **posição** e **resultado** por rodada.

---

## Pilares de produto (roadmap conceptual)

1. **Resolução e P&L visíveis** — Ecrã/bloco de resultado por rodada; cálculo e exibição de ganho/perda (MVP: posições em sessão).
2. **Transição entre rodadas** — Fase “A resolver” + resultado da N antes do foco total na N+1; histórico/feed opcional.
3. **Posição e preview** — Posição na rodada (UP/DOWN, valor); preview “Recebes ~X shares” antes de comprar.
4. **Continuidade e confiança** — ID da rodada sempre visível; histórico das últimas resoluções; depois: on-chain e identidade para payout real.

---

## Resposta direta: “imendar” as pools?

- **Liquidez:** não. Uma pool por rodada; no fim, resolve e “fecha”.  
- **Experiência:** sim. “Imendar” no sentido de **narrativa e fluxo**: resultado da rodada N visível, depois “próxima rodada” (N+1). O user acompanha o que está a acontecer e o que ganhou; as rodadas sentem-se como uma sequência, não como pools desconectadas.

---

*Documento de referência para decisões de produto e UX. Alinhado com `PRODUCT_ANALYSIS.md`.*
