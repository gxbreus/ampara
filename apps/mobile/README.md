# App Mobile

Cliente dos **adotantes**: busca por raio, detalhe do animal, solicitação de adoção, linha do tempo, notificações e assistente. Fala só com o gateway, em `/mobile/v1` e `/auth/v1`.

**Stack:** Expo SDK 58 / React Native / TypeScript, Expo Router e TanStack Query.
**Responsáveis:** Gabriel Cantanhede (#64) e Gabriel Nakazato (assistente, #65).

## Executar

Node 22+, Expo Go compatível com SDK 58 no telefone (ou emulador Android).
Dentro de `apps/mobile`:

```bash
npm ci
cp .env.example .env
# edite EXPO_PUBLIC_API_URL: IP da máquina do gateway, porta 8000
npm start
```

Celular e computador precisam estar na mesma rede. `localhost` aponta para o
próprio telefone. No emulador Android padrão use `http://10.0.2.2:8000`.
A autenticação usa `/auth/v1`, conforme o Kong atual; `/api/v1/auth` é o nome
antigo de alguns contratos/issues. Todas as outras chamadas usam `/mobile/v1`.

## Fluxos

- Busca pública com localização opcional, raio, espécie, porte, paginação e
  deduplicação por ID. Sem GPS há referências locais de Lavras, Belo Horizonte,
  São Paulo e Rio; outras cidades permitem informar latitude/longitude de referência.
  Nenhum geocodificador externo recebe a localização do usuário.
- Detalhe, cadastro/login de ADOTANTE, perfil e pedido com chave idempotente
  preservada ao tentar novamente. O token fica no SecureStore; 401 encerra a sessão.
- Solicitações e linha do tempo atualizam a cada 3 s até o estado final.
  O botão cancelar existe exclusivamente quando há `_links.cancelar`.
- Avisos e contador de não lidas atualizam a cada 10 s enquanto o app está ativo.
- A aba Assistente está reservada para #65.

## Verificar

```bash
npm run typecheck
npm run lint
npm test
npx expo export --platform android --output-dir dist
```

O teste de API verifica limite do gateway, token, idempotência e expiração de sessão.
Exportar o bundle não é um teste de interação no Android.

## Ensaio em aparelho (pendente)

- [ ] Negar localização; buscar em Lavras; ampliar raio; carregar mais sem repetir IDs.
- [ ] Abrir Thor, entrar como adotante e salvar o perfil.
- [ ] Solicitar adoção; acompanhar até AGUARDANDO_APROVACAO; aprovar pelo App Web.
- [ ] Ver CONCLUIDA e aviso com atualização automática do contador.
- [ ] Repetir com perfil incompleto; ver mensagem e atalho para os campos faltantes.
- [ ] Cancelar pelo link disponível; verificar desaparecimento da ação após o pivô.
- [ ] Fechar/reabrir o app e conferir SecureStore; expirar sessão e confirmar saída.
- [ ] Registrar screenshots/GIF e aparelho/versão no PR.

O ensaio depende de #43, #53, #56, #57, #59, #60 e #62 no ambiente integrado.
Esta máquina não tem aparelho/emulador conectado; nenhuma execução real é declarada.
