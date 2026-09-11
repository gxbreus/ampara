# ADR 001: Arquitetura distribuída por domínio

- Status: proposta
- Data: 2026-09-11

## Contexto

A disciplina exige quatro microsserviços independentes, bancos separados, dois clientes e uma transação de negócio que atravesse ao menos três serviços.

## Decisão

Separar o domínio em Ocorrências, Animais, Acolhimento e Adoções. Cada serviço usará uma instância PostgreSQL própria. Um API Gateway receberá chamadas dos clientes e o RabbitMQ distribuirá eventos.

## Consequências

- cada equipe de serviço controla seu modelo de dados;
- falhas parciais exigem idempotência, retentativas e operações compensatórias;
- consultas que combinem vários domínios não poderão depender de `JOIN` entre bancos;
- contratos de API e eventos precisam de versionamento.

