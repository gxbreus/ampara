# Parte 4: roteiro dos dois BFFs

Roteiro da demonstração dos dois *Backends for Frontends* (requisitos **RA-10** e **RA-11**, critério `E-4.4`): por que existe um BFF para cada cliente e a prova, ao vivo, de que eles respondem coisas diferentes para o mesmo animal. Duração: **cerca de 8 minutos**.

- **Quem fala:** Mateus (dono do BFF Web) abre e conduz os blocos 1 a 3. Gabriel Cantanhede (dono do BFF Mobile) conduz os blocos 4 e 5. Mateus fecha com o bloco 6 e as perguntas.
- **Números:** todos foram medidos em 25/11 no cluster kind, pelo gateway, com login real nas contas da demo. Variam um pouco com os dados (fotos, pedidos), mas a proporção se mantém.
- **Comandos:** usam o gateway em `localhost:8000` (Ingress do kind). No Codespace com compose, troque por `8080` (`AMPARA_GATEWAY=http://localhost:8080` no script).

## 0. Antes da apresentação (checklist)

```bash
# tudo 1/1 Running
kubectl get pods -n ampara

# contas e animais da demo (idempotente: pode rodar de novo)
./scripts/seed.sh k8s

# a comparação tem que sair sem erro; se sair, a demo está pronta
./scripts/comparar-bffs.sh Thor
```

Deixe abertos, nesta ordem:

1. **Painel web** (`http://localhost:5173`) logado como `ong@ampara.dev`, na ficha do **Thor**.
2. **App do adotante** (`http://localhost:5174`, DevTools em modo celular, 390 px) logado como `adotante@ampara.dev`, na ficha do **Thor**.
3. **Terminal** na raiz do repositório, com fonte grande.

> As senhas das contas são a `SEED_SENHA_DEMO` do `.env`. Para os apps usarem o login real, rode-os com `VITE_AUTH_REAL=true` (detalhes em `apps/compartilhado/README.md`).

## 1. O problema: dois públicos, necessidades opostas (1 min)

**Fala:** "A Ampara tem dois clientes que olham para o mesmo animal com objetivos opostos. A ONG, no painel web, precisa de **tudo**: onde o animal está, o histórico de status e quem pediu a adoção, com o perfil de cada pessoa, para decidir. O adotante, no celular, precisa de **pouco e rápido**: foto, distância, porte e o estado do **próprio** pedido. E ele **não pode** ver o endereço do abrigo nem os dados de outros adotantes. Um endpoint único teria que escolher: ou mandava dados pessoais de terceiros para o celular, ou obrigava o painel a fazer dezenas de chamadas por tela. Por isso, um BFF para cada cliente."

**Mostrar:** o diagrama de componentes em `docs/arquitetura.md`: App Web → Kong `/web/v1` → BFF Web; App Mobile → Kong `/mobile/v1` → BFF Mobile.

## 2. O gateway separa os dois mundos (1 min)

**Fala:** "Os dois BFFs ficam atrás do Kong, cada um com a sua política."

| | `/web/v1` → BFF Web | `/mobile/v1` → BFF Mobile |
| --- | --- | --- |
| Autenticação no Kong | JWT obrigatório em tudo | busca pública sem JWT; o resto com JWT |
| Quem pode (verificado no BFF) | PROTETOR, ONG e ADMIN | ADOTANTE |
| Rate limit | 300/min | 600/min (mais usuários, mais leituras) |
| Serviços que agrega | Animais (escrita), Adoção, Identidade | Animais (leitura, CQRS), Adoção, Notificações, Assistente |

**Ao vivo:** o isolamento.

```bash
G=http://localhost:8000
SENHA=$(grep '^SEED_SENHA_DEMO=' .env | cut -d= -f2-)
token() { curl -s -X POST $G/auth/v1/sessoes -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"senha\":\"$SENHA\"}" | jq -r .accessToken; }
ONG=$(token ong@ampara.dev); ADOTANTE=$(token adotante@ampara.dev)

# sem token no painel: o Kong barra (401)
curl -s -o /dev/null -w '%{http_code}\n' $G/web/v1/animais
# adotante no painel: o BFF Web barra pelo papel (403, em problem+json)
curl -s $G/web/v1/animais -H "Authorization: Bearer $ADOTANTE" | jq
# ONG nas rotas do adotante: o BFF Mobile barra (403)
curl -s -o /dev/null -w '%{http_code}\n' $G/mobile/v1/solicitacoes -H "Authorization: Bearer $ONG"
# a busca do celular é pública (200), mesmo com um token inválido: degrada para anônimo
curl -s -o /dev/null -w '%{http_code}\n' "$G/mobile/v1/animais?lat=-21.2453&lng=-44.9998" -H 'Authorization: Bearer lixo'
```

**Esperado:** `401`, o 403 do painel com `"O painel web é exclusivo de protetores, ONGs e administradores."`, `403` e `200`.

## 3. Mesmo animal, duas telas (2 min)

**Ao vivo, lado a lado:** a ficha do Thor no painel e no app.

- **Painel (ONG):** endereço completo do abrigo (rua, número e CEP), histórico de status com "por você" × "pela SAGA", e os pedidos do animal com o perfil de cada adotante e os botões **Aprovar** e **Recusar**.
- **App (adotante):** foto grande, sexo, porte e idade, só o **bairro e a cidade**, a ONG com o selo "responsável verificado" e um único botão: **Quero adotar**.

**Fala:** "Os botões de Aprovar e Recusar não são decididos pelo front. Eles vêm dos links HATEOAS da resposta (`_links.aprovar`), e o BFF Web traduz os links da Adoção de `/v1/...` para `/web/v1/...`. Se a solicitação não está esperando decisão, o link não vem e o botão não aparece."

## 4. A prova em números (1,5 min) — *Gabriel Cantanhede*

```bash
./scripts/comparar-bffs.sh Thor
```

**Saída medida em 25/11 (Thor, sem pedidos):**

```
                                       BFF Web (ONG)   BFF Mobile (adotante)
  ficha completa (bytes)                        1089                     762
  item de lista / cartão (bytes)                   —                     322
  só no web    : endereco, fotoCapa, historicoStatus, localizacao, solicitacoes
  só no mobile : bairro, cidade, fotoThumb, minhaSolicitacao, responsavel
  onde o animal está
    web    : Rua Doutor Francisco Sales, 100 · Centro, Lavras/MG · lat -21.239, lng -44.996
    mobile : Centro, Lavras · 0.772 km de distância (sem rua, número nem coordenada)
```

**Fala:** "O web manda o endereço e a coordenada exata; o mobile manda só bairro, cidade e a **distância**, que o próprio BFF calcula a partir da busca geográfica. É LGPD aplicada no desenho da API. No celular, o cartão da busca tem **8 campos fixos** e o schema de resposta do Fastify corta qualquer campo extra: uma página de 20 animais fica em torno de 6 KB."

**Depois, um animal com pedido:**

```bash
./scripts/comparar-bffs.sh Bolt
```

**Fala:** "Com um pedido, a ficha do web cresce para cerca de **1,7 KB**: cada solicitação traz o adotante, o perfil dele e os links de ação. A do mobile continua em cerca de **780 bytes**, porque o adotante só vê a própria solicitação (`minhaSolicitacao`). Quanto mais gente pede um animal, maior a diferença."

| Medido em 25/11 | Web (ONG) | Mobile (adotante) |
| --- | --- | --- |
| Ficha, sem pedidos (Thor) | 1.089 B | 762 B |
| Ficha, 1 pedido (Mel / Bolt) | 1.504 / 1.695 B | 760 / 781 B |
| Item de lista / cartão | 332 B (resumo) | 322 a 337 B (cartão) |

## 5. Agregação sem N+1 (1 min) — *Gabriel Cantanhede*

**Fala:** "Cada BFF faz **no máximo uma chamada por serviço por tela**. Na lista de solicitações do painel, o BFF Web pede a página à Adoção e depois **uma única** chamada em lote à Identidade (`/v1/contas?ids=...&incluir=perfil`) e outra a Animais (`/v1/animais?ids=...`). Com 20 pedidos são 3 chamadas internas, e não 41. No celular, a busca logada faz **uma** chamada à Adoção para preencher o `minhaSolicitacao` de todos os cartões de uma vez."

**Mostrar (opcional):** `bff/web/src/solicitacoes.ts`, função `complementos`, com o `Promise.all` das duas chamadas em lote.

## 6. Falha parcial: cada BFF degrada do seu jeito (1,5 min)

**Fala:** "Cada rota tem um serviço **essencial** e serviços **complementares**. Se cai um complementar, a rota responde 200 com o que conseguiu e diz o que faltou em `avisos[]`. Se cai o essencial, a rota responde 503. Nunca 500 por culpa de outro serviço. E como cada BFF depende de serviços diferentes, a mesma queda afeta os dois clientes de formas diferentes."

**Identidade fora:** ela é complementar no painel e nem é usada na busca.

```bash
MEL=$(curl -s $G/web/v1/animais -H "Authorization: Bearer $ONG" | jq -r '.itens[] | select(.nome=="Mel") | .id')
kubectl scale deploy/identidade -n ampara --replicas=0
# web: 200, adotante null e o aviso (medido: resposta em 26 ms)
curl -s $G/web/v1/animais/$MEL -H "Authorization: Bearer $ONG" | jq '{avisos, adotante: .solicitacoes[0].adotante}'
# mobile: nem percebe
./scripts/buscar-animais.sh
kubectl scale deploy/identidade -n ampara --replicas=2
```

> No **painel aberto**, a ficha da Mel ganha a faixa "**Resposta parcial.** Identidade está fora do ar. O resto da tela segue normal."; abrindo o pedido, o bloco "Quem pediu" mostra "Dados do adotante indisponíveis agora".
> **Atenção:** pegue os tokens (`ONG`, `ADOTANTE`) **antes** de derrubar a Identidade, porque é ela quem faz o login.

**Adoção fora:** complementar na busca do celular e essencial nas solicitações do painel.

```bash
kubectl scale deploy/adocao -n ampara --replicas=0
# mobile: 200, minhaSolicitacao null e um aviso
curl -s "$G/mobile/v1/animais?lat=-21.2453&lng=-44.9998&raioKm=20" -H "Authorization: Bearer $ADOTANTE" | jq '{avisos, primeiro: .itens[0].minhaSolicitacao}'
# web, solicitações: 503 "Adoção não respondeu."
curl -s $G/web/v1/solicitacoes -H "Authorization: Bearer $ONG" | jq
# web, painel: os animais aparecem, o bloco de solicitações vem null com aviso
curl -s $G/web/v1/painel -H "Authorization: Bearer $ONG" | jq
kubectl scale deploy/adocao -n ampara --replicas=2
```

**Medido em 25/11:**
- busca do mobile: 7 animais, `minhaSolicitacao: null` e o aviso `"Não foi possível consultar sua solicitação."`;
- solicitações do web: `503` em `problem+json`;
- painel do web: `"solicitacoes": null` com o aviso `{"servico":"adocao","motivo":"INDISPONIVEL"}`.

> No compose, troque `kubectl scale ... --replicas=0/2` por `docker compose stop identidade` e `docker compose start identidade`.

**Fecho (Mateus):** "Dois BFFs não são duplicação: cada um é a API **sob medida** para um cliente. Isso inclui o formato, a segurança, a agregação e o comportamento na falha. A diferença está no contrato de cada um (`docs/contratos/bff-web.v1.yaml` e `bff-mobile.v1.yaml`) e, campo a campo, em `docs/contratos/bff-comparacao.md`."

## Perguntas prováveis da arguição

- **"Por que não um BFF só, com um parâmetro `?cliente=mobile`?"** Porque a segurança e o contrato mudariam por parâmetro: o mesmo endpoint teria que saber esconder endereço e dados de terceiros quando o cliente pedisse. Com dois BFFs, o mobile **não tem como** devolver o endereço: o campo não existe no schema de resposta dele. Cada um também evolui, escala e tem rate limit próprio.
- **"BFF não é só um proxy?"** Não. Ele agrega (3 serviços numa resposta), traduz (GeoJSON `[lng, lat]` de Animais vira `{lat, lng}`; `_links` de `/v1` viram `/web/v1`), corta campos pelo schema e decide o que é essencial e o que é complementar numa falha.
- **"Onde fica a regra de negócio?"** Nos serviços. O BFF não decide se uma adoção pode ser aprovada: ele só repassa o link que a Adoção mandou. Se o BFF cair, nenhuma regra se perde.
- **"Por que o mobile lê da projeção (CQRS) e o web do modelo de escrita?"** O adotante faz busca geográfica com muito volume, e a projeção `animais_busca` tem índice `2dsphere` e dados desnormalizados. A ONG precisa do dado exato e atual para editar, então lê o modelo de escrita. A defasagem do CQRS (alguns segundos) só aparece para o adotante, e o campo `atualizadoEm` mostra isso.
- **"Como o BFF sabe quem é o usuário?"** Pelo JWT RS256 que a Identidade assina. O Kong confere a assinatura, o BFF confere de novo e checa o papel, e o serviço decide sobre o recurso (três camadas). O BFF só conhece a chave **pública**.

## Limitações conhecidas (para não ser pego de surpresa)

- **Formato dos avisos:** no web, `avisos[]` traz objetos (`{servico, motivo}`); no mobile, textos prontos para exibir. É intencional, porque o celular mostra o texto direto, mas os contratos documentam formatos diferentes.
- **Miniatura no mobile:** o `fotoThumb` é a mesma URL da foto inteira, porque o serviço de Animais ainda não gera miniaturas. O campo existe para quando gerar.
- **Política da #87:** o BFF Mobile ainda não tem retry com jitter nem circuit breaker; o contrato descreve a política, mas o código só tem timeout.

## Plano B

- **Cluster fora do ar:** use os números e as saídas deste roteiro (medidos em 25/11) e mostre os contratos e o `bff-comparacao.md`.
- **Login falhou:** rode `./scripts/seed.sh k8s` de novo; ele devolve as contas da demo ao estado original.
- **Os apps não abrem:** a comparação e o isolamento (blocos 2, 4 e 6) são todos pelo terminal.
- **A Mel ou o Bolt sumiram do painel:** o `comparar-bffs.sh` aceita qualquer animal da ONG (`Paçoca`, `Thor`, `Luna`…). Para ter um pedido, faça um pela tela do adotante antes da aula.
