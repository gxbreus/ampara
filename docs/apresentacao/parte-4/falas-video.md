# Falas por parte, sincronizadas com o vídeo das telas

Gerado a partir de `docs/apresentacao/parte-4/roteiro-video.md` e dos tempos da gravação `ampara-caminho-feliz-2026-11-26-16-39.mp4` (8:51 de vídeo). Para outra gravação: `node scripts/video/falas.mjs scripts/video/saida/marcadores-<data>.txt`. Para gravar as falas, use [`falas-para-gravar.md`](falas-para-gravar.md).

| Parte | Quem narra | Cenas | Do minuto | Até | Fala |
| --- | --- | --- | --- | --- | --- |
| 1 | Gabriel Soares | 0a a 1c | 0:00 | 2:00 | ~1:53 |
| 2 | Gabriel Cantanhede | 2a a 4a | 2:00 | 4:30 | ~2:19 |
| 3 | Mateus Vitor | 5a a 6c | 4:30 | 6:25 | ~1:48 |
| 4 | Gabriel Nakazato | 7a a 9 | 6:25 | 8:51 | ~2:15 |

## Parte 1 · Gabriel Soares

### 0:00 a 0:19 · cena 0a · Abertura

- **Na tela:** capa laranja "ampara", que se abre nos dois apps lado a lado.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 19 s de cena.

> Esta é a Ampara, uma plataforma de adoção responsável de animais. Nos próximos minutos, vamos seguir um animal do cadastro até a adoção, por dois clientes diferentes: à esquerda, o painel da ONG; à direita, o app de quem quer adotar.

### 0:19 a 0:51 · cena 0b · Arquitetura

- **Na tela:** o diagrama de componentes (`docs/assets/arquitetura.svg`).
- **Tamanho:** 69 palavras, cerca de 30 s de fala em 32 s de cena.

> Por trás das duas telas, cada cliente tem o seu Backend for Frontend: o painel fala com o BFF Web, e o celular, com o BFF Mobile. Os dois ficam atrás do Kong, o API Gateway. Atrás deles estão os serviços de domínio: Identidade, Animais, Adoção, o Orquestrador da SAGA, Notificações e o Assistente com IA. Cada serviço tem o próprio banco, e eles conversam por eventos no RabbitMQ.

### 0:51 a 1:07 · cena 1a · A ONG entra no painel

- **Na tela:** login da `ong@ampara.dev` no App Web e a visão geral do painel.
- **Tamanho:** 35 palavras, cerca de 15 s de fala em 16 s de cena.

> A ONG entra no painel. O login vai para a Identidade, que confere a senha e devolve um token JWT assinado com RS256. Esse token acompanha toda chamada que o painel faz daqui em diante.

### 1:07 a 1:37 · cena 1b · Código: o gateway separa os dois clientes

- **Na tela:** `gateway/kong.template.yml`, com as rotas `/web/v1` e `/mobile/v1`.
- **Tamanho:** 64 palavras, cerca de 28 s de fala em 30 s de cena.

> Esta é a configuração do Kong. Cada cliente tem a sua rota: /web/v1 vai para o BFF Web, e /mobile/v1, para o BFF Mobile. No painel, o plugin jwt exige o token em tudo, e o rate limit é de trezentas requisições por minuto. No celular, a busca de animais é pública, sem token, e o limite é maior, porque são muito mais usuários.

### 1:37 a 2:00 · cena 1c · Código: o BFF Web confere o papel

- **Na tela:** `bff/web/src/auth.ts`, a função `exigirRoles`.
- **Tamanho:** 50 palavras, cerca de 22 s de fala em 23 s de cena.

> O Kong confere a assinatura; o BFF confere quem é a pessoa. Aqui, o BFF Web lê o papel que vem dentro do token e só deixa passar protetor, ONG e administrador. Um adotante com token válido recebe quatrocentos e três aqui, com a mensagem no formato problem mais json.

## Parte 2 · Gabriel Cantanhede

### 2:00 a 2:15 · cena 2a · A ONG cadastra a Pipoca

- **Na tela:** o formulário de cadastro sendo preenchido: nome, espécie, porte, foto, endereço do abrigo e ponto no mapa.
- **Tamanho:** 31 palavras, cerca de 13 s de fala em 15 s de cena.

> A ONG cadastra a Pipoca, uma filhote resgatada. O formulário pede o endereço do abrigo e o ponto no mapa, que mais tarde vai permitir a busca por distância no celular.

### 2:15 a 2:43 · cena 2b · Código: o animal e o evento na mesma transação

- **Na tela:** `services/animais/app/repositorio/animais.py`, o fim de `cadastrar_animal`.
- **Tamanho:** 61 palavras, cerca de 27 s de fala em 28 s de cena.

> No serviço de Animais, o cadastro grava duas coisas na mesma transação do MongoDB: o animal e o evento animal criado, na coleção outbox. Ou as duas gravações acontecem, ou nenhuma. Depois, um relay lê a outbox e publica o evento no RabbitMQ. Assim nunca existe um animal salvo sem o evento, nem um evento de um animal que não existe.

### 2:43 a 3:00 · cena 2c · A ficha completa no painel

- **Na tela:** a ficha da Pipoca no painel: rua, número, CEP, histórico de status e pedidos.
- **Tamanho:** 36 palavras, cerca de 16 s de fala em 17 s de cena.

> Cadastrada, a Pipoca aparece com a ficha completa: o endereço exato do abrigo, o histórico de status e, mais tarde, a lista de quem pediu a adoção. É tudo o que a ONG precisa para decidir.

### 3:00 a 3:17 · cena 3a · A adotante busca por raio

- **Na tela:** login da Ana Souza no App Mobile e a busca "Quem está esperando por você?", com o cartão da Pipoca em destaque.
- **Tamanho:** 36 palavras, cerca de 16 s de fala em 17 s de cena.

> Do outro lado, a Ana entra no app do celular. A busca mostra os animais a até dez quilômetros, do mais perto para o mais longe. E a Pipoca, cadastrada há poucos segundos, já está aqui.

### 3:17 a 3:47 · cena 3b · Código: o modelo de leitura (CQRS)

- **Na tela:** `services/animais/app/projetor.py`, o projetor da busca.
- **Tamanho:** 66 palavras, cerca de 29 s de fala em 30 s de cena.

> Ela chegou aqui pelo CQRS. O evento animal criado é consumido por este projetor, que monta um documento só para a busca, numa coleção separada da escrita. Repare em duas coisas: a coordenada é arredondada, para o celular nunca saber o ponto exato do abrigo; e a atualização só vale se a versão for mais nova, então um evento repetido ou atrasado não estraga o documento.

### 3:47 a 4:07 · cena 3c · Código: o cartão do BFF Mobile

- **Na tela:** `bff/mobile/src/rotas.ts`, o schema do cartão da busca.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 20 s de cena.

> Este é o cartão que o BFF Mobile devolve: oito campos fixos e additional properties falso. O Fastify corta qualquer campo que não esteja aqui. Uma página com vinte animais fica em torno de seis kilobytes, o que importa no celular.

### 4:07 a 4:30 · cena 4a · A mesma ficha, outra visão

- **Na tela:** a ficha da Pipoca no celular, ao lado da ficha do painel; depois, o toque em "Quero adotar Pipoca".
- **Tamanho:** 49 palavras, cerca de 21 s de fala em 23 s de cena.

> Agora compare as duas fichas da Pipoca. O painel mostra rua e número; o celular, só o bairro, a cidade e a distância. É o mesmo animal, mas cada BFF entrega o que o seu cliente precisa, e nada além disso. A Ana gostou e toca em Quero adotar.

## Parte 3 · Mateus Vitor

### 4:30 a 4:49 · cena 5a · A SAGA em andamento

- **Na tela:** o pedido da Ana com a linha do tempo: "Pedido enviado", "Animal reservado" e "Com a ONG".
- **Tamanho:** 42 palavras, cerca de 18 s de fala em 19 s de cena.

> Esse toque abre uma SAGA de adoção. Em poucos segundos, o animal é reservado, o perfil da Ana é validado e o pedido fica esperando a ONG. Cada passo vira um carimbo nessa linha do tempo, sem a Ana recarregar a tela.

### 4:49 a 5:29 · cena 5b · Código: a máquina de estados da SAGA

- **Na tela:** `services/orquestrador/internal/saga/maquina.go`, as transições 2 e 5.
- **Tamanho:** 88 palavras, cerca de 38 s de fala em 40 s de cena.

> Quem conduz a SAGA é o Orquestrador, em Go. A lógica é uma máquina de estados pura: recebe o estado atual e o evento, e devolve o novo estado e as mensagens a enviar. Na transição dois, o animal foi reservado, então ele pede ao serviço de Identidade para validar o perfil. Na cinco, o perfil foi validado: o pedido vai para aguardando aprovação, ganha um prazo, e o evento é publicado para o resto do sistema. Se algum passo falhar, a SAGA compensa e desfaz a reserva.

### 5:29 a 5:48 · cena 6a · O pedido chega ao painel

- **Na tela:** a lista de solicitações do painel e a página do pedido da Ana, com "Quem pediu": moradia, quintal, horas fora de casa.
- **Tamanho:** 41 palavras, cerca de 18 s de fala em 19 s de cena.

> No painel, o pedido da Ana já aparece. A ONG abre e vê o perfil de adoção que a Ana preencheu na Identidade: tipo de moradia, se tem quintal, quantas horas passa fora de casa. É com isso que ela decide.

### 5:48 a 6:17 · cena 6b · Código: os botões vêm da API (HATEOAS)

- **Na tela:** `services/adocao/internal/httpapi/solicitacoes.go`, a função `Links`.
- **Tamanho:** 62 palavras, cerca de 27 s de fala em 29 s de cena.

> Os botões Aprovar e Recusar não são decididos pelo front. O serviço de Adoção só inclui os links aprovar e recusar na resposta quando o pedido está aguardando aprovação, ninguém decidiu ainda e quem pergunta é o responsável pelo animal. O BFF Web traduz esses links para /web/v1, e a tela só desenha o botão se o link veio. Isso é HATEOAS.

### 6:17 a 6:25 · cena 6c · A ONG aprova

- **Na tela:** o clique em "Aprovar adoção" e o pedido mudando para "Adoção concluída".
- **Tamanho:** 16 palavras, cerca de 7 s de fala em 8 s de cena.

> A ONG aprova. A SAGA confirma a adoção no serviço de Animais e conclui o pedido.

## Parte 4 · Gabriel Nakazato

### 6:25 a 6:39 · cena 7a · A adotante recebe os avisos

- **Na tela:** o celular com "Parabéns, a adoção está concluída!" e a tela de Avisos com "Adoção concluída", "Adoção aprovada" e "Solicitação enviada".
- **Tamanho:** 28 palavras, cerca de 12 s de fala em 14 s de cena.

> No celular, a Ana vê a adoção concluída, sem recarregar nada. E na aba Avisos estão as notificações de cada etapa: pedido enviado, adoção aprovada e adoção concluída.

### 6:39 a 7:14 · cena 7b · Código: avisos sem duplicar

- **Na tela:** `services/notificacoes/app/caixa.py`, o script Lua que grava o aviso.
- **Tamanho:** 76 palavras, cerca de 33 s de fala em 35 s de cena.

> O serviço de Notificações escuta os eventos da SAGA pelo RabbitMQ e grava cada aviso no Redis com este script Lua, que roda de forma atômica. Ele confere se aquele evento já foi gravado para aquela pessoa; se já foi, não faz nada. Como o RabbitMQ pode entregar a mesma mensagem duas vezes, isso garante um aviso só. E a mensagem só é confirmada depois de gravada: se o serviço cair, os eventos esperam na fila.

### 7:14 a 7:28 · cena 8a · Assistente: dúvida com fonte

- **Na tela:** o Assistente respondendo "Dá para ter cachorro em apartamento?", com a fonte citada.
- **Tamanho:** 30 palavras, cerca de 13 s de fala em 14 s de cena.

> Por último, o Assistente. A Ana pergunta se dá para ter cachorro em apartamento. A resposta vem com a fonte: um guia de adaptação da base de conhecimento da Ampara.

### 7:28 a 7:58 · cena 8b · Código: a resposta só passa com fonte válida

- **Na tela:** `services/assistente/app/rag.py`, a função `verificar_citacoes`.
- **Tamanho:** 66 palavras, cerca de 29 s de fala em 30 s de cena.

> É RAG: a pergunta busca os trechos mais parecidos na base, e o modelo responde usando só esses trechos, citando cada um pelo número. E o serviço não confia cegamente: esta função confere as citações. Resposta sem citação, ou citando uma fonte que não existe, é recusada, e o próximo modelo tenta. Se a base não cobre o assunto, ele diz isso, em vez de inventar.

### 7:58 a 8:15 · cena 8c · Assistente: quem combina comigo

- **Na tela:** a aba "Quem combina comigo", a rotina "Moro em apartamento pequeno e trabalho 8 horas fora de casa" e as sugestões, cada uma com o motivo.
- **Tamanho:** 34 palavras, cerca de 15 s de fala em 17 s de cena.

> Na aba Quem combina comigo, a Ana descreve a rotina dela: apartamento pequeno e oito horas fora de casa. O Assistente sugere animais adultos e de porte pequeno ou médio, e explica cada escolha.

### 8:15 a 8:40 · cena 8d · Código: a ferramenta do agente

- **Na tela:** `services/assistente/app/recomendacao.py`, a ferramenta `buscar_animais_disponiveis`.
- **Tamanho:** 54 palavras, cerca de 23 s de fala em 25 s de cena.

> Para isso, o modelo usa uma ferramenta: buscar animais disponíveis. Ele decide os filtros, mas quem busca é o servidor, perto da Ana e só entre os disponíveis. Assim o modelo não inventa animal: só sugere o que a busca devolveu. E se o provedor de IA cair, a recomendação continua, por regras simples.

### 8:40 a 8:51 · cena 9 · Encerramento

- **Na tela:** capa laranja "Um animal, dois clientes, dois BFFs, uma SAGA."
- **Tamanho:** 22 palavras, cerca de 10 s de fala em 11 s de cena.

> Foi isso: um animal, dois clientes com dois BFFs, uma SAGA coordenando os serviços, e avisos e inteligência artificial em volta. Obrigado!
