# GitHub Projects — Acompanhar o Bitpredix sem precisar de código

O **GitHub Projects** é um quadro (tipo Kanban) onde você vê tarefas, sprints e progresso. Ideal para o **Douglas** (coordenador) e **Gerson** (investidor) acompanharem o desenvolvimento.

---

## 1. Criar o Project

1. Abra o repositório: **https://github.com/LimaDevBTC/bitpredix**
2. Clique na aba **Projects** (ou em **Projects** no menu do repo).
3. **Create a project** → escolha **Board** (quadro com colunas).
4. Nome sugerido: **Bitpredix MVP**.
5. Clique em **Create**.

---

## 2. Configurar colunas (status)

Sugestão de colunas:

| Coluna | Significado |
|--------|-------------|
| **Backlog** | A fazer |
| **Sprint 1** … **Sprint 6** | Tarefas do contrato por sprint |
| **In progress** | Em desenvolvimento |
| **Done** | Concluído |

Você pode usar só **Todo** | **In progress** | **Done** se preferir algo mais simples.

---

## 3. Criar Issues a partir do contrato

As **issues** são as “tarefas” do projeto. Cada entregável do contrato vira uma issue. Assim, você acompanha tudo pelo Project sem mexer em código.

### Como criar uma issue

1. No repositório, aba **Issues** → **New issue**.
2. **Title:** use os títulos abaixo (ou parecidos).
3. **Description:** pode colar o trecho do contrato ou um resumo.
4. **Labels:** crie e use, por exemplo:
   - `sprint-1`, `sprint-2`, … `sprint-6`
   - `contract` (entregável do contrato)
5. **Create issue**.

### Issues sugeridas para Sprint 1 (Foundation)

| # | Título | Label | Status no contrato |
|---|--------|-------|--------------------|
| 1 | [Sprint 1] Setup do repositório | `sprint-1` | ✅ Feito |
| 2 | [Sprint 1] CI/CD e ambiente | `sprint-1` | ✅ Feito |
| 3 | [Sprint 1] Design system (dark mode premium) | `sprint-1` | ✅ Feito |
| 4 | [Sprint 1] Estrutura base do smart contract | `sprint-1` | ✅ Feito |
| 5 | [Sprint 1] Frontend inicial (layout + rotas) | `sprint-1` | ✅ Feito |

Crie essas 5 issues. As que já estão feitas podem ser marcadas como **Done** no Project.

### Issues para Sprints 2–6 (backlog)

Use o **CONTRACT.md** como referência. Exemplos:

- `[Sprint 2] create-round no contrato Clarity`
- `[Sprint 2] place-bet no contrato Clarity`
- `[Sprint 2] resolve-round e claim-winnings`
- `[Sprint 2] Integração com oráculo`
- `[Sprint 2] 100% cobertura de testes`
- `[Sprint 2] Wallet connection no frontend`
- `[Sprint 3] Schema do banco`
- … e assim por diante para os itens do contrato.

---

## 4. Ligar Issues ao Project

1. Abra o **Project** (quadro) que você criou.
2. **Add item** (ou **+ Add**) → **Issue**.
3. Selecione o repositório **bitpredix** e escolha a issue.
4. Arraste o cartão entre as colunas (ex.: **Backlog** → **Sprint 1** → **In progress** → **Done**).

Sempre que uma issue for concluída, mova para **Done**. Assim todos veem o progresso.

---

## 5. Acompanhar sem código

- **Quadro:** veja o que está em cada coluna (Todo, Em progresso, Done).
- **Issues:** leia título e descrição; não é preciso abrir o código.
- **Filtros:** use labels `sprint-1`, `sprint-2`, etc. para ver só o que interessa.
- **Milestones:** opcional. Crie um milestone **Sprint 1**, **Sprint 2**, etc. e associe as issues.

---

## 6. Resumo rápido

1. **Projects** → criar quadro **Bitpredix MVP**.
2. **Issues** → criar uma issue por entregável do contrato (começar pelo Sprint 1).
3. **Add item** no Project → adicionar as issues ao quadro.
4. Mover os cartões entre colunas conforme o andamento.

Assim, o desenvolvimento fica visível e organizado para toda a equipe, sem precisar de informações sobre código.
