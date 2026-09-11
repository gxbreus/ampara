# Ampara

Plataforma distribuída que conecta protetores independentes, ONGs de proteção animal e adotantes, reunindo o cadastro de animais perdidos, achados e disponíveis para adoção.

O nome **Ampara** representa a ação central da plataforma: oferecer proteção ao animal enquanto a rede organiza localização, acolhimento e adoção segura.

## Problema

Informações sobre animais perdidos e abandonados costumam ficar espalhadas entre redes sociais, grupos de mensagens e contatos informais. Ao mesmo tempo, protetores e ONGs trabalham com recursos limitados e sem um canal único para conectar quem encontra um animal, quem pode resgatá-lo e quem deseja adotar.

A Ampara organiza esse fluxo com cadastro, localização, verificação dos parceiros e acompanhamento do processo de adoção.

## Impacto social

O projeto busca facilitar o resgate e a adoção, ampliar o alcance de protetores e ONGs e oferecer aos adotantes um processo centralizado. O impacto será acompanhado por indicadores como:

- número de adoções concluídas pela plataforma;
- tempo médio entre o registro de um avistamento ou denúncia e o resgate;
- tempo médio de permanência do animal cadastrado até a adoção;
- número de ONGs e protetores ativos e sua retenção mensal.

## Públicos atendidos

- animais em situação de abandono ou risco;
- protetores independentes e ONGs;
- adotantes que procuram animais próximos e um processo transparente;
- pessoas que registram animais perdidos, achados ou denúncias de abandono.

## Funcionamento proposto

1. O usuário cadastra um animal perdido, achado ou disponível para adoção, com fotos, espécie, porte e estado atualizado.
2. A busca por localização apresenta animais e denúncias próximas.
3. ONGs e protetores passam por cadastro e verificação.
4. O adotante inicia a solicitação de adoção do animal escolhido.
5. A plataforma conduz aprovação e acompanhamento, enviando notificações nas etapas relevantes.

## Arquitetura

O sistema terá dois clientes independentes:

- aplicativo web para protetores e ONGs gerenciarem animais e adoções;
- aplicativo mobile para adotantes pesquisarem animais e receberem notificações.

Os quatro microsserviços de domínio serão:

1. **Identidade:** cadastro, autenticação e perfis de protetores, ONGs e adotantes.
2. **Animais:** cadastro, fotos, estado e localização dos animais.
3. **Adoção:** solicitação, reserva, aprovação e orquestração da SAGA.
4. **Notificações:** avisos aos participantes durante o processo.

Cada microsserviço possui seu próprio armazenamento. Identidade e Adoção usam PostgreSQL, Animais usa MongoDB e Notificações usa Redis. O API Gateway concentra roteamento e validação de JWT. O RabbitMQ distribui os eventos entre os serviços.

O detalhamento está em [docs/arquitetura.md](docs/arquitetura.md).

## SAGA principal

A solicitação de adoção atravessa quatro serviços:

1. Adoção solicita a reserva ao serviço de Animais.
2. Adoção valida o perfil do adotante no serviço de Identidade.
3. Adoção publica um evento no RabbitMQ.
4. Notificações avisa o protetor ou a ONG responsável para aprovação.

Se a solicitação for recusada ou expirar, a compensação libera a reserva em Animais e Notificações avisa o adotante.

## Tecnologias propostas

- Node.js e NestJS no serviço de Identidade;
- Python e FastAPI nos serviços de Animais e Notificações;
- Go no serviço de Adoção;
- PostgreSQL nos serviços de Identidade e Adoção;
- MongoDB no serviço de Animais;
- Redis no serviço de Notificações;
- RabbitMQ como barramento de eventos;
- API Gateway com validação de JWT.

## Integrantes

| Integrante | GitHub |
| --- | --- |
| Gabriel Soares | [@gxbreus](https://github.com/gxbreus) |
| Gabriel Cantanhede | [@gabrlcant](https://github.com/gabrlcant) |
| Gabriel Nakazato | [@Gabriel-Nakazato](https://github.com/Gabriel-Nakazato) |
| Mateus Vitor | [@mateus-vitor-ferreira-dev](https://github.com/mateus-vitor-ferreira-dev) |

## Entregáveis da Parte 1

- [Documento de concepção](docs/apresentacao/Ampara_Documento_Parte1.pdf)
- [Pitch](docs/apresentacao/ampara_pitch.pptx)
- [Arquitetura detalhada](docs/arquitetura.md)

## Execução local

O projeto está na etapa de concepção. Quando o primeiro incremento funcional for integrado, o repositório fornecerá um `compose.yaml` e estas instruções serão atualizadas com os comandos necessários para subir o sistema do zero.

## Organização do repositório

```text
.
├── docs/
│   ├── apresentacao/
│   │   ├── Ampara_Documento_Parte1.pdf
│   │   └── ampara_pitch.pptx
│   ├── contratos/
│   ├── decisoes/
│   └── arquitetura.md
├── README.md
└── CONTRIBUTING.md
```

## Fluxo de contribuição

O desenvolvimento partirá da branch `develop`. Cada funcionalidade terá uma branch própria e será integrada por pull request após aprovação de outro integrante. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

## Referências da Parte 1

- [Agência Brasil - Brasil tem cerca de 30 milhões de animais domésticos abandonados](https://agenciabrasil.ebc.com.br/geral/noticia/2025-12/brasil-tem-cerca-de-30-milhoes-de-animais-domesticos-abandonados)
- [Instituto Pet Brasil, dados reproduzidos pelo CFMV - animais sob tutela de ONGs e protetores](https://www.cfmv.gov.br/combater-os-maus-tratos-aos-animais-e-um-dever-de-todos/comunicacao/noticias/2023/05/04/)
- [CRMV-SP - Animal não é brinquedo: adoção ou compra requer planejamento](https://crmvsp.gov.br/animal-nao-e-brinquedo-adocao-ou-compra-de-um-pet-requer-planejamento/)
- [Lei Federal nº 9.605/1998](https://www.planalto.gov.br/ccivil_03/leis/l9605.htm)
- [Lei Federal nº 14.064/2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14064.htm)
- [Cobasi Cuida - Pesquisa sobre o cenário de abandono em 2025](https://blog.cobasi.com.br/pesquisa-cobasi-cuida-sobre-abandono-de-animais/)
