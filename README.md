# Ampara

**Conectando protetores, ONGs e adotantes para dar um novo lar a quem precisa**

## Nome e identidade da startup

**Nome:** Ampara.

**Conceito:** plataforma que conecta protetores independentes, ONGs de proteção animal e adotantes, unificando em um só lugar o cadastro de animais perdidos, achados e disponíveis para adoção.

**Repositório:** [github.com/gxbreus/ampara](https://github.com/gxbreus/ampara) — público.

## Problema e motivação

O Brasil convive com um dos maiores contingentes de animais abandonados do mundo. Estimativas oficiais divulgadas pela Agência Brasil apontam cerca de 30 milhões de cães, gatos e outras espécies domésticas em situação de abandono, número estável desde o início da década.

Quem sustenta o resgate e o cuidado desses animais, na prática, são protetores independentes e ONGs — segundo levantamento do Instituto Pet Brasil junto a 400 organizações do país, cerca de 185 mil animais estão hoje sob tutela dessa rede, majoritariamente sem apoio de políticas públicas estruturadas.

Estudos da área veterinária ajudam a entender a origem do problema: pesquisa publicada pela Revista de Educação Continuada em Medicina Veterinária e Zootecnia (CRMV-SP) associa o abandono a fatores como problemas comportamentais do animal, mudanças na rotina do tutor e diferença entre a expectativa e a realidade dos cuidados exigidos. O abandono é crime desde 1998 (Lei Federal nº 9.605/98), com penas ampliadas em 2020 pela Lei Federal nº 14.064/20 — mas a fiscalização é limitada, e a resposta ao problema depende majoritariamente de iniciativas privadas e voluntárias.

Na ponta prática, essa rede de protetores e ONGs opera hoje de forma fragmentada: avistamentos, resgates e pedidos de adoção circulam por grupos de WhatsApp e redes sociais, sem um canal único que conecte quem encontra um animal, quem pode resgatá-lo e quem está disposto a adotar. É essa lacuna de coordenação — não a falta de boa vontade — que a Ampara pretende endereçar.

## Impacto social esperado

### Quem é beneficiado

- **Animais em situação de abandono ou risco:** encontram um canal de resgate mais rápido.
- **Protetores independentes e ONGs:** ganham alcance e organização sem custo de infraestrutura própria.
- **Adotantes:** encontram, de forma centralizada, animais próximos e processos de adoção transparentes.

### Como o impacto será medido

- número de adoções concluídas através da plataforma por período;
- tempo médio entre o registro de um avistamento ou denúncia e o resgate efetivo;
- tempo médio de permanência do animal cadastrado até a adoção;
- número de ONGs e protetores ativos na rede e taxa de retenção mês a mês.

## Esboço da solução

Em linhas gerais — sem entrar em detalhamento técnico, que será tratado nas etapas seguintes — a Ampara oferecerá:

- cadastro de animais perdidos, achados ou disponíveis para adoção, com fotos, espécie, porte e status atualizado;
- busca por localização de animais e denúncias de abandono próximos ao usuário;
- cadastro e verificação de ONGs e protetores parceiros;
- fluxo de solicitação, aprovação e acompanhamento de adoção entre adotante e protetor ou ONG responsável;
- notificações automáticas nas etapas relevantes do processo, como novo avistamento na região e aprovação de adoção.

A plataforma terá dois públicos de uso distintos: quem cuida (protetores e ONGs, cadastrando e gerenciando animais e adoções) e quem adota (buscando e solicitando adoções) — o que já orienta a divisão em clientes distintos prevista no projeto.

## Arquitetura técnica preliminar

> A Parte 1 não exige detalhamento técnico no esboço da solução. Esta seção existe porque a apresentação em sala incluirá a arquitetura, a pedido do professor.

O sistema possui quatro microsserviços independentes, um banco por serviço, dois clientes distintos e uma SAGA orquestrada.

| Microsserviço | Tecnologia | Banco próprio | Responsabilidade |
| --- | --- | --- | --- |
| **Identidade** | Node.js / NestJS | PostgreSQL | Cadastro e autenticação de protetores, ONGs e adotantes. |
| **Animais** | Python / FastAPI | MongoDB | Cadastro de animais, fotos, status e localização. |
| **Adoção** | Go | PostgreSQL | Conduz o processo de adoção ponta a ponta e orquestra a SAGA. |
| **Notificações** | Python / FastAPI | Redis | Envio de notificações a cada etapa relevante. |

### Clientes

- **App Web:** voltado a protetores e ONGs, para gestão de animais e adoções.
- **App Mobile:** voltado a adotantes, com busca geolocalizada e notificações push.

### Comunicação entre serviços

- **API Gateway:** porta de entrada única, responsável pelo roteamento e pela validação de JWT.
- **RabbitMQ:** barramento de eventos para a comunicação assíncrona entre os serviços.

O diagrama completo está em [docs/arquitetura.md](docs/arquitetura.md).

## Transação SAGA: processo de adoção

A solicitação de adoção atravessa quatro serviços:

1. O serviço de **Adoção** reserva o animal junto ao serviço de **Animais**.
2. O serviço de **Adoção** valida o perfil do adotante junto ao serviço de **Identidade**.
3. O serviço de **Adoção** publica um evento no RabbitMQ.
4. O serviço de **Notificações** avisa o protetor ou a ONG responsável para aprovação.

Se a solicitação for recusada ou expirar, uma transação de compensação libera a reserva do animal e notifica o adotante, garantindo que nenhum animal fique preso a um pedido pendente indefinidamente.

## Integrantes

| Integrante | GitHub |
| --- | --- |
| Gabriel Soares | [@gxbreus](https://github.com/gxbreus) |
| Gabriel Cantanhede | [@gabrlcant](https://github.com/gabrlcant) |
| Gabriel Nakazato | [@Gabriel-Nakazato](https://github.com/Gabriel-Nakazato) |
| Mateus Vitor | [@mateus-vitor-ferreira-dev](https://github.com/mateus-vitor-ferreira-dev) |

## Entregáveis da Parte 1

- [Documento de Concepção — Parte 1: Pitch](docs/apresentacao/Ampara_Documento_Parte1.pdf)
- [Apresentação do pitch](docs/apresentacao/ampara_pitch.pptx)
- [Arquitetura técnica preliminar](docs/arquitetura.md)

## Execução local

A Parte 1 corresponde à concepção e ao pitch. Ainda não há uma implementação executável nesta etapa.

## Fluxo de contribuição

O desenvolvimento parte da branch `develop`. Cada funcionalidade deve ser criada em uma branch própria e integrada por pull request após aprovação de outro integrante. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

## Referências

1. [AGÊNCIA BRASIL. Brasil tem cerca de 30 milhões de animais domésticos abandonados. Empresa Brasil de Comunicação (EBC), dez. 2025.](https://agenciabrasil.ebc.com.br/geral/noticia/2025-12/brasil-tem-cerca-de-30-milhoes-de-animais-domesticos-abandonados)
2. [INSTITUTO PET BRASIL (IPB). Levantamento nacional sobre animais abandonados ou resgatados sob tutela de ONGs e protetores. 2024.](https://web.archive.org/web/20250615212548/https://institutopetbrasil.com/fique-por-dentro/numero-de-animais-de-estimacao-em-situacao-de-vulnerabilidade-mais-do-que-dobra-em-dois-anos-aponta-pesquisa-do-ipb)
3. [CONSELHO REGIONAL DE MEDICINA VETERINÁRIA DO ESTADO DE SÃO PAULO (CRMV-SP). Revista de Educação Continuada em Medicina Veterinária e Zootecnia — pesquisa sobre fatores associados ao abandono de cães.](https://crmvsp.gov.br/animal-nao-e-brinquedo-adocao-ou-compra-de-um-pet-requer-planejamento/)
4. BRASIL. [Lei Federal nº 9.605, de 12 de fevereiro de 1998](https://www.planalto.gov.br/ccivil_03/leis/l9605.htm); [Lei Federal nº 14.064, de 29 de setembro de 2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14064.htm) — tipificação penal do abandono e maus-tratos de animais.
5. Complementar: [COBASI CUIDA. Pesquisa Cenário de Abandono de Animais, 4ª edição, 2025.](https://blog.cobasi.com.br/pesquisa-cobasi-cuida-sobre-abandono-de-animais/)
