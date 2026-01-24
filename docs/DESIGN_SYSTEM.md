# Design System — Bitpredix

Dark mode premium para o prediction market. Uso consistente de cores, tipografia e espaçamentos.

---

## Cores

| Nome | Hex | Uso |
|------|-----|-----|
| **Bitcoin** | `#F7931A` | CTA, preço BTC, destaques |
| **Bitcoin dark** | `#E68A00` | Hover/states |
| **UP** | `#22C55E` | Previsão UP, ganhos, positiva |
| **DOWN** | `#EF4444` | Previsão DOWN, perdas, negativa |
| **Background** | `#09090B` (zinc-950) | Fundo principal |
| **Surface** | `zinc-900` | Cards, modais |
| **Border** | `zinc-800` | Bordas |
| **Muted** | `zinc-500` | Texto secundário |
| **Foreground** | `zinc-100` / `zinc-400` | Texto principal |

### CSS vars (`app/globals.css`)

```css
--bitcoin: #f7931a;
--up: #22c55e;
--down: #ef4444;
--bg: #09090b;
--fg: #f4f4f5;
```

### Tailwind

`bitcoin`, `up`, `down` em `tailwind.config.ts`. Demais tons via `zinc-*`.

---

## Tipografia

- **Sans:** Outfit (Google Fonts), fallback `system-ui`, `sans-serif`
- **Mono:** JetBrains Mono, Fira Code — preços, IDs, valores

Tamanhos: `text-xs` a `text-4xl`. Títulos em `font-semibold` / `font-bold`.

---

## Espaçamento e layout

- **Container:** `max-w-2xl mx-auto px-4 py-8 sm:py-12`
- **Cards:** `rounded-xl` ou `rounded-2xl`, `border border-zinc-800`, `p-4` a `p-8`
- **Gaps:** `gap-2`, `gap-4`, `space-y-2` a `space-y-6`

---

## Componentes de referência

| Componente | Estilo |
|------------|--------|
| Botão primário | `bg-bitcoin/20 border border-bitcoin/40 text-bitcoin hover:bg-bitcoin/30` |
| Botão neutro | `bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700` |
| Card | `rounded-xl border border-zinc-800 bg-zinc-900/50` ou `bg-zinc-900/80` |
| Input | `bg-zinc-800/80 border border-zinc-700 rounded-xl` |
| Badge UP | `bg-up/10 text-up border border-up/20` |
| Badge DOWN | `bg-down/10 text-down border border-down/20` |

---

## Padrão de fundo

`.bg-grid-pattern`: grid sutil em tons de bitcoin (`rgba(247,147,26,0.03)`), 32×32px.

---

## Animações

- **fadeIn / scaleIn:** modais
- **pulseDot:** bolinhas do gráfico
- **animate-pulse:** countdown urgente (últimos 10s)

---

## Responsividade

Breakpoints Tailwind: `sm:` (640px), `md:`, `lg:`. Mobile-first. Gráficos e painéis ajustam com `flex`, `grid` e `gap`.

---

## Checklist de uso

- [ ] Usar apenas cores do design system
- [ ] Preferir `font-mono` para números e IDs
- [ ] Manter contraste acessível (texto em zinc-300 a zinc-100 sobre fundos escuros)
- [ ] Garantir que novos componentes sigam `rounded-xl`, `border-zinc-800` e espaçamentos acima
