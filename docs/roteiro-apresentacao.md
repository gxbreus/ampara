# Roteiro da apresentação pelo GitHub

O grupo apresentará o projeto diretamente pelo repositório, sem usar slides. O roteiro abaixo distribui os cinco minutos entre os quatro integrantes e indica a seção que deve estar aberta em cada momento.

## Preparação

- abrir a branch `main` na página inicial do repositório;
- deixar uma segunda aba aberta em `docs/arquitetura.md`;
- aumentar o zoom do navegador para que o texto e os diagramas fiquem legíveis;
- combinar antes quem controlará a rolagem;
- não ler o README palavra por palavra: usar os títulos, números e diagramas como apoio.

## Divisão sugerida

### 1. Gabriel Soares: abertura e problema — 0:00 a 1:10

**Tela:** início do README e seção “O problema”.

Pontos para explicar:

- apresentar o nome Ampara e a frase que resume o projeto;
- explicar que avistamentos, resgates e adoções estão espalhados entre WhatsApp e redes sociais;
- destacar os dois números principais: cerca de 30 milhões de animais abandonados e 185 mil sob tutela de ONGs e protetores;
- fechar dizendo que o problema atacado é a falta de coordenação entre quem encontra, quem resgata e quem adota.

**Transição:** “A partir dessa lacuna, pensamos em um fluxo único para os dois públicos da plataforma.”

### 2. Gabriel Cantanhede: solução e impacto — 1:10 a 2:15

**Tela:** seções “Como a Ampara funciona”, “Quem usa” e “Impacto social”.

Pontos para explicar:

- percorrer rapidamente o cadastro, a busca por localização e a solicitação de adoção;
- diferenciar o App Web, usado por protetores e ONGs, do App Mobile, usado pelos adotantes;
- explicar como notificações acompanham as mudanças importantes do processo;
- mostrar os indicadores de impacto: adoções, tempo até o resgate, tempo até a adoção e retenção da rede parceira.

**Transição:** “Para sustentar esse fluxo sem concentrar tudo em uma única aplicação, dividimos o sistema em quatro serviços.”

### 3. Gabriel Nakazato: arquitetura — 2:15 a 3:35

**Tela:** diagrama da seção “Arquitetura” e tabela “Responsabilidade de cada serviço”.

Pontos para explicar:

- mostrar os dois clientes entrando pelo API Gateway;
- apresentar Identidade, Animais, Adoção e Notificações, sempre relacionando cada serviço à sua responsabilidade;
- apontar que cada serviço possui banco próprio e que não existe banco compartilhado;
- explicar que chamadas imediatas passam pelo gateway e eventos assíncronos passam pelo RabbitMQ;
- mencionar que a escolha é poliglota: Node.js/NestJS, Python/FastAPI e Go.

**Transição:** “O caso que demonstra por que essa separação é necessária é a própria solicitação de adoção.”

### 4. Mateus Vitor: SAGA, colaboração e encerramento — 3:35 a 5:00

**Tela:** diagrama “SAGA de adoção”, documentação e integrantes.

Pontos para explicar:

- percorrer a sequência: Adoção reserva em Animais, valida em Identidade e publica o evento que chega a Notificações;
- explicar a compensação: se o pedido for recusado ou expirar, a reserva é liberada e o adotante é avisado;
- mostrar que o repositório já separa arquitetura, decisões, contratos e documento de concepção;
- apontar o fluxo de branches e pull requests como parte do trabalho colaborativo;
- encerrar reforçando que a Ampara organiza a rede de proteção e que as próximas etapas transformarão a arquitetura em código funcional.

## Controle de tempo

| Marco | Tempo máximo |
| --- | ---: |
| problema apresentado | 1:10 |
| solução e impacto concluídos | 2:15 |
| arquitetura concluída | 3:35 |
| SAGA e encerramento | 5:00 |

Se o grupo estiver atrasado, cortar exemplos e manter três pontos obrigatórios: problema, quatro serviços com bancos próprios e compensação da SAGA.

## Perguntas prováveis

### Por que usar uma SAGA?

Porque a adoção altera estados mantidos por serviços diferentes e não existe uma única transação de banco capaz de confirmar ou desfazer tudo. A SAGA coordena as etapas e executa compensações quando o processo não termina.

### Por que Adoção é o orquestrador?

Porque esse serviço conhece a solicitação e seu estado. Ele consegue decidir qual etapa vem depois e quando deve liberar uma reserva.

### Por que cada serviço possui um banco?

Para manter a independência dos microsserviços. Compartilhar o mesmo banco criaria acoplamento entre modelos e permitiria que um serviço alterasse dados de outro.

### Por que MongoDB em Animais?

O cadastro reúne informações que podem variar por espécie e situação, além de fotos, características e localização. O modelo documental acomoda essa variação sem misturar o banco com outros domínios.

### Por que Redis em Notificações?

O serviço precisa manter dados operacionais de curta duração, como tentativas, estado de entrega e controle necessário ao processamento dos avisos. Os dados permanentes da adoção continuam no serviço de Adoção.
