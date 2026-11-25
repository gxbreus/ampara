# App Mobile

Cliente dos **adotantes**: busca por raio, detalhe do animal, solicitação de adoção, linha do tempo, notificações e assistente. Fala só com o gateway, em `/mobile/v1` e `/auth/v1`.

**Stack:** React + Vite, web responsiva (mobile-first). Substitui o Expo, ver a decisão 6 em [requisitos](../../docs/requisitos.md) · **Responsável:** Mateus (#64, #65; integração na #199)

É um cliente separado do App Web, com outro público e outro BFF. A diferença entre os payloads de `/mobile/v1` e `/web/v1` continua visível na demo (RA-11).
