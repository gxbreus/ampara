# ADR 001: Arquitetura técnica preliminar

- Status: preliminar para a Parte 1
- Data: 2026-09-11

## Contexto

A apresentação em sala incluirá a arquitetura a pedido do professor. O sistema deve demonstrar quatro microsserviços independentes, um banco por serviço, dois clientes distintos e uma transação SAGA que atravesse ao menos três serviços.

## Decisão

- **Identidade:** Node.js/NestJS com PostgreSQL. Cadastro e autenticação de protetores, ONGs e adotantes.
- **Animais:** Python/FastAPI com MongoDB. Cadastro de animais, fotos, status e localização.
- **Adoção:** Go com PostgreSQL. Conduz o processo de adoção ponta a ponta e orquestra a SAGA.
- **Notificações:** Python/FastAPI com Redis. Envio de notificações a cada etapa relevante.
- **Clientes:** App Web para protetores e ONGs e App Mobile para adotantes.
- **Comunicação:** API Gateway para roteamento e validação de JWT e RabbitMQ como barramento de eventos.

## SAGA

O serviço de Adoção reserva o animal em Animais, valida o perfil do adotante em Identidade, publica um evento no RabbitMQ e aciona Notificações para avisar o protetor ou a ONG responsável.

Se a solicitação for recusada ou expirar, a compensação libera a reserva do animal e Notificações avisa o adotante.
