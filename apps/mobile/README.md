# App Mobile

Cliente dos **adotantes**, feito como web responsiva (mobile-first). A decisão 6 de [`docs/requisitos.md`](../../docs/requisitos.md) trocou o Expo por ela. Oferece busca por raio, ficha do animal, pedido de adoção com a linha do tempo da SAGA, cancelamento, avisos, perfil de adoção e assistente. Fala só com o gateway, em `/mobile/v1` e `/auth/v1`, e continua sendo um cliente separado do App Web, com outro BFF (RA-10 e RA-11).

**Stack:** React + Vite + TanStack Query · **Responsável:** Mateus · **Issues:** #64, #65 (telas) e #199 (integração)

## Rodar

```bash
cd apps
npm install            # uma vez
npm run dev:mobile     # http://localhost:5174 (no desktop aparece como um aparelho)
```

Para abrir no celular na mesma rede: `npm run dev:mobile -- --host` e acesse o IP da máquina na porta 5174. Contas de teste e a chave real/simulado estão em [`../compartilhado/README.md`](../compartilhado/README.md).

## Telas e rotas

| Tela | Caminho | Rota do BFF | Hoje |
| --- | --- | --- | --- |
| Busca por raio (pública) | `/` | `GET /mobile/v1/animais` | **real** |
| Ficha do animal (pública) | `/animais/:id` | `GET /mobile/v1/animais/{id}` | simulado, montado com o cartão real da busca (#62) |
| Pedidos e linha do tempo | `/pedidos`, `/pedidos/:id` | `POST/GET /mobile/v1/solicitacoes`, `GET …/{id}`, `GET …/linha-do-tempo`, `POST …/cancelamento` | simulado (#62); a SAGA simulada avança sozinha |
| Avisos | `/avisos` | `GET /mobile/v1/notificacoes`, `POST …/leitura`, `POST …/leitura-todas` | simulado (#60) |
| Perfil | `/perfil` | `GET /mobile/v1/eu`, `GET/PUT /mobile/v1/eu/perfil-adocao` | simulado (#149) |
| Assistente | `/assistente` | `POST /mobile/v1/assistente/perguntas`, `…/recomendacoes` | simulado (#67, #68) |
| Entrar / Criar conta | `/entrar`, `/cadastro` | `/auth/v1/*` | real (login de dev até a #149) |
