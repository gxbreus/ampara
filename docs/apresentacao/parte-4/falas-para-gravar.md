# Ampara · falas para gravar o vídeo da Parte 4

O vídeo tem cerca de 9 minutos e segue um animal do cadastro até a adoção, passando pelos dois BFFs. As telas já estão gravadas. Falta **o rosto e a voz de cada um**. O vídeo é dividido em **quatro partes seguidas**, uma por integrante, e **cada um grava um vídeo só, no celular, com a parte inteira dele**. A montagem junta tudo: o seu rosto aparece num círculo no canto do vídeo, e a sua voz vira a narração da sua parte.

## As quatro partes

- **Parte 1 · Gabriel Soares:** cenas 0a a 1c, cerca de 1:53 de fala. Arquivo: `1-gabriel-soares.mp4`.
- **Parte 2 · Gabriel Cantanhede:** cenas 2a a 4a, cerca de 2:19 de fala. Arquivo: `2-gabriel-cantanhede.mp4`.
- **Parte 3 · Mateus Vitor:** cenas 5a a 6c, cerca de 1:48 de fala. Arquivo: `3-mateus-vitor.mp4`.
- **Parte 4 · Gabriel Nakazato:** cenas 7a a 9, cerca de 2:15 de fala. Arquivo: `4-gabriel-nakazato.mp4`.

## Como gravar

1. **Celular em pé, câmera da frente**, na altura dos olhos (apoiado em livros ou num suporte).
2. **Rosto no centro**, com um pouco de espaço acima da cabeça: o vídeo recorta um círculo do meio da imagem.
3. **Lugar silencioso e luz de frente** (de frente para a janela, nunca de costas para ela).
4. **Um vídeo só, com a sua parte inteira:** aperte gravar, espere 2 segundos e leia as cenas na ordem, com **uma pausa curta (1 segundo) entre uma cena e outra**. No fim, espere 2 segundos e pare.
5. **Ritmo calmo e constante.** As telas da sua parte acompanham a sua velocidade média, então evite pausas longas no meio. O tempo indicado é uma referência.
6. **Pode ler.** Deixe este documento aberto no computador, atrás do celular, ou use um app de teleprompter.
7. **Errou no meio?** Pare a gravação, corte o trecho errado do fim com o editor da galeria do celular e **comece um vídeo novo a partir do começo da cena em que errou**, com o número dessa cena no nome (por exemplo, `6b.mp4`). A montagem emenda os dois vídeos na ordem certa.

## Como mandar

- **Nome do arquivo:** o número da sua parte, se quiser com o seu nome: `1-gabriel-soares.mp4`, `2-gabriel-cantanhede.mp4`, `3-mateus-vitor.mp4`, `4-gabriel-nakazato.mp4`.
- **Envie para a pasta do Drive:** https://drive.google.com/drive/folders/1jvPXvTKJtIbBdatZvISNbkJWow2y-IRZ (se não tiver acesso, peça ao Mateus).
- Pelo WhatsApp também serve, mas **envie como documento**, não como vídeo: como vídeo, o WhatsApp diminui a qualidade.

## Parte 1 · Gabriel Soares

**Arquivo:** `1-gabriel-soares.mp4` · **cerca de 1:53 de fala** · 5 cenas, lidas em sequência

### Cena 0a · Abertura (~18 s)

**No vídeo, enquanto você fala:** capa laranja "ampara", que se abre nos dois apps lado a lado.

> Esta é a Ampara, uma plataforma de adoção responsável de animais. Nos próximos minutos, vamos seguir um animal do cadastro até a adoção, por dois clientes diferentes: à esquerda, o painel da ONG; à direita, o app de quem quer adotar.

### Cena 0b · Arquitetura (~30 s)

**No vídeo, enquanto você fala:** o diagrama de componentes (docs/assets/arquitetura.svg).

> Por trás das duas telas, cada cliente tem o seu Backend for Frontend: o painel fala com o BFF Web, e o celular, com o BFF Mobile. Os dois ficam atrás do Kong, o API Gateway. Atrás deles estão os serviços de domínio: Identidade, Animais, Adoção, o Orquestrador da SAGA, Notificações e o Assistente com IA. Cada serviço tem o próprio banco, e eles conversam por eventos no RabbitMQ.

### Cena 1a · A ONG entra no painel (~15 s)

**No vídeo, enquanto você fala:** login da ong@ampara.dev no App Web e a visão geral do painel.

> A ONG entra no painel. O login vai para a Identidade, que confere a senha e devolve um token JWT assinado com RS256. Esse token acompanha toda chamada que o painel faz daqui em diante.

### Cena 1b · Código: o gateway separa os dois clientes (~28 s)

**No vídeo, enquanto você fala:** gateway/kong.template.yml, com as rotas /web/v1 e /mobile/v1.

> Esta é a configuração do Kong. Cada cliente tem a sua rota: /web/v1 vai para o BFF Web, e /mobile/v1, para o BFF Mobile. No painel, o plugin jwt exige o token em tudo, e o rate limit é de trezentas requisições por minuto. No celular, a busca de animais é pública, sem token, e o limite é maior, porque são muito mais usuários.

### Cena 1c · Código: o BFF Web confere o papel (~22 s)

**No vídeo, enquanto você fala:** bff/web/src/auth.ts, a função exigirRoles.

> O Kong confere a assinatura; o BFF confere quem é a pessoa. Aqui, o BFF Web lê o papel que vem dentro do token e só deixa passar protetor, ONG e administrador. Um adotante com token válido recebe quatrocentos e três aqui, com a mensagem no formato problem mais json.

## Parte 2 · Gabriel Cantanhede

**Arquivo:** `2-gabriel-cantanhede.mp4` · **cerca de 2:19 de fala** · 7 cenas, lidas em sequência

### Cena 2a · A ONG cadastra a Pipoca (~13 s)

**No vídeo, enquanto você fala:** o formulário de cadastro sendo preenchido: nome, espécie, porte, foto, endereço do abrigo e ponto no mapa.

> A ONG cadastra a Pipoca, uma filhote resgatada. O formulário pede o endereço do abrigo e o ponto no mapa, que mais tarde vai permitir a busca por distância no celular.

### Cena 2b · Código: o animal e o evento na mesma transação (~27 s)

**No vídeo, enquanto você fala:** services/animais/app/repositorio/animais.py, o fim de cadastrar_animal.

> No serviço de Animais, o cadastro grava duas coisas na mesma transação do MongoDB: o animal e o evento animal criado, na coleção outbox. Ou as duas gravações acontecem, ou nenhuma. Depois, um relay lê a outbox e publica o evento no RabbitMQ. Assim nunca existe um animal salvo sem o evento, nem um evento de um animal que não existe.

### Cena 2c · A ficha completa no painel (~16 s)

**No vídeo, enquanto você fala:** a ficha da Pipoca no painel: rua, número, CEP, histórico de status e pedidos.

> Cadastrada, a Pipoca aparece com a ficha completa: o endereço exato do abrigo, o histórico de status e, mais tarde, a lista de quem pediu a adoção. É tudo o que a ONG precisa para decidir.

### Cena 3a · A adotante busca por raio (~16 s)

**No vídeo, enquanto você fala:** login da Ana Souza no App Mobile e a busca "Quem está esperando por você?", com o cartão da Pipoca em destaque.

> Do outro lado, a Ana entra no app do celular. A busca mostra os animais a até dez quilômetros, do mais perto para o mais longe. E a Pipoca, cadastrada há poucos segundos, já está aqui.

### Cena 3b · Código: o modelo de leitura (CQRS) (~29 s)

**No vídeo, enquanto você fala:** services/animais/app/projetor.py, o projetor da busca.

> Ela chegou aqui pelo CQRS. O evento animal criado é consumido por este projetor, que monta um documento só para a busca, numa coleção separada da escrita. Repare em duas coisas: a coordenada é arredondada, para o celular nunca saber o ponto exato do abrigo; e a atualização só vale se a versão for mais nova, então um evento repetido ou atrasado não estraga o documento.

### Cena 3c · Código: o cartão do BFF Mobile (~18 s)

**No vídeo, enquanto você fala:** bff/mobile/src/rotas.ts, o schema do cartão da busca.

> Este é o cartão que o BFF Mobile devolve: oito campos fixos e additional properties falso. O Fastify corta qualquer campo que não esteja aqui. Uma página com vinte animais fica em torno de seis kilobytes, o que importa no celular.

### Cena 4a · A mesma ficha, outra visão (~21 s)

**No vídeo, enquanto você fala:** a ficha da Pipoca no celular, ao lado da ficha do painel; depois, o toque em "Quero adotar Pipoca".

> Agora compare as duas fichas da Pipoca. O painel mostra rua e número; o celular, só o bairro, a cidade e a distância. É o mesmo animal, mas cada BFF entrega o que o seu cliente precisa, e nada além disso. A Ana gostou e toca em Quero adotar.

## Parte 3 · Mateus Vitor

**Arquivo:** `3-mateus-vitor.mp4` · **cerca de 1:48 de fala** · 5 cenas, lidas em sequência

### Cena 5a · A SAGA em andamento (~18 s)

**No vídeo, enquanto você fala:** o pedido da Ana com a linha do tempo: "Pedido enviado", "Animal reservado" e "Com a ONG".

> Esse toque abre uma SAGA de adoção. Em poucos segundos, o animal é reservado, o perfil da Ana é validado e o pedido fica esperando a ONG. Cada passo vira um carimbo nessa linha do tempo, sem a Ana recarregar a tela.

### Cena 5b · Código: a máquina de estados da SAGA (~38 s)

**No vídeo, enquanto você fala:** services/orquestrador/internal/saga/maquina.go, as transições 2 e 5.

> Quem conduz a SAGA é o Orquestrador, em Go. A lógica é uma máquina de estados pura: recebe o estado atual e o evento, e devolve o novo estado e as mensagens a enviar. Na transição dois, o animal foi reservado, então ele pede ao serviço de Identidade para validar o perfil. Na cinco, o perfil foi validado: o pedido vai para aguardando aprovação, ganha um prazo, e o evento é publicado para o resto do sistema. Se algum passo falhar, a SAGA compensa e desfaz a reserva.

### Cena 6a · O pedido chega ao painel (~18 s)

**No vídeo, enquanto você fala:** a lista de solicitações do painel e a página do pedido da Ana, com "Quem pediu": moradia, quintal, horas fora de casa.

> No painel, o pedido da Ana já aparece. A ONG abre e vê o perfil de adoção que a Ana preencheu na Identidade: tipo de moradia, se tem quintal, quantas horas passa fora de casa. É com isso que ela decide.

### Cena 6b · Código: os botões vêm da API (HATEOAS) (~27 s)

**No vídeo, enquanto você fala:** services/adocao/internal/httpapi/solicitacoes.go, a função Links.

> Os botões Aprovar e Recusar não são decididos pelo front. O serviço de Adoção só inclui os links aprovar e recusar na resposta quando o pedido está aguardando aprovação, ninguém decidiu ainda e quem pergunta é o responsável pelo animal. O BFF Web traduz esses links para /web/v1, e a tela só desenha o botão se o link veio. Isso é HATEOAS.

### Cena 6c · A ONG aprova (~7 s)

**No vídeo, enquanto você fala:** o clique em "Aprovar adoção" e o pedido mudando para "Adoção concluída".

> A ONG aprova. A SAGA confirma a adoção no serviço de Animais e conclui o pedido.

## Parte 4 · Gabriel Nakazato

**Arquivo:** `4-gabriel-nakazato.mp4` · **cerca de 2:15 de fala** · 7 cenas, lidas em sequência

### Cena 7a · A adotante recebe os avisos (~12 s)

**No vídeo, enquanto você fala:** o celular com "Parabéns, a adoção está concluída!" e a tela de Avisos com "Adoção concluída", "Adoção aprovada" e "Solicitação enviada".

> No celular, a Ana vê a adoção concluída, sem recarregar nada. E na aba Avisos estão as notificações de cada etapa: pedido enviado, adoção aprovada e adoção concluída.

### Cena 7b · Código: avisos sem duplicar (~33 s)

**No vídeo, enquanto você fala:** services/notificacoes/app/caixa.py, o script Lua que grava o aviso.

> O serviço de Notificações escuta os eventos da SAGA pelo RabbitMQ e grava cada aviso no Redis com este script Lua, que roda de forma atômica. Ele confere se aquele evento já foi gravado para aquela pessoa; se já foi, não faz nada. Como o RabbitMQ pode entregar a mesma mensagem duas vezes, isso garante um aviso só. E a mensagem só é confirmada depois de gravada: se o serviço cair, os eventos esperam na fila.

### Cena 8a · Assistente: dúvida com fonte (~13 s)

**No vídeo, enquanto você fala:** o Assistente respondendo "Dá para ter cachorro em apartamento?", com a fonte citada.

> Por último, o Assistente. A Ana pergunta se dá para ter cachorro em apartamento. A resposta vem com a fonte: um guia de adaptação da base de conhecimento da Ampara.

### Cena 8b · Código: a resposta só passa com fonte válida (~29 s)

**No vídeo, enquanto você fala:** services/assistente/app/rag.py, a função verificar_citacoes.

> É RAG: a pergunta busca os trechos mais parecidos na base, e o modelo responde usando só esses trechos, citando cada um pelo número. E o serviço não confia cegamente: esta função confere as citações. Resposta sem citação, ou citando uma fonte que não existe, é recusada, e o próximo modelo tenta. Se a base não cobre o assunto, ele diz isso, em vez de inventar.

### Cena 8c · Assistente: quem combina comigo (~15 s)

**No vídeo, enquanto você fala:** a aba "Quem combina comigo", a rotina "Moro em apartamento pequeno e trabalho 8 horas fora de casa" e as sugestões, cada uma com o motivo.

> Na aba Quem combina comigo, a Ana descreve a rotina dela: apartamento pequeno e oito horas fora de casa. O Assistente sugere animais adultos e de porte pequeno ou médio, e explica cada escolha.

### Cena 8d · Código: a ferramenta do agente (~23 s)

**No vídeo, enquanto você fala:** services/assistente/app/recomendacao.py, a ferramenta buscar_animais_disponiveis.

> Para isso, o modelo usa uma ferramenta: buscar animais disponíveis. Ele decide os filtros, mas quem busca é o servidor, perto da Ana e só entre os disponíveis. Assim o modelo não inventa animal: só sugere o que a busca devolveu. E se o provedor de IA cair, a recomendação continua, por regras simples.

### Cena 9 · Encerramento (~10 s)

**No vídeo, enquanto você fala:** capa laranja "Um animal, dois clientes, dois BFFs, uma SAGA."

> Foi isso: um animal, dois clientes com dois BFFs, uma SAGA coordenando os serviços, e avisos e inteligência artificial em volta. Obrigado!
