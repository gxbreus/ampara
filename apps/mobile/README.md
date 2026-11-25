# App Mobile

Cliente dos adotantes em web responsiva (React + Vite + TanStack Query), conforme #200/#203.
Consome `/mobile/v1` e `/auth/v1` pelo gateway, separado do App Web (RA-10/RA-11).

## Rodar

Em `apps/`, execute `npm ci` e `npm run dev:mobile` para abrir `http://localhost:5174`.
No celular na mesma rede, use `npm run dev -w mobile -- --host` e abra o IP do
computador na porta 5174. O proxy do Vite usa o gateway `http://localhost:8000`;
para trocar, defina a variável de processo `AMPARA_GATEWAY` antes de iniciar.

## Telas e rotas

| Tela | Caminho | Integração padrão |
| --- | --- | --- |
| Busca por raio | `/` | Real: `GET /mobile/v1/animais` |
| Ficha pública | `/animais/:id` | Real: `GET /mobile/v1/animais/{id}` |
| Pedidos e linha do tempo | `/pedidos`, `/pedidos/:id` | Real: `/mobile/v1/solicitacoes`; cancelamento segue `_links.cancelar` |
| Avisos | `/avisos` | Simulado até #60 |
| Perfil de adoção | `/perfil` | Real: `/mobile/v1/eu` e `/mobile/v1/eu/perfil-adocao` |
| Assistente | `/assistente` | Real pelo BFF; RAG e recomendações dependem de #67/#68 |
| Entrar / Criar conta | `/entrar`, `/cadastro` | Real: `/auth/v1/*` na Identidade |

## Integração e verificação

Crie uma conta na Identidade antes de entrar. Contas do antigo login de
desenvolvimento não são persistidas no banco. Esse login local só é habilitado
com a variável de processo `VITE_AUTH_REAL=false`; não use esse modo para ensaiar
perfil ou SAGA com a Identidade real.

`VITE_ROTAS_REAIS` seleciona os grupos de `src/api/servicos.ts`; `nenhuma` usa
dados simulados e `todas` exige todos os serviços implementados. A tela identifica
a origem dos dados. Consulte também [../compartilhado/README.md](../compartilhado/README.md).

O Assistente usa contingência quando o serviço está indisponível. Erros de entrada
e rotas ausentes aparecem na tela. Recomendações usam localização e raio da última
busca feita nesta sessão; após recarregar diretamente no Assistente, faça uma busca.
O BFF converte `descricaoRotina` em `rotina`, `origem` em `paginaOuSecao` e
`sugestoes[].motivo` em `animais[].motivoRecomendacao`, sem metadados internos.

Em `apps/`, execute `npm run typecheck` e `npm run build` para verificar ambos os
clientes. O ensaio real deve conferir busca, ficha, pedido, linha do tempo,
cancelamento, perfil salvo após recarregar e Assistente disponível/indisponível.
Se a ficha complementar falhar, o pedido mantém a linha do tempo e exibe um aviso.
A compilação não substitui esse ensaio.
