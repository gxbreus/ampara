# Falas por integrante, sincronizadas com o vídeo

Gerado a partir de `docs/apresentacao/parte-4/roteiro-video.md` e dos tempos da gravação `ampara-caminho-feliz-2026-11-26-16-39.mp4` (8:51 de vídeo). Para outra gravação, rode `node scripts/video/falas.mjs scripts/video/saida/marcadores-<data>.txt`: os tempos mudam alguns segundos de uma gravação para outra.

**Como usar:** cada um lê só a sua seção. A coluna **Entra** é o minuto do vídeo em que a cena começa (a legenda na tela mostra o número da cena e "narra: seu nome"). A **deixa** são as últimas palavras de quem fala antes. Comece a falar quando a legenda trocar e termine antes do minuto em **Até**.

## Ordem de entrada

| Entra | Até | Cena | Quem narra |
| --- | --- | --- | --- |
| 0:00 | 0:19 | **0a** · Abertura | Mateus Vitor |
| 0:19 | 0:51 | **0b** · Arquitetura | Mateus Vitor |
| 0:51 | 1:07 | **1a** · A ONG entra no painel | Gabriel Soares |
| 1:07 | 1:37 | **1b** · Código: o gateway separa os dois clientes | Gabriel Soares |
| 1:37 | 2:00 | **1c** · Código: o BFF Web confere o papel | Mateus Vitor |
| 2:00 | 2:15 | **2a** · A ONG cadastra a Pipoca | Gabriel Soares |
| 2:15 | 2:43 | **2b** · Código: o animal e o evento na mesma transação | Gabriel Cantanhede |
| 2:43 | 3:00 | **2c** · A ficha completa no painel | Gabriel Soares |
| 3:00 | 3:17 | **3a** · A adotante busca por raio | Gabriel Cantanhede |
| 3:17 | 3:47 | **3b** · Código: o modelo de leitura (CQRS) | Gabriel Cantanhede |
| 3:47 | 4:07 | **3c** · Código: o cartão do BFF Mobile | Gabriel Cantanhede |
| 4:07 | 4:30 | **4a** · A mesma ficha, outra visão | Gabriel Cantanhede |
| 4:30 | 4:49 | **5a** · A SAGA em andamento | Mateus Vitor |
| 4:49 | 5:29 | **5b** · Código: a máquina de estados da SAGA | Mateus Vitor |
| 5:29 | 5:48 | **6a** · O pedido chega ao painel | Gabriel Soares |
| 5:48 | 6:17 | **6b** · Código: os botões vêm da API (HATEOAS) | Mateus Vitor |
| 6:17 | 6:25 | **6c** · A ONG aprova | Mateus Vitor |
| 6:25 | 6:39 | **7a** · A adotante recebe os avisos | Gabriel Nakazato |
| 6:39 | 7:14 | **7b** · Código: avisos sem duplicar | Gabriel Nakazato |
| 7:14 | 7:28 | **8a** · Assistente: dúvida com fonte | Gabriel Nakazato |
| 7:28 | 7:58 | **8b** · Código: a resposta só passa com fonte válida | Gabriel Nakazato |
| 7:58 | 8:15 | **8c** · Assistente: quem combina comigo | Gabriel Nakazato |
| 8:15 | 8:40 | **8d** · Código: a ferramenta do agente | Gabriel Nakazato |
| 8:40 | 8:51 | **9** · Encerramento | Mateus Vitor |

| Integrante | Cenas | Tempo de fala |
| --- | --- | --- |
| Mateus Vitor | 0a, 0b, 1c, 5a, 5b, 6b, 6c, 9 | 3:01 |
| Gabriel Soares | 1a, 1b, 2a, 2c, 6a | 1:37 |
| Gabriel Cantanhede | 2b, 3a, 3b, 3c, 4a | 1:58 |
| Gabriel Nakazato | 7a, 7b, 8a, 8b, 8c, 8d | 2:15 |

## Mateus Vitor

### 0:00 a 0:19 · cena 0a · Abertura

- **Deixa:** início do vídeo, quando a capa laranja aparece.
- **Na tela:** capa laranja "ampara", que se abre nos dois apps lado a lado.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 19 s de cena.

> Esta é a Ampara, uma plataforma de adoção responsável de animais. Nos próximos minutos, vamos seguir um animal do cadastro até a adoção, por dois clientes diferentes: à esquerda, o painel da ONG; à direita, o app de quem quer adotar.

### 0:19 a 0:51 · cena 0b · Arquitetura

- **Deixa:** depois de Mateus Vitor terminar com "…o app de quem quer adotar."
- **Na tela:** o diagrama de componentes (`docs/assets/arquitetura.svg`).
- **Tamanho:** 69 palavras, cerca de 30 s de fala em 32 s de cena.

> Por trás das duas telas, cada cliente tem o seu Backend for Frontend: o painel fala com o BFF Web, e o celular, com o BFF Mobile. Os dois ficam atrás do Kong, o API Gateway. Atrás deles estão os serviços de domínio: Identidade, Animais, Adoção, o Orquestrador da SAGA, Notificações e o Assistente com IA. Cada serviço tem o próprio banco, e eles conversam por eventos no RabbitMQ.

### 1:37 a 2:00 · cena 1c · Código: o BFF Web confere o papel

- **Deixa:** depois de Gabriel Soares terminar com "…maior, porque são muito mais usuários."
- **Na tela:** `bff/web/src/auth.ts`, a função `exigirRoles`.
- **Tamanho:** 50 palavras, cerca de 22 s de fala em 23 s de cena.

> O Kong confere a assinatura; o BFF confere quem é a pessoa. Aqui, o BFF Web lê o papel que vem dentro do token e só deixa passar protetor, ONG e administrador. Um adotante com token válido recebe quatrocentos e três aqui, com a mensagem no formato problem mais json.

### 4:30 a 4:49 · cena 5a · A SAGA em andamento

- **Deixa:** depois de Gabriel Cantanhede terminar com "…gostou e toca em Quero adotar."
- **Na tela:** o pedido da Ana com a linha do tempo: "Pedido enviado", "Animal reservado" e "Com a ONG".
- **Tamanho:** 42 palavras, cerca de 18 s de fala em 19 s de cena.

> Esse toque abre uma SAGA de adoção. Em poucos segundos, o animal é reservado, o perfil da Ana é validado e o pedido fica esperando a ONG. Cada passo vira um carimbo nessa linha do tempo, sem a Ana recarregar a tela.

### 4:49 a 5:29 · cena 5b · Código: a máquina de estados da SAGA

- **Deixa:** depois de Mateus Vitor terminar com "…sem a Ana recarregar a tela."
- **Na tela:** `services/orquestrador/internal/saga/maquina.go`, as transições 2 e 5.
- **Tamanho:** 88 palavras, cerca de 38 s de fala em 40 s de cena.

> Quem conduz a SAGA é o Orquestrador, em Go. A lógica é uma máquina de estados pura: recebe o estado atual e o evento, e devolve o novo estado e as mensagens a enviar. Na transição dois, o animal foi reservado, então ele pede ao serviço de Identidade para validar o perfil. Na cinco, o perfil foi validado: o pedido vai para aguardando aprovação, ganha um prazo, e o evento é publicado para o resto do sistema. Se algum passo falhar, a SAGA compensa e desfaz a reserva.

### 5:48 a 6:17 · cena 6b · Código: os botões vêm da API (HATEOAS)

- **Deixa:** depois de Gabriel Soares terminar com "…É com isso que ela decide."
- **Na tela:** `services/adocao/internal/httpapi/solicitacoes.go`, a função `Links`.
- **Tamanho:** 62 palavras, cerca de 27 s de fala em 29 s de cena.

> Os botões Aprovar e Recusar não são decididos pelo front. O serviço de Adoção só inclui os links aprovar e recusar na resposta quando o pedido está aguardando aprovação, ninguém decidiu ainda e quem pergunta é o responsável pelo animal. O BFF Web traduz esses links para /web/v1, e a tela só desenha o botão se o link veio. Isso é HATEOAS.

### 6:17 a 6:25 · cena 6c · A ONG aprova

- **Deixa:** depois de Mateus Vitor terminar com "…o link veio. Isso é HATEOAS."
- **Na tela:** o clique em "Aprovar adoção" e o pedido mudando para "Adoção concluída".
- **Tamanho:** 16 palavras, cerca de 7 s de fala em 8 s de cena.

> A ONG aprova. A SAGA confirma a adoção no serviço de Animais e conclui o pedido.

### 8:40 a 8:51 · cena 9 · Encerramento

- **Deixa:** depois de Gabriel Nakazato terminar com "…a recomendação continua, por regras simples."
- **Na tela:** capa laranja "Um animal, dois clientes, dois BFFs, uma SAGA."
- **Tamanho:** 22 palavras, cerca de 10 s de fala em 11 s de cena.

> Foi isso: um animal, dois clientes com dois BFFs, uma SAGA coordenando os serviços, e avisos e inteligência artificial em volta. Obrigado!

## Gabriel Soares

### 0:51 a 1:07 · cena 1a · A ONG entra no painel

- **Deixa:** depois de Mateus Vitor terminar com "…eles conversam por eventos no RabbitMQ."
- **Na tela:** login da `ong@ampara.dev` no App Web e a visão geral do painel.
- **Tamanho:** 35 palavras, cerca de 15 s de fala em 16 s de cena.

> A ONG entra no painel. O login vai para a Identidade, que confere a senha e devolve um token JWT assinado com RS256. Esse token acompanha toda chamada que o painel faz daqui em diante.

### 1:07 a 1:37 · cena 1b · Código: o gateway separa os dois clientes

- **Deixa:** depois de Gabriel Soares terminar com "…o painel faz daqui em diante."
- **Na tela:** `gateway/kong.template.yml`, com as rotas `/web/v1` e `/mobile/v1`.
- **Tamanho:** 64 palavras, cerca de 28 s de fala em 30 s de cena.

> Esta é a configuração do Kong. Cada cliente tem a sua rota: /web/v1 vai para o BFF Web, e /mobile/v1, para o BFF Mobile. No painel, o plugin jwt exige o token em tudo, e o rate limit é de trezentas requisições por minuto. No celular, a busca de animais é pública, sem token, e o limite é maior, porque são muito mais usuários.

### 2:00 a 2:15 · cena 2a · A ONG cadastra a Pipoca

- **Deixa:** depois de Mateus Vitor terminar com "…mensagem no formato problem mais json."
- **Na tela:** o formulário de cadastro sendo preenchido: nome, espécie, porte, foto, endereço do abrigo e ponto no mapa.
- **Tamanho:** 31 palavras, cerca de 13 s de fala em 15 s de cena.

> A ONG cadastra a Pipoca, uma filhote resgatada. O formulário pede o endereço do abrigo e o ponto no mapa, que mais tarde vai permitir a busca por distância no celular.

### 2:43 a 3:00 · cena 2c · A ficha completa no painel

- **Deixa:** depois de Gabriel Cantanhede terminar com "…de um animal que não existe."
- **Na tela:** a ficha da Pipoca no painel: rua, número, CEP, histórico de status e pedidos.
- **Tamanho:** 36 palavras, cerca de 16 s de fala em 17 s de cena.

> Cadastrada, a Pipoca aparece com a ficha completa: o endereço exato do abrigo, o histórico de status e, mais tarde, a lista de quem pediu a adoção. É tudo o que a ONG precisa para decidir.

### 5:29 a 5:48 · cena 6a · O pedido chega ao painel

- **Deixa:** depois de Mateus Vitor terminar com "…SAGA compensa e desfaz a reserva."
- **Na tela:** a lista de solicitações do painel e a página do pedido da Ana, com "Quem pediu": moradia, quintal, horas fora de casa.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 19 s de cena.

> No painel, o pedido da Ana já aparece. A ONG abre e vê o perfil de adoção que a Ana preencheu na Identidade: tipo de moradia, se tem quintal, quantas horas passa fora de casa. É com isso que ela decide.

## Gabriel Cantanhede

### 2:15 a 2:43 · cena 2b · Código: o animal e o evento na mesma transação

- **Deixa:** depois de Gabriel Soares terminar com "…a busca por distância no celular."
- **Na tela:** `services/animais/app/repositorio/animais.py`, o fim de `cadastrar_animal`.
- **Tamanho:** 61 palavras, cerca de 27 s de fala em 28 s de cena.

> No serviço de Animais, o cadastro grava duas coisas na mesma transação do MongoDB: o animal e o evento animal criado, na coleção outbox. Ou as duas gravações acontecem, ou nenhuma. Depois, um relay lê a outbox e publica o evento no RabbitMQ. Assim nunca existe um animal salvo sem o evento, nem um evento de um animal que não existe.

### 3:00 a 3:17 · cena 3a · A adotante busca por raio

- **Deixa:** depois de Gabriel Soares terminar com "…que a ONG precisa para decidir."
- **Na tela:** login da Ana Souza no App Mobile e a busca "Quem está esperando por você?", com o cartão da Pipoca em destaque.
- **Tamanho:** 36 palavras, cerca de 16 s de fala em 17 s de cena.

> Do outro lado, a Ana entra no app do celular. A busca mostra os animais a até dez quilômetros, do mais perto para o mais longe. E a Pipoca, cadastrada há poucos segundos, já está aqui.

### 3:17 a 3:47 · cena 3b · Código: o modelo de leitura (CQRS)

- **Deixa:** depois de Gabriel Cantanhede terminar com "…há poucos segundos, já está aqui."
- **Na tela:** `services/animais/app/projetor.py`, o projetor da busca.
- **Tamanho:** 66 palavras, cerca de 29 s de fala em 30 s de cena.

> Ela chegou aqui pelo CQRS. O evento animal criado é consumido por este projetor, que monta um documento só para a busca, numa coleção separada da escrita. Repare em duas coisas: a coordenada é arredondada, para o celular nunca saber o ponto exato do abrigo; e a atualização só vale se a versão for mais nova, então um evento repetido ou atrasado não estraga o documento.

### 3:47 a 4:07 · cena 3c · Código: o cartão do BFF Mobile

- **Deixa:** depois de Gabriel Cantanhede terminar com "…ou atrasado não estraga o documento."
- **Na tela:** `bff/mobile/src/rotas.ts`, o schema do cartão da busca.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 20 s de cena.

> Este é o cartão que o BFF Mobile devolve: oito campos fixos e additional properties falso. O Fastify corta qualquer campo que não esteja aqui. Uma página com vinte animais fica em torno de seis kilobytes, o que importa no celular.

### 4:07 a 4:30 · cena 4a · A mesma ficha, outra visão

- **Deixa:** depois de Gabriel Cantanhede terminar com "…kilobytes, o que importa no celular."
- **Na tela:** a ficha da Pipoca no celular, ao lado da ficha do painel; depois, o toque em "Quero adotar Pipoca".
- **Tamanho:** 49 palavras, cerca de 21 s de fala em 23 s de cena.

> Agora compare as duas fichas da Pipoca. O painel mostra rua e número; o celular, só o bairro, a cidade e a distância. É o mesmo animal, mas cada BFF entrega o que o seu cliente precisa, e nada além disso. A Ana gostou e toca em Quero adotar.

## Gabriel Nakazato

### 6:25 a 6:39 · cena 7a · A adotante recebe os avisos

- **Deixa:** depois de Mateus Vitor terminar com "…de Animais e conclui o pedido."
- **Na tela:** o celular com "Parabéns, a adoção está concluída!" e a tela de Avisos com "Adoção concluída", "Adoção aprovada" e "Solicitação enviada".
- **Tamanho:** 28 palavras, cerca de 12 s de fala em 14 s de cena.

> No celular, a Ana vê a adoção concluída, sem recarregar nada. E na aba Avisos estão as notificações de cada etapa: pedido enviado, adoção aprovada e adoção concluída.

### 6:39 a 7:14 · cena 7b · Código: avisos sem duplicar

- **Deixa:** depois de Gabriel Nakazato terminar com "…enviado, adoção aprovada e adoção concluída."
- **Na tela:** `services/notificacoes/app/caixa.py`, o script Lua que grava o aviso.
- **Tamanho:** 76 palavras, cerca de 33 s de fala em 35 s de cena.

> O serviço de Notificações escuta os eventos da SAGA pelo RabbitMQ e grava cada aviso no Redis com este script Lua, que roda de forma atômica. Ele confere se aquele evento já foi gravado para aquela pessoa; se já foi, não faz nada. Como o RabbitMQ pode entregar a mesma mensagem duas vezes, isso garante um aviso só. E a mensagem só é confirmada depois de gravada: se o serviço cair, os eventos esperam na fila.

### 7:14 a 7:28 · cena 8a · Assistente: dúvida com fonte

- **Deixa:** depois de Gabriel Nakazato terminar com "…cair, os eventos esperam na fila."
- **Na tela:** o Assistente respondendo "Dá para ter cachorro em apartamento?", com a fonte citada.
- **Tamanho:** 30 palavras, cerca de 13 s de fala em 14 s de cena.

> Por último, o Assistente. A Ana pergunta se dá para ter cachorro em apartamento. A resposta vem com a fonte: um guia de adaptação da base de conhecimento da Ampara.

### 7:28 a 7:58 · cena 8b · Código: a resposta só passa com fonte válida

- **Deixa:** depois de Gabriel Nakazato terminar com "…da base de conhecimento da Ampara."
- **Na tela:** `services/assistente/app/rag.py`, a função `verificar_citacoes`.
- **Tamanho:** 66 palavras, cerca de 29 s de fala em 30 s de cena.

> É RAG: a pergunta busca os trechos mais parecidos na base, e o modelo responde usando só esses trechos, citando cada um pelo número. E o serviço não confia cegamente: esta função confere as citações. Resposta sem citação, ou citando uma fonte que não existe, é recusada, e o próximo modelo tenta. Se a base não cobre o assunto, ele diz isso, em vez de inventar.

### 7:58 a 8:15 · cena 8c · Assistente: quem combina comigo

- **Deixa:** depois de Gabriel Nakazato terminar com "…diz isso, em vez de inventar."
- **Na tela:** a aba "Quem combina comigo", a rotina "Moro em apartamento pequeno e trabalho 8 horas fora de casa" e as sugestões, cada uma com o motivo.
- **Tamanho:** 34 palavras, cerca de 15 s de fala em 17 s de cena.

> Na aba Quem combina comigo, a Ana descreve a rotina dela: apartamento pequeno e oito horas fora de casa. O Assistente sugere animais adultos e de porte pequeno ou médio, e explica cada escolha.

### 8:15 a 8:40 · cena 8d · Código: a ferramenta do agente

- **Deixa:** depois de Gabriel Nakazato terminar com "…ou médio, e explica cada escolha."
- **Na tela:** `services/assistente/app/recomendacao.py`, a ferramenta `buscar_animais_disponiveis`.
- **Tamanho:** 54 palavras, cerca de 23 s de fala em 25 s de cena.

> Para isso, o modelo usa uma ferramenta: buscar animais disponíveis. Ele decide os filtros, mas quem busca é o servidor, perto da Ana e só entre os disponíveis. Assim o modelo não inventa animal: só sugere o que a busca devolveu. E se o provedor de IA cair, a recomendação continua, por regras simples.
