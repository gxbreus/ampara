# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Protetores, ONGs e administradores usam o App Web para cadastrar e gerir animais, acompanhar solicitações de adoção e, quando aplicável, verificar contas.

## Product Purpose

A Ampara conecta adotantes a animais de protetores e ONGs. No painel, o responsável acompanha a solicitação até sua conclusão ou compensação pela SAGA.

## Positioning

O painel decide solicitações somente a partir dos links HATEOAS fornecidos pelo BFF; ele não infere ações pelo estado da adoção.

## Operating Context

O cliente web fala somente com o gateway, usando autenticação JWT e as rotas `/auth/v1` e `/web/v1`. A lista de solicitações é atualizada periodicamente para tornar visível a evolução assíncrona da SAGA.

## Capabilities and Constraints

React, Vite e TypeScript são a stack proposta na issue #63. O token fica em memória e em `sessionStorage`; falhas 401 retornam à entrada. Dados do painel, animais e parte das integrações ainda dependem das issues #45, #47, #53 e #61; valores demonstrativos precisam ser identificados como tal.

## Evidence on Hand

Os contratos do BFF estão em `docs/contratos/bff-web.v1.yaml`, e o BFF Web já expõe a documentação em `bff/web/README.md`. Não há ativos de marca nem uma interface anterior no repositório.

## Product Principles

- Exibir o trabalho operacional com clareza, sem esconder estado ou erro.
- Respeitar os contratos e os links fornecidos pelo backend.
- Tornar ações críticas deliberadas e reversíveis quando o fluxo permitir.
- Não transformar dados demonstrativos em alegações reais.

## Accessibility & Inclusion

Os campos têm rótulos, o fluxo é navegável por teclado e as combinações de texto seguem contraste AA, conforme a issue #63.
