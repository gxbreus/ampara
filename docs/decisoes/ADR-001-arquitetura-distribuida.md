# ADR 001: Arquitetura distribuída por domínio

- Status: aceita para a Parte 1
- Data: 2026-09-11

## Contexto

A disciplina exige quatro microsserviços independentes, bancos separados, dois clientes e uma transação de negócio que atravesse ao menos três serviços.

## Decisão

Separar o sistema em Identidade, Animais, Adoção e Notificações. Identidade usa Node.js, NestJS e PostgreSQL. Animais usa Python, FastAPI e MongoDB. Adoção usa Go e PostgreSQL e orquestra a SAGA. Notificações usa Python, FastAPI e Redis. Um API Gateway recebe as chamadas dos clientes e o RabbitMQ distribui eventos.

## Consequências

- cada equipe de serviço controla seu modelo de dados;
- falhas parciais exigem idempotência, retentativas e operações compensatórias;
- consultas que combinem vários domínios não poderão depender de `JOIN` entre bancos;
- contratos de API e eventos precisam de versionamento.
