# Parte 4: vídeo do caminho feliz, com telas e código

Vídeo de **cerca de 10 minutos** que acompanha um animal do cadastro até a adoção concluída,
passando pelos **dois BFFs**: a ONG usa o **App Web** (BFF Web) e a adotante usa o **App
Mobile** (BFF Mobile). A cada momento importante, o vídeo para e mostra **o trecho de código
que faz aquilo funcionar**, com as linhas-chave destacadas, enquanto o dono daquela parte
explica.

O vídeo é **gravado por um script** (`scripts/video/gravar.mjs`): ele conduz os dois apps lado
a lado, abre os painéis de código e escreve uma legenda por cena. **Vocês só narram por cima.**

- **O tempo de cada cena vem deste roteiro:** o gravador lê as falas abaixo e segura cada
  cena na tela pelo tempo da fala (cerca de 2,3 palavras por segundo, mais uma folga). Mudou
  uma fala, é só gravar de novo que o vídeo se ajusta.
- **Os trechos de código são lidos do repositório na hora da gravação**, achados por uma
  linha-âncora, então o vídeo mostra sempre o código atual.
- **Repetível:** cada gravação cria o seu animal e a sua adotante, sem mexer nos dados da demo.
- **Narração em quatro partes seguidas:** cada integrante narra um bloco contínuo, na ordem
  do caminho feliz, e grava **um vídeo só** com a parte dele. As partes seguem as áreas de
  cada um (`docs/planejamento.md` §4):

| Parte | Quem narra | Cenas | Assuntos | Tempo |
| --- | --- | --- | --- | --- |
| 1 | **Gabriel Soares** | 0a a 1c | abertura, arquitetura, login na Identidade, Kong e o papel no BFF Web | ~2 min |
| 2 | **Gabriel Cantanhede** | 2a a 4a | cadastro, outbox, CQRS, o cartão do BFF Mobile e as duas fichas | ~2min30 |
| 3 | **Mateus Vitor** | 5a a 6c | a SAGA, a máquina de estados, o pedido no painel, HATEOAS e a aprovação | ~2 min |
| 4 | **Gabriel Nakazato** | 7a a 9 | avisos e Notificações, o Assistente (RAG e ferramenta) e o encerramento | ~2min30 |

## 1. Gerar o vídeo

### Uma vez por máquina

```bash
cd scripts/video
npm install
npm run instalar        # baixa o Chromium do Playwright (~110 MB)
```

### A cada gravação

1. **O sistema no ar**, com as contas e os animais da demo:

   ```bash
   docker compose up -d && ./scripts/seed.sh          # ou: ./scripts/subir-k8s.sh && ./scripts/seed.sh k8s
   ```

2. **Os dois apps em modo dev**, cada um num terminal, apontando para o gateway
   (troque `8000` pela porta do seu gateway, se for outra):

   ```bash
   cd apps && AMPARA_GATEWAY=http://localhost:8000 VITE_AUTH_REAL=true npm run dev:web     # 5173
   cd apps && AMPARA_GATEWAY=http://localhost:8000 npm run dev:mobile                       # 5174
   ```

3. **Gravar:**

   ```bash
   cd scripts/video
   AMPARA_GATEWAY=http://localhost:8000 npm run gravar
   ```

   Em cerca de 11 minutos sai, em `scripts/video/saida/`:

   - `ampara-caminho-feliz-<data>.mp4`: o vídeo em 1920×1080, pronto para o editor;
   - o mesmo em `.webm` (o original do navegador);
   - `marcadores-<data>.txt`: o minuto em que cada cena começa e quem narra;
   - `falas-<data>.md`: as falas de cada integrante, com os minutos desta gravação.

4. **GIF do README** (o caminho feliz só com as telas, acelerado): `node gif.mjs` regrava
   `docs/assets/wireframe-caminho-feliz.gif` a partir da gravação mais recente.

| Variável | Para quê |
| --- | --- |
| `RITMO=1.8` | todas as cenas mais longas (padrão `1.5`). Use se a fala ficar apertada |
| `ANIMAL=Amora` | outro nome para o animal cadastrado no vídeo (padrão `Pipoca`) |
| `LEGENDA=nao` | grava sem a faixa de legenda |
| `MOSTRAR=sim` | abre o navegador na tela durante a gravação, para ensaiar |

**Se falhar:** o script diz em qual cena parou. As causas comuns são um app ou o gateway fora
do ar (ele confere antes de começar), um trecho de código que mudou de lugar (a mensagem diz
qual âncora sumiu; ajuste em `CODIGOS`, no começo do script) e o Assistente sem chave de LLM
(confira `docs/llm/provedores.md`; para a demo, `LLM_ORDEM=groq,principal,openrouter` no `.env`).

## 2. Gravar as falas e montar o vídeo final

Cada integrante grava **um vídeo no celular com a parte inteira dele**, lendo as falas das
cenas em sequência, e o vídeo final é montado por script, com o rosto de quem fala num
círculo na faixa de legenda e a voz como narração.

**As falas de cada um, prontas para gravar, estão em
[`falas-para-gravar.md`](falas-para-gravar.md)** (também no Google Doc do grupo): como
gravar, como nomear o arquivo e o texto de cada parte. [`falas-video.md`](falas-video.md)
traz as mesmas falas com os minutos do vídeo das telas.

1. **Gravar:** celular em pé, câmera da frente, rosto no centro. Ler as cenas na ordem, com uma
   pausa curta (1 segundo) entre elas.
2. **Nomear pelo número da parte:** `1.mp4`, `2-gabriel-cantanhede.mov`, `3.mp4`, `4.mp4`.
   Quem errar um trecho pode, em vez de regravar tudo, mandar só aquela cena com o número
   dela (`5b.mp4`): o montador usa o clipe da cena no lugar do trecho da parte.
3. **Montar:** com os arquivos em `scripts/video/clipes/`,

   ```bash
   cd scripts/video && node montar.mjs
   ```

   Sai `saida/ampara-video-final-<data>.mp4`. Em cada parte, a velocidade das telas é ajustada
   para acompanhar o ritmo de quem fala (de 0,6× a 1,6×), então a tela não fica adiantada nem
   atrasada em relação à fala; o volume das quatro vozes é igualado.

   Para a tela acompanhar cada cena (e não só a parte inteira), ponha ao lado do vídeo um
   arquivo com o mesmo nome e extensão `.cenas`, com o segundo em que a fala de cada cena
   começa (`1b 49.6`, uma por linha). Os tempos saem de ouvir o vídeo ou de uma transcrição
   com marcação de tempo; isso também absorve falas que mudaram em relação ao roteiro.

## 3. Roteiro

Cada cena tem um número (o mesmo da legenda), quem narra, o que aparece e a fala. As cenas
marcadas **Código** mostram o painel de código sobre os dois apps. As cenas de cada parte são
seguidas: a parte 1 vai de 0a a 1c, a 2 de 2a a 4a, a 3 de 5a a 6c e a 4 de 7a a 9.

### 0a. Abertura · *Gabriel Soares*
**Na tela:** capa laranja "ampara", que se abre nos dois apps lado a lado.

> "Esta é a Ampara, uma plataforma de adoção responsável de animais. Nos próximos minutos, vamos seguir um animal do cadastro até a adoção, por dois clientes diferentes: à esquerda, o painel da ONG; à direita, o app de quem quer adotar."

### 0b. Arquitetura · *Gabriel Soares*
**Na tela:** o diagrama de componentes (`docs/assets/arquitetura.svg`).

> "Por trás das duas telas, cada cliente tem o seu Backend for Frontend: o painel fala com o BFF Web, e o celular, com o BFF Mobile. Os dois ficam atrás do Kong, o API Gateway. Atrás deles estão os serviços de domínio: Identidade, Animais, Adoção, o Orquestrador da SAGA, Notificações e o Assistente com IA. Cada serviço tem o próprio banco, e eles conversam por eventos no RabbitMQ."

### 1a. A ONG entra no painel · *Gabriel Soares*
**Na tela:** login da `ong@ampara.dev` no App Web e a visão geral do painel.

> "A ONG entra no painel. O login vai para a Identidade, que confere a senha e devolve um token JWT assinado com RS256. Esse token acompanha toda chamada que o painel faz daqui em diante."

### 1b. Código: o gateway separa os dois clientes · *Gabriel Soares*
**Na tela:** `gateway/kong.template.yml`, com as rotas `/web/v1` e `/mobile/v1`.

> "Esta é a configuração do Kong. Cada cliente tem a sua rota: /web/v1 vai para o BFF Web, e /mobile/v1, para o BFF Mobile. No painel, o plugin jwt exige o token em tudo, e o rate limit é de trezentas requisições por minuto. No celular, a busca de animais é pública, sem token, e o limite é maior, porque são muito mais usuários."

### 1c. Código: o BFF Web confere o papel · *Gabriel Soares*
**Na tela:** `bff/web/src/auth.ts`, a função `exigirRoles`.

> "O Kong confere a assinatura; o BFF confere quem é a pessoa. Aqui, o BFF Web lê o papel que vem dentro do token e só deixa passar protetor, ONG e administrador. Um adotante com token válido recebe quatrocentos e três aqui, com a mensagem no formato problem mais json."

### 2a. A ONG cadastra a Pipoca · *Gabriel Cantanhede*
**Na tela:** o formulário de cadastro sendo preenchido: nome, espécie, porte, foto, endereço do abrigo e ponto no mapa.

> "A ONG cadastra a Pipoca, uma filhote resgatada. O formulário pede o endereço do abrigo e o ponto no mapa, que mais tarde vai permitir a busca por distância no celular."

### 2b. Código: o animal e o evento na mesma transação · *Gabriel Cantanhede*
**Na tela:** `services/animais/app/repositorio/animais.py`, o fim de `cadastrar_animal`.

> "No serviço de Animais, o cadastro grava duas coisas na mesma transação do MongoDB: o animal e o evento animal criado, na coleção outbox. Ou as duas gravações acontecem, ou nenhuma. Depois, um relay lê a outbox e publica o evento no RabbitMQ. Assim nunca existe um animal salvo sem o evento, nem um evento de um animal que não existe."

### 2c. A ficha completa no painel · *Gabriel Cantanhede*
**Na tela:** a ficha da Pipoca no painel: rua, número, CEP, histórico de status e pedidos.

> "Cadastrada, a Pipoca aparece com a ficha completa: o endereço exato do abrigo, o histórico de status e, mais tarde, a lista de quem pediu a adoção. É tudo o que a ONG precisa para decidir."

### 3a. A adotante busca por raio · *Gabriel Cantanhede*
**Na tela:** login da Ana Souza no App Mobile e a busca "Quem está esperando por você?", com o cartão da Pipoca em destaque.

> "Do outro lado, a Ana entra no app do celular. A busca mostra os animais a até dez quilômetros, do mais perto para o mais longe. E a Pipoca, cadastrada há poucos segundos, já está aqui."

### 3b. Código: o modelo de leitura (CQRS) · *Gabriel Cantanhede*
**Na tela:** `services/animais/app/projetor.py`, o projetor da busca.

> "Ela chegou aqui pelo CQRS. O evento animal criado é consumido por este projetor, que monta um documento só para a busca, numa coleção separada da escrita. Repare em duas coisas: a coordenada é arredondada, para o celular nunca saber o ponto exato do abrigo; e a atualização só vale se a versão for mais nova, então um evento repetido ou atrasado não estraga o documento."

### 3c. Código: o cartão do BFF Mobile · *Gabriel Cantanhede*
**Na tela:** `bff/mobile/src/rotas.ts`, o schema do cartão da busca.

> "Este é o cartão que o BFF Mobile devolve: oito campos fixos e additional properties falso. O Fastify corta qualquer campo que não esteja aqui. Uma página com vinte animais fica em torno de seis kilobytes, o que importa no celular."

### 4a. A mesma ficha, outra visão · *Gabriel Cantanhede*
**Na tela:** a ficha da Pipoca no celular, ao lado da ficha do painel; depois, o toque em "Quero adotar Pipoca".

> "Agora compare as duas fichas da Pipoca. O painel mostra rua e número; o celular, só o bairro, a cidade e a distância. É o mesmo animal, mas cada BFF entrega o que o seu cliente precisa, e nada além disso. A Ana gostou e toca em Quero adotar."

### 5a. A SAGA em andamento · *Mateus*
**Na tela:** o pedido da Ana com a linha do tempo: "Pedido enviado", "Animal reservado" e "Com a ONG".

> "Esse toque abre uma SAGA de adoção. Em poucos segundos, o animal é reservado, o perfil da Ana é validado e o pedido fica esperando a ONG. Cada passo vira um carimbo nessa linha do tempo, sem a Ana recarregar a tela."

### 5b. Código: a máquina de estados da SAGA · *Mateus*
**Na tela:** `services/orquestrador/internal/saga/maquina.go`, as transições 2 e 5.

> "Quem conduz a SAGA é o Orquestrador, em Go. A lógica é uma máquina de estados pura: recebe o estado atual e o evento, e devolve o novo estado e as mensagens a enviar. Na transição dois, o animal foi reservado, então ele pede ao serviço de Identidade para validar o perfil. Na cinco, o perfil foi validado: o pedido vai para aguardando aprovação, ganha um prazo, e o evento é publicado para o resto do sistema. Se algum passo falhar, a SAGA compensa e desfaz a reserva."

### 6a. O pedido chega ao painel · *Mateus*
**Na tela:** a lista de solicitações do painel e a página do pedido da Ana, com "Quem pediu": moradia, quintal, horas fora de casa.

> "No painel, o pedido da Ana já aparece. A ONG abre e vê o perfil de adoção que a Ana preencheu na Identidade: tipo de moradia, se tem quintal, quantas horas passa fora de casa. É com isso que ela decide."

### 6b. Código: os botões vêm da API (HATEOAS) · *Mateus*
**Na tela:** `services/adocao/internal/httpapi/solicitacoes.go`, a função `Links`.

> "Os botões Aprovar e Recusar não são decididos pelo front. O serviço de Adoção só inclui os links aprovar e recusar na resposta quando o pedido está aguardando aprovação, ninguém decidiu ainda e quem pergunta é o responsável pelo animal. O BFF Web traduz esses links para /web/v1, e a tela só desenha o botão se o link veio. Isso é HATEOAS."

### 6c. A ONG aprova · *Mateus*
**Na tela:** o clique em "Aprovar adoção" e o pedido mudando para "Adoção concluída".

> "A ONG aprova. A SAGA confirma a adoção no serviço de Animais e conclui o pedido."

### 7a. A adotante recebe os avisos · *Gabriel Nakazato*
**Na tela:** o celular com "Parabéns, a adoção está concluída!" e a tela de Avisos com "Adoção concluída", "Adoção aprovada" e "Solicitação enviada".

> "No celular, a Ana vê a adoção concluída, sem recarregar nada. E na aba Avisos estão as notificações de cada etapa: pedido enviado, adoção aprovada e adoção concluída."

### 7b. Código: avisos sem duplicar · *Gabriel Nakazato*
**Na tela:** `services/notificacoes/app/caixa.py`, o script Lua que grava o aviso.

> "O serviço de Notificações escuta os eventos da SAGA pelo RabbitMQ e grava cada aviso no Redis com este script Lua, que roda de forma atômica. Ele confere se aquele evento já foi gravado para aquela pessoa; se já foi, não faz nada. Como o RabbitMQ pode entregar a mesma mensagem duas vezes, isso garante um aviso só. E a mensagem só é confirmada depois de gravada: se o serviço cair, os eventos esperam na fila."

### 8a. Assistente: dúvida com fonte · *Gabriel Nakazato*
**Na tela:** o Assistente respondendo "Dá para ter cachorro em apartamento?", com a fonte citada.

> "Por último, o Assistente. A Ana pergunta se dá para ter cachorro em apartamento. A resposta vem com a fonte: um guia de adaptação da base de conhecimento da Ampara."

### 8b. Código: a resposta só passa com fonte válida · *Gabriel Nakazato*
**Na tela:** `services/assistente/app/rag.py`, a função `verificar_citacoes`.

> "É RAG: a pergunta busca os trechos mais parecidos na base, e o modelo responde usando só esses trechos, citando cada um pelo número. E o serviço não confia cegamente: esta função confere as citações. Resposta sem citação, ou citando uma fonte que não existe, é recusada, e o próximo modelo tenta. Se a base não cobre o assunto, ele diz isso, em vez de inventar."

### 8c. Assistente: quem combina comigo · *Gabriel Nakazato*
**Na tela:** a aba "Quem combina comigo", a rotina "Moro em apartamento pequeno e trabalho 8 horas fora de casa" e as sugestões, cada uma com o motivo.

> "Na aba Quem combina comigo, a Ana descreve a rotina dela: apartamento pequeno e oito horas fora de casa. O Assistente sugere animais adultos e de porte pequeno ou médio, e explica cada escolha."

### 8d. Código: a ferramenta do agente · *Gabriel Nakazato*
**Na tela:** `services/assistente/app/recomendacao.py`, a ferramenta `buscar_animais_disponiveis`.

> "Para isso, o modelo usa uma ferramenta: buscar animais disponíveis. Ele decide os filtros, mas quem busca é o servidor, perto da Ana e só entre os disponíveis. Assim o modelo não inventa animal: só sugere o que a busca devolveu. E se o provedor de IA cair, a recomendação continua, por regras simples."

### 9. Encerramento · *Gabriel Nakazato*
**Na tela:** capa laranja "Um animal, dois clientes, dois BFFs, uma SAGA."

> "Foi isso: um animal, dois clientes com dois BFFs, uma SAGA coordenando os serviços, e avisos e inteligência artificial em volta. Obrigado!"

## 4. Checklist antes de entregar

- [ ] O vídeo foi gerado com o sistema da develop atual, sem erro em nenhuma cena.
- [ ] Os quatro integrantes aparecem na narração, cada um nas cenas da própria parte.
- [ ] As cenas de código estão legíveis em tela cheia (1080p).
- [ ] Volume da narração uniforme entre as cenas.
- [ ] Duração final de até 10 minutos.
