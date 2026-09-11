# Arquitetura da Ampara

## Visão geral

```mermaid
flowchart TB
    Mobile[Aplicativo mobile] --> Gateway[API Gateway]
    Web[Painel web] --> Gateway

    Gateway --> Identidade[Microsserviço de Identidade]
    Gateway --> Animais[Microsserviço de Animais]
    Gateway --> Adocao[Microsserviço de Adoção]
    Gateway --> Notificacoes[Microsserviço de Notificações]

    Identidade --> DB1[(PostgreSQL)]
    Animais --> DB2[(MongoDB)]
    Adocao --> DB3[(PostgreSQL)]
    Notificacoes --> DB4[(Redis)]

    Identidade <--> Eventos[RabbitMQ]
    Animais <--> Eventos
    Adocao <--> Eventos
    Notificacoes <--> Eventos
```

## Responsabilidades

### Identidade

Usa Node.js, NestJS e PostgreSQL. Mantém o cadastro, a autenticação e os perfis de protetores, ONGs e adotantes.

### Animais

Usa Python, FastAPI e MongoDB. Mantém cadastro, fotos, estado e localização. Também controla a reserva temporária durante uma solicitação de adoção.

### Adoção

Usa Go e PostgreSQL. Conduz o processo de adoção e atua como orquestrador da SAGA.

### Notificações

Usa Python, FastAPI e Redis. Envia avisos aos protetores, ONGs e adotantes nas etapas relevantes.

## Comunicação

- **API Gateway:** concentra roteamento e validação de JWT.
- **REST:** consultas e comandos que exigem resposta imediata passam pelo gateway.
- **Eventos:** mudanças relevantes são publicadas no RabbitMQ para reduzir o acoplamento entre serviços.
- **Dados:** cada serviço possui banco e credenciais próprios. Não existem consultas diretas ao banco de outro domínio.

## Clientes

- O aplicativo web permite que protetores e ONGs gerenciem animais e adoções.
- O aplicativo mobile permite que adotantes busquem animais próximos, solicitem adoções e recebam notificações.

## SAGA de conclusão da adoção

```mermaid
sequenceDiagram
    participant A as Adoção
    participant AN as Animais
    participant I as Identidade
    participant R as RabbitMQ
    participant N as Notificações

    A->>AN: Reservar animal
    AN-->>A: Reserva confirmada
    A->>I: Validar perfil do adotante
    I-->>A: Perfil válido
    A->>R: Publicar solicitação de adoção
    R->>N: Entregar evento
    N-->>A: Avisar protetor ou ONG
```

Se a solicitação for recusada ou expirar, o orquestrador solicita que Animais libere a reserva e publica um evento para Notificações avisar o adotante.
