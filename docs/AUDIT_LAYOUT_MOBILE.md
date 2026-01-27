# Auditoria de layout — mobile (ajuste “tudo numa tela”)

Objetivo: ver do gráfico do Bitcoin até o campo de valor da aposta sem scroll.

---

## Viewport de referência

- Mobile: ~568–700px de altura útil (após barra do browser, etc.)
- Meta: caber em ~600–640px o bloco [Bitcoin chart → MarketCard → UP/DOWN + amount]

---

## Blocos e alturas (antes)

| Bloco | Classe / valor | Altura aprox. (mobile) |
|-------|----------------|------------------------|
| Gráfico Bitcoin | `h-[380px]` + `mb-6` | 380 + 24 = 404px |
| MarketCard header | `py-3` + conteúdo 3 linhas | ~72px |
| Mensagens | `h-20` + `mb-4` | 80 + 16 = 96px |
| Gráfico das apostas | `h-56` + `p-4` | 224px (h-56 já com box-sizing) |
| Gap chart ↔ botões | `space-y-4` | 16px |
| UP/DOWN + Amount | `py-3`, `min-h-[8rem]`, presets, input | ~220px |
| Padding do card | `p-4` | 16×2 = 32px (acima/abaixo do bloco) |

Total (só do Bitcoin ao fim do amount): ~380 + 24 + 72 + 96 + 224 + 16 + 220 + 32 ≈ **1064px** → precisa scroll.

---

## Ajustes propostos (mobile first)

| Bloco | Antes | Depois | Economia |
|-------|--------|--------|----------|
| Gráfico Bitcoin | 380px, mb-6 | 340px, mb-4 | 60px |
| MarketCard header | py-3 | py-2.5 | ~8px |
| Padding conteúdo | p-4 | p-3 | 8px |
| Mensagens | h-20, mb-4 | h-16, mb-3 | 24px |
| Gráfico apostas | h-56, p-4 | h-44, p-3 | 48px (altura) + 8px (padding) |
| Gap chart↔botões | space-y-4 | space-y-3 | 4px |

Total estimado: ~**160px** em mobile.

---

## Gráfico do Bitcoin em mobile

- **Risco:** abaixar demais piora leitura (timeframes, OHLC, volume).
- **Proposta:** 380px → **340px** só em mobile; sm+ mantém 400–420px.
- **Fallback:** se 340px for pouco, subir para 360px (ainda -20px).

---

## Gráfico das apostas

- `h-56` (224px) → `h-44` (176px) em mobile; `h-52` em sm; lg/xl inalterados.
- Legenda, eixos e tooltip continuam; Recharts escala. Se ficar apertado, `h-48` (192px) é meio-termo.

---

## Área de mensagens

- `h-20` (80px) dá folga para “Your shares” (várias linhas), erro + botão, “Market open” em 2 linhas.
- `h-16` (64px): ainda cabe 2–3 linhas com `text-sm`/`text-xs` e `leading-tight`. Em erro, o botão “Try again” pode quebrar; manter `flex` e `shrink-0` no botão.

---

## Resumo das alterações (implementadas)

- **page.tsx:** Bitcoin `h-[340px] sm:h-[400px]`, `mb-4 sm:mb-6`.
- **TradingViewBtcChart:** `minHeight` 280 (para não forçar > 340 no pai).
- **MarketCard:** header `py-2.5 sm:py-3.5`; conteúdo `p-3 sm:p-6`; mensagens `h-16 mb-3`; `space-y-3 sm:space-y-4`.
- **PriceChart:** `h-44 sm:h-52 lg:h-60 xl:h-64`, `p-3 sm:p-4`.

---

*Atualizado em 27/01/2026*
