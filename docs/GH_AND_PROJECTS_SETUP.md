# GitHub CLI + Projects — Para o assistente criar/editar Projects

O **GitHub CLI (`gh`)** está instalado em `~/.local/bin`. Com ele autenticado, o assistente consegue criar e editar **GitHub Projects** e **Issues** daqui (para o investidor acompanhar sprints e entregáveis).

---

## 1. Garantir que o `gh` está no PATH

No terminal, se `gh` não for encontrado:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Para tornar permanente, adicione essa linha ao `~/.bashrc` e execute `source ~/.bashrc`.

---

## 2. Autenticar no GitHub (só uma vez)

Rode no **seu** terminal (há que abrir o navegador ou colar um código):

```bash
gh auth login --web -h github.com -p https
```

- Escolha **GitHub.com**.
- Protocolo **HTTPS**.
- Vai abrir o navegador (ou mostrar um link + código). Entre na sua conta, autorize e volte ao terminal.

Confirme:

```bash
gh auth status
```

Deve aparecer algo como `Logged in to github.com as SEU_USUARIO`.

---

## 3. O que o assistente pode fazer depois

Com o `gh` autenticado, daqui o assistente pode:

1. **Criar** o Project **Bitpredix MVP** (quadro Kanban).
2. **Criar** as issues dos Sprints 1–6 (a partir do `SPRINT_DELIVERABLES.md`).
3. **Adicionar** as issues ao Project e **mover** entre colunas (ex.: Sprint 1 → Done).
4. **Editar** issues e o Project sempre que precisar.

Assim o investidor acompanha tudo em **GitHub → Projects**, sem mexer em código.

---

## 4. Resumo

| Etapa | Quem faz |
|-------|----------|
| Instalar `gh` | ✅ Feito (em `~/.local/bin`) |
| Autenticar (`gh auth login`) | **Você** (uma vez, no terminal) |
| Criar Project + Issues | **Assistente** (após auth) |

Depois de autenticar, diga ao assistente: *“gh está autenticado, cria o Project e as issues para o investidor acompanhar.”*
