# Parte 4: vídeo do caminho feliz dos dois BFFs

O vídeo mostra **o sistema funcionando pelas telas**, não o código: uma ONG cadastra um
animal no **App Web** (BFF Web), uma adotante encontra esse animal e pede a adoção no **App
Mobile** (BFF Mobile), a ONG aprova e a adotante recebe os avisos e usa o Assistente. Os dois
apps aparecem **lado a lado o tempo todo**, então dá para ver o mesmo animal pelas duas
visões e o pedido atravessando o sistema.

O vídeo é **gravado por um script** (`scripts/video/gravar.mjs`): ele conduz os dois apps
sozinho, com pausas para a narração, destaca cada clique e escreve na tela uma legenda por
etapa. Ninguém precisa clicar ao vivo nem acertar o tempo: **vocês só narram por cima**.

- **Duração:** cerca de **3min30**. O gravador segura cada etapa na tela pelo tempo da fala
  dela neste roteiro, então os marcadores do vídeo já batem com a narração.
- **Narração:** os quatro integrantes, cada um nos blocos da própria parte (`docs/planejamento.md` §4).
- **Repetível:** cada gravação cria o seu animal e a sua adotante, então dá para gravar de
  novo quantas vezes quiser sem mexer nos dados da demo.

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

2. **Os dois apps em modo dev**, cada um num terminal, apontando para o gateway. No compose o
   gateway é a `8000` (ou a porta que você publicou); no kind também é a `8000`:

   ```bash
   cd apps && AMPARA_GATEWAY=http://localhost:8000 VITE_AUTH_REAL=true npm run dev:web     # 5173
   cd apps && AMPARA_GATEWAY=http://localhost:8000 npm run dev:mobile                       # 5174
   ```

3. **Gravar:**

   ```bash
   cd scripts/video
   AMPARA_GATEWAY=http://localhost:8000 npm run gravar
   ```

   Em cerca de 4 minutos sai, em `scripts/video/saida/`:

   - `ampara-caminho-feliz-<data>.mp4`: o vídeo em 1920×1080, pronto para o editor;
   - o mesmo em `.webm` (o original do navegador);
   - `marcadores-<data>.txt`: o minuto em que cada etapa começa, para encaixar a narração.

| Variável | Para quê |
| --- | --- |
| `RITMO=2` | tudo um terço mais lento (padrão `1.5`, cerca de 3min30). Use se a narração não couber |
| `ANIMAL=Amora` | outro nome para o animal cadastrado no vídeo (padrão `Pipoca`) |
| `LEGENDA=nao` | grava sem a faixa de legenda (por exemplo, se forem pôr legendas no editor) |
| `MOSTRAR=sim` | abre o navegador na tela durante a gravação, para ensaiar |

**Se falhar:** o script diz em qual etapa parou. As causas comuns são um app ou o gateway fora
do ar (ele confere antes de começar) e o Assistente sem nenhuma chave de LLM. Nesse caso a
etapa 8 mostra a resposta de contingência; confira as chaves em `docs/llm/provedores.md`
(para a demo, `LLM_ORDEM=groq,principal,openrouter` no `.env` deixa o Assistente mais rápido).

## 2. Narrar por cima

**O jeito mais fácil:** abrir o `.mp4` num editor de vídeo com gravação de narração (CapCut,
Clipchamp, Kdenlive, ou o próprio OBS tocando o vídeo como fonte de mídia) e gravar a voz
**bloco a bloco**, olhando a legenda que aparece na tela. Cada integrante grava os blocos dele.
Se não estiverem juntos, cada um grava o próprio áudio (no celular ou no computador),
seguindo os tempos do `marcadores-<data>.txt`, e quem edita encaixa os áudios no vídeo.

Dicas:

- **A legenda é o seu sinal:** comece a falar quando o número da etapa trocar.
- **Fale sobre o que está aparecendo,** não sobre o código. As falas abaixo já explicam o
  "como funciona por trás" em uma ou duas frases por etapa.
- **Sobrou fala?** Grave de novo com `RITMO=2`. **Sobrou vídeo?** Acelere o trecho no editor
  ou corte as pausas.
- Os tempos abaixo são da gravação de 26/11 com o ritmo padrão; os da sua estão no arquivo
  de marcadores e variam poucos segundos.
- **Mudou uma fala?** Ajuste o tempo mínimo da etapa em `MINIMO`, no começo de
  `scripts/video/gravar.mjs` (cerca de 2,3 palavras por segundo, mais uma folga).

## 3. Roteiro de narração

Cada fala cabe no tempo da sua etapa num ritmo calmo (cerca de 2,3 palavras por segundo):
o gravador usa o tamanho delas para decidir quanto tempo cada etapa fica na tela. **Na tela**
descreve o que o vídeo mostra naquele momento.

### 0. Abertura (0:00 a 0:11) · *Mateus*

**Na tela:** capa laranja "ampara · Adoção responsável · dois clientes, dois BFFs", que se
abre nos dois apps lado a lado.

> "Esse é o caminho feliz da Ampara. À esquerda, o painel da ONG; à direita, o app de quem quer adotar."

### 1. A ONG entra no painel web (0:11 a 0:30) · *Gabriel Soares*

**Na tela:** login da `ong@ampara.dev` no App Web e a visão geral do painel. No topo, o
destaque em "App Web → Kong /web/v1 → BFF Web".

> "A ONG entra pelo painel. O login é feito na Identidade, que devolve um token assinado com RS256. Daqui pra frente, toda chamada do painel passa pelo Kong, em /web/v1, que confere esse token antes de chegar ao BFF Web."

### 2. A ONG cadastra a Pipoca (0:30 a 1:01) · *Mateus*

**Na tela:** o formulário de cadastro sendo preenchido (nome, espécie, porte, foto, endereço
do abrigo e ponto no mapa) e, depois, a ficha completa da Pipoca no painel, com rua, número,
CEP, histórico de status e "nenhum pedido ainda".

> "A ONG cadastra a Pipoca. O BFF Web grava no serviço de Animais, que salva o animal e o evento na mesma transação, pelo padrão outbox. Repare na ficha do painel: ela tem o endereço completo do abrigo, o histórico de status e, mais tarde, quem pediu a adoção. É tudo o que a ONG precisa para decidir, e é exatamente o que o celular não vai receber."

### 3. A adotante abre o app e busca por raio (1:01 a 1:24) · *Gabriel Cantanhede*

**Na tela:** login da Ana Souza no App Mobile e a busca "Quem está esperando por você?", com
os animais a até 10 km; o cartão da Pipoca, a 0 km, fica em destaque.

> "Do outro lado, a Ana entra no app. É outro cliente, com outra rota: /mobile/v1, no BFF Mobile. A busca é geográfica e vem do modelo de leitura do serviço de Animais, o lado de consulta do CQRS. Por isso a Pipoca, cadastrada segundos atrás, já aparece aqui."

### 4. A mesma ficha, outra visão (1:24 a 1:43) · *Gabriel Cantanhede*

**Na tela:** a ficha da Pipoca no celular, com foto, sexo, porte, idade, só "Centro, Lavras" e
a ONG com o selo de verificada, ao lado da ficha do painel; depois, o toque em "Quero adotar Pipoca".

> "Compare as duas fichas: o painel mostra rua e número; o celular, só o bairro e a distância. O BFF Mobile corta esses campos antes de responder. É a LGPD no desenho da API. A Ana toca em Quero adotar."

### 5. A SAGA em andamento (1:43 a 2:01) · *Mateus*

**Na tela:** o pedido da Ana com a linha do tempo marcando "Pedido enviado", "Animal
reservado" e "Com a ONG", e o aviso "Tudo certo do seu lado".

> "Esse toque abre uma SAGA. O Orquestrador reserva o animal, confere o perfil de adoção da Ana e para esperando a ONG. Cada passo vira um carimbo nessa linha do tempo, sem a Ana recarregar a tela."

### 6. O pedido chega ao painel e a ONG aprova (2:01 a 2:24) · *Gabriel Soares, depois Mateus*

**Na tela:** a lista de solicitações do painel com o pedido da Ana; a página do pedido com
"Quem pediu" (moradia, quintal, horas fora de casa, perfil completo) e o clique em "Aprovar adoção".

> **Gabriel Soares:** "No painel, o pedido já está lá, com o perfil de adoção que a Ana preencheu na Identidade: moradia, quintal, quantas horas ela passa fora."
>
> **Mateus:** "O botão Aprovar só aparece porque a resposta trouxe o link dessa ação, no padrão HATEOAS. A ONG aprova, e a SAGA conclui a adoção."

### 7. Do outro lado, em segundos: avisos (2:24 a 2:46) · *Gabriel Nakazato*

**Na tela:** o celular mostrando "Parabéns, a adoção está concluída!" e, em seguida, a tela
de Avisos com "Adoção concluída", "Adoção aprovada" e "Solicitação enviada".

> "No celular, o pedido vira adoção concluída. E chegam os avisos: o serviço de Notificações escuta os eventos da SAGA pelo RabbitMQ e monta a caixa de entrada de cada pessoa. Se ele estiver fora do ar, os eventos esperam na fila e nada se perde."

### 8. O Assistente (2:46 a 3:22) · *Gabriel Nakazato*

**Na tela:** o Assistente respondendo "Dá para ter cachorro em apartamento?" com a fonte
citada; depois, "Quem combina comigo" com a rotina "Moro em apartamento pequeno e trabalho 8
horas fora de casa" e as sugestões Luna, Frajola e Nina, cada uma com o motivo.

> "Por último, o Assistente. Na dúvida sobre apartamento, ele responde com base nos guias da Ampara e mostra a fonte: é RAG, a resposta vem dos trechos que a busca encontrou. No Quem combina comigo, a Ana descreve a rotina, e o modelo chama uma ferramenta que busca animais reais disponíveis perto dela. Ele sugere bichos adultos e de porte pequeno ou médio e explica por quê. Se o provedor de IA cair, o resto do app continua funcionando."

### 9. Encerramento (3:22 ao fim) · *Mateus*

**Na tela:** capa laranja "Um animal, dois clientes, dois BFFs, uma SAGA."

> "Um animal, dois clientes, dois BFFs e uma SAGA ligando tudo. Obrigado!"

## 4. Checklist antes de entregar

- [ ] O vídeo foi gerado com o sistema da develop atual, sem erro em nenhuma etapa.
- [ ] A legenda de cada etapa bate com a fala (ou `LEGENDA=nao`, com legendas no editor).
- [ ] Os quatro integrantes aparecem na narração, cada um na própria parte.
- [ ] Volume da narração uniforme entre os blocos.
- [ ] Exportado em 1080p.
