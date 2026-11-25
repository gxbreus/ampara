# apps/compartilhado

Código comum aos dois clientes: o **App Web** (`apps/web`, painel de ONGs, protetores e admin) e o **App Mobile** (`apps/mobile`, web responsiva do adotante). Esta pasta não é um app e não tem `package.json` próprio. Os dois apps a importam pelo atalho `@c/...`.

```ts
import { http, criarRotas } from "@c/api";
import { Retrato, SeloEstado } from "@c/ui";
```

O atalho vem de `resolve.alias` em `vite.config.ts` e de `paths` em `tsconfig.json`. Para os pacotes (React, Vite) serem encontrados a partir daqui, `apps/` é um **npm workspace**: o `npm install` roda em `apps/` e cria um único `apps/node_modules`.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| `api.ts` | Cliente HTTP (`http()`): token Bearer, erros `application/problem+json` viram `ErroApi`, 401 com sessão guardada dispara o logout. `criarRotas()` liga cada grupo de rotas ao backend ou à simulação. Também guarda o vocabulário comum: estados da SAGA, status do animal, espécies, portes e datas. |
| `ui.tsx` | Componentes comuns: `Selo`, `SeloEstado`, `SeloStatus`, `Avisos` (falha parcial dos BFFs), `Erro`, `Carregando`, `Vazio`, `LinhaDoTempo` (os "carimbos" da SAGA), `Retrato` (desenho do animal quando não há foto) e `Origem` (selo real/simulado). |
| `sessao.tsx` | `SessaoProvider` e `useSessao()`: token e conta no `localStorage`, logout quando o token expira e filtro por papel (o web aceita ONG, PROTETOR e ADMIN; o mobile, só ADOTANTE). |
| `base.css` | A identidade visual (tokens, tipografia, botões, campos, cartões, selos, animações, foco e `prefers-reduced-motion`). Cada app só acrescenta o próprio layout em `src/estilo.css`. |
| `marca.tsx` | A logo: `Simbolo` (o arco de abrigo com a pata) e `Logo` (símbolo + "ampara"). A versão em SVG para documentos está em `docs/assets/logo-ampara.svg`, e o favicon em `public/favicon.svg` de cada app. |
| `icones.tsx` | Ícones de traço único (24×24, traço 2) usados nos dois apps, no lugar de emojis. |
| `ganchos.ts` | `useTituloPagina` (título da aba por tela) e `useAvisoSaida` (avisa antes de fechar com formulário não salvo). |
| `dev-auth.ts` | Login de desenvolvimento, explicado abaixo. |

## Rotas reais × simuladas

Cada app agrupa as rotas do contrato do seu BFF em `src/api/servicos.ts`, e cada função decide sozinha entre a chamada real e a simulação (`src/api/mocks.ts`, montado a partir dos exemplos do OpenAPI). As telas não sabem a diferença. Cada tela mostra o selo `● real` ou `◌ simulado`, e a barra lateral do web lista todos os grupos.

O padrão de cada app fica em `PADRAO_REAIS` (`src/api/servicos.ts`) e pode ser trocado sem mexer em código:

```bash
VITE_ROTAS_REAIS=auth,solicitacoes npm run dev:web   # só estes grupos no backend
VITE_ROTAS_REAIS=todas npm run dev:mobile            # tudo no backend
VITE_ROTAS_REAIS=nenhuma npm run dev:web             # front sozinho, sem backend
```

**Integrar uma rota nova** é pôr o grupo dela em `PADRAO_REAIS`, conferir a tela contra o backend e remover do mock o que ficou sem uso. As issues de integração são a #198 (web) e a #199 (mobile).

## Login de desenvolvimento (`dev-auth.ts`)

Enquanto a Identidade não tem as rotas de autenticação (#149), este plugin do Vite atende `POST /auth/v1/sessoes` e `POST /auth/v1/contas` no próprio servidor de desenvolvimento. Ele assina um **JWT RS256 com a `JWT_PRIVATE_KEY` do `.env` da raiz**, a mesma chave da Identidade. Por isso o Kong e os BFFs aceitam o token, e as rotas que já existem respondem de verdade.

- Roda só no `npm run dev` (`apply: "serve"`). O build de produção não o inclui.
- Sem a chave, responde 503 e pede para rodar `./scripts/gerar-chaves-jwt.sh`.
- Contas de teste (qualquer senha):

| E-mail | Papel | Observação |
| --- | --- | --- |
| `ong@ampara.dev` | ONG | mesmo id do seed de Animais, então vê os animais e pedidos reais |
| `protetor@ampara.dev` | PROTETOR | |
| `admin@ampara.dev` | ADMIN | libera a tela de verificação de contas |
| `adotante@ampara.dev` | ADOTANTE | para o App Mobile |

Quando a #149 entrar na `develop`, rode com `VITE_AUTH_REAL=true`: o plugin sai do caminho e o proxy manda `/auth/v1` para o gateway. Depois disso, o plugin pode ser apagado.

## Proxy

Os dois apps chamam o gateway pelo mesmo origin: `/auth/v1`, `/web/v1` e `/mobile/v1` passam pelo proxy do Vite até `http://localhost:8000` (o Kong, no compose ou no kind). Assim não há problema de CORS. Para outro endereço, use `AMPARA_GATEWAY=http://host:porta npm run dev:web`.

## Identidade visual

Direção: **sinalização de abrigo**, gráfica e calorosa, como as placas e adesivos de um abrigo moderno.

- **Logo:** um arco (casa e abraço ao mesmo tempo) com uma pata recortada. O arco é laranja; em fundo laranja, use `<Logo arco="var(--tinta)" pata="var(--laranja)" />`.
- **Cores:** `--laranja` #ff6a3d (marca, ações principais), `--tinta` #1e1b2e (texto, bordas), `--papel` #fff9f1 (fundo). Apoio: `--mel` #ffc145, `--verde` #1f8a5b, `--rosa` #ff8fa6. O `--lilas` #7f6cf0 fica reservado para o Assistente (IA). Estados: `--erro` e `--info`.
- **Tipografia:** Bricolage Grotesque nos títulos (`--display`), Onest no texto (`--texto`) e JetBrains Mono em código e selos técnicos (`--mono`). Todas vêm do npm (`@fontsource-variable/*`), sem depender de CDN na demo.
- **Assinatura:** cartões e botões com borda de tinta de 2px e sombra dura deslocada (`--sombra-dura`). Os botões afundam ao clicar.
- **Acessibilidade:** alvo de toque mínimo de 44px (`--toque`), foco visível em laranja, `--tinta-3` com contraste ≥ 4,5:1 no papel e animações desligadas com `prefers-reduced-motion`.
