# App Web

Painel de **protetores, ONGs e admin**: visão geral, cadastro e edição de animais, status manual, solicitações de adoção (aprovar e recusar seguindo os links HATEOAS da resposta) e verificação de contas. Fala só com o gateway, em `/web/v1` e `/auth/v1`.

**Stack:** React + Vite + TanStack Query · **Responsável:** Mateus · **Issues:** #63 (telas) e #198 (integração)

## Rodar

```bash
cd apps
npm install          # uma vez; instala web e mobile (npm workspaces)
npm run dev:web      # http://localhost:5173
```

O proxy do Vite manda `/auth/v1` e `/web/v1` para o gateway em `http://localhost:8000` (compose ou kind). Sem backend, rode com `VITE_ROTAS_REAIS=nenhuma`. Contas de teste, login de desenvolvimento e a chave real/simulado de cada rota estão em [`../compartilhado/README.md`](../compartilhado/README.md).

## Telas e rotas

| Tela | Caminho | Rota do BFF | Hoje |
| --- | --- | --- | --- |
| Entrar / Criar conta | `/entrar`, `/cadastro` | `POST /auth/v1/sessoes`, `/auth/v1/contas` | real (login de dev até a #149) |
| Visão geral | `/` | `GET /web/v1/painel` + solicitações pendentes | contadores simulados (#147), pendentes reais |
| Animais | `/animais`, `/animais/:id`, `/animais/novo`, `/animais/:id/editar` | `GET/POST /web/v1/animais`, `GET/PUT /web/v1/animais/{id}`, `PATCH …/status` | simulado (#147) |
| Solicitações | `/solicitacoes`, `/solicitacoes/:id` | `GET /web/v1/solicitacoes[/{id}]`, `POST …/aprovacao`, `POST …/recusa` | **real** |
| Verificar contas (admin) | `/admin/contas` | `GET /web/v1/admin/contas`, `PUT …/verificacao` | simulado (Identidade, #149) |

A barra lateral mostra, em "Integração das rotas", quais grupos estão ligados ao backend.
