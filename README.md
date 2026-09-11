# AjudaPet

Plataforma distribuída para coordenar ocorrências de animais perdidos ou abandonados, conectar cidadãos a protetores e ONGs e acompanhar o caso até o reencontro ou a adoção responsável.

## Problema

Informações sobre animais perdidos e abandonados costumam ficar espalhadas entre redes sociais, grupos de mensagens e contatos informais. Ao mesmo tempo, protetores e ONGs trabalham com capacidade limitada e sem um histórico compartilhado do atendimento.

A AjudaPet propõe organizar esse fluxo sem transformar a solução em um simples cadastro. Cada ocorrência terá localização, responsável, mudanças de estado e um desfecho verificável.

## Impacto social

O projeto busca reduzir o tempo entre o registro de uma ocorrência e o primeiro atendimento seguro. O impacto será acompanhado por indicadores como:

- tempo até o primeiro atendimento;
- animais reencontrados;
- adoções concluídas;
- alertas atendidos;
- vagas de acolhimento mobilizadas;
- devoluções e acompanhamento após a adoção.

## Públicos atendidos

- cidadãos que encontram animais ou desejam acompanhar uma ocorrência;
- tutores procurando animais perdidos;
- protetores independentes e ONGs;
- pessoas interessadas em adoção responsável.

## Funcionamento proposto

1. Uma pessoa registra a ocorrência com foto, localização e situação observada.
2. O sistema envia alertas para usuários e protetores próximos.
3. Uma ONG ou protetor faz a triagem e informa sua capacidade de acolhimento.
4. O caso recebe um responsável e um histórico de atendimento.
5. O fluxo termina com reencontro, acolhimento definitivo ou adoção responsável.

## Arquitetura

O sistema terá dois clientes independentes:

- aplicativo mobile para cidadãos, tutores e adotantes;
- painel web para ONGs e protetores.

Os quatro microsserviços de domínio serão:

1. **Ocorrências:** localização, avistamentos, casos e alertas.
2. **Animais:** perfil, características, saúde e estado atual.
3. **Acolhimento:** ONGs, protetores, vagas e entrada do animal.
4. **Adoções:** candidatura, avaliação, termo e acompanhamento.

Cada microsserviço terá uma instância PostgreSQL própria. O acesso síncrono ocorrerá por REST através de um API Gateway. Eventos de domínio serão distribuídos pelo RabbitMQ.

O detalhamento está em [docs/arquitetura.md](docs/arquitetura.md).

## SAGA principal

A conclusão de uma adoção atravessa quatro serviços:

1. Adoções aprova a candidatura.
2. Animais altera o estado para adotado.
3. Acolhimento libera a vaga ocupada.
4. Ocorrências encerra o caso que originou o resgate.

Se uma etapa falhar, a SAGA executa operações compensatórias para reabrir o caso, restaurar a vaga e devolver o animal ao estado disponível.

## Tecnologias propostas

- React Native com Expo no aplicativo mobile;
- React e TypeScript no painel web;
- NestJS e TypeScript nos microsserviços;
- PostgreSQL, com instâncias separadas;
- RabbitMQ para eventos;
- Docker Compose para o ambiente local;
- GitHub Actions para integração contínua;
- armazenamento compatível com S3 para fotos.

## Integrantes

| Integrante | GitHub |
| --- | --- |
| Gabriel Soares | [@gxbreus](https://github.com/gxbreus) |
| Integrante a confirmar | GitHub a confirmar |
| Integrante a confirmar | GitHub a confirmar |
| Integrante a confirmar | GitHub a confirmar |

## Execução local

O projeto está na etapa de concepção. Quando o primeiro incremento funcional for integrado, o repositório fornecerá um `compose.yaml` e estas instruções serão atualizadas com os comandos necessários para subir o sistema do zero.

## Organização do repositório

```text
.
├── docs/
│   ├── apresentacao/
│   ├── contratos/
│   ├── decisoes/
│   └── arquitetura.md
├── README.md
└── CONTRIBUTING.md
```

## Fluxo de contribuição

O desenvolvimento partirá da branch `develop`. Cada funcionalidade terá uma branch própria e será integrada por pull request após aprovação de outro integrante. Consulte [CONTRIBUTING.md](CONTRIBUTING.md).

## Referências iniciais

- [CFMV - Combater os maus-tratos aos animais](https://www.cfmv.gov.br/combater-os-maus-tratos-aos-animais-e-um-dever-de-todos/comunicacao/noticias/2023/05/04/)
- [CFMV - Políticas de enfrentamento ao abandono](https://www.cfmv.gov.br/cfmv-discute-politicas-de-enfrentamento-ao-abandono-de-animais-no-ministerio-do-meio-ambiente/destaque/2024/03/15/)
- [Ministério da Saúde - Raiva Animal](https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/r/raiva/raiva-animal)
- [Ciência Rural - Características demográficas de cães e gatos de Votorantim](https://www.scielo.br/j/cr/a/3DqtCTw7BYsnqtFqyqFWndn/?format=html)
- [PubMed - Abundance, survival, recruitment and effectiveness of sterilization of free-roaming dogs](https://pubmed.ncbi.nlm.nih.gov/29091961/)

