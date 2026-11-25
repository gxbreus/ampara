import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { gerarHashSenha } from '../../src/auth/senha';
import { OutboxRelay } from '../../src/outbox/outbox.relay';
import { AppDeTeste, criarApp } from '../support/app';

/**
 * Verificação de conta + outbox + relay contra PostgreSQL e RabbitMQ reais
 * (o pg-mem não implementa FOR UPDATE SKIP LOCKED). Roda só com
 * IDENTIDADE_TEST_DATABASE_URL; a parte do broker também exige:
 *   IDENTIDADE_TEST_AMQP_URL        usuário `identidade` (sem permissão de configure)
 *   IDENTIDADE_TEST_AMQP_ADMIN_URL  usuário que cria a fila temporária de inspeção
 */
const comPostgres = process.env.IDENTIDADE_TEST_DATABASE_URL ? describe : describe.skip;
const amqpUrl = process.env.IDENTIDADE_TEST_AMQP_URL;
const amqpAdminUrl = process.env.IDENTIDADE_TEST_AMQP_ADMIN_URL;
const comBroker = amqpUrl && amqpAdminUrl ? it : it.skip;

comPostgres('Identidade (e2e, PostgreSQL real): verificação de conta e outbox', () => {
  let ctx: AppDeTeste;
  let http: App;
  let tokenAdmin: string;

  beforeAll(async () => {
    ctx = await criarApp();
    http = ctx.app.getHttpServer() as App;
    await ctx.banco.pool.query(
      `INSERT INTO contas (id, nome, email, senha_hash, cidade, role, status_verificacao) VALUES ($1, 'Admin', 'admin@example.com', $2, 'Lavras', 'ADMIN', 'VERIFICADA')`,
      [randomUUID(), await gerarHashSenha('senha-do-admin-123')],
    );
    tokenAdmin = (await request(http).post('/v1/auth/sessoes').send({ email: 'admin@example.com', senha: 'senha-do-admin-123' })).body.accessToken;
  });

  afterAll(async () => { await ctx?.encerrar(); });

  async function novaOng(email: string) {
    const resposta = await request(http).post('/v1/auth/contas').send({ nome: 'ONG Patas de Lavras', email, senha: 'senha-de-exemplo-segura', cidade: 'Lavras', tipo: 'ONG' });
    expect(resposta.body.statusVerificacao).toBe('PENDENTE_VERIFICACAO');
    return resposta.body.id as string;
  }

  const verificar = (id: string, correlationId = 'c-teste') => request(http)
    .put(`/v1/contas/${id}/verificacao`).set('Authorization', `Bearer ${tokenAdmin}`).set('X-Correlation-Id', correlationId).send({ status: 'VERIFICADA' });

  it('grava conta.verificada na outbox uma vez só, com o correlationId da requisição', async () => {
    const id = await novaOng('ong-outbox@example.com');
    const primeira = await verificar(id, 'c-91a3f2');
    expect(primeira.status).toBe(200);
    expect(primeira.body.statusVerificacao).toBe('VERIFICADA');
    expect((await verificar(id, 'c-outra')).status).toBe(200);

    const { rows } = await ctx.banco.pool.query(`SELECT tipo, payload, correlation_id FROM outbox WHERE payload->>'contaId' = $1`, [id]);
    expect(rows).toEqual([{ tipo: 'conta.verificada', payload: { contaId: id, nome: 'ONG Patas de Lavras', role: 'ONG', cidade: 'Lavras' }, correlation_id: 'c-91a3f2' }]);
  });

  it('id que não é UUID responde 404 e ADOTANTE responde 409, em problem+json', async () => {
    const naoUuid = await verificar('123');
    expect(naoUuid.status).toBe(404);
    expect(naoUuid.headers['content-type']).toMatch(/^application\/problem\+json/);

    const adotante = await request(http).post('/v1/auth/contas').send({ nome: 'Bruna', email: 'bruna-verif@example.com', senha: 'senha-de-exemplo-segura', cidade: 'Lavras', tipo: 'ADOTANTE' });
    const conflito = await verificar(adotante.body.id);
    expect(conflito.status).toBe(409);
    expect(conflito.body.type).toBe('https://ampara.dev/problemas/conta-nao-verificavel');
  });

  comBroker('o relay publica o envelope do catálogo em ampara.eventos com o usuário identidade', async () => {
    const id = await novaOng('ong-relay@example.com');
    await verificar(id, 'c-relay');

    const admin = await amqp.connect(amqpAdminUrl!);
    const canal = await admin.createChannel();
    const { queue } = await canal.assertQueue('', { exclusive: true });
    await canal.bindQueue(queue, 'ampara.eventos', 'conta.verificada');

    const config = { getOrThrow: () => amqpUrl } as unknown as ConfigService;
    const relay = new OutboxRelay(ctx.banco.pool, config);
    try {
      const publicados = await relay.publicarPendentes();
      expect(publicados).toBeGreaterThanOrEqual(1);

      const mensagens: amqp.GetMessage[] = [];
      for (let i = 0; i < 20; i++) {
        let msg: amqp.GetMessage | false;
        while ((msg = await canal.get(queue, { noAck: true }))) mensagens.push(msg);
        if (mensagens.some((m) => m.content.includes(id))) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const mensagem = mensagens.find((m) => m.content.includes(id));
      expect(mensagem).toBeDefined();
      const envelope = JSON.parse(mensagem!.content.toString()) as Record<string, unknown>;
      expect(Object.keys(envelope).sort()).toEqual(['correlationId', 'messageId', 'occurredAt', 'payload', 'sagaId', 'type', 'version']);
      expect(envelope).toMatchObject({ type: 'conta.verificada', version: 1, correlationId: 'c-relay', sagaId: null, payload: { contaId: id } });
      expect(mensagem!.properties).toMatchObject({ type: 'conta.verificada', correlationId: 'c-relay', messageId: envelope.messageId, contentType: 'application/json', deliveryMode: 2 });

      const { rows } = await ctx.banco.pool.query(`SELECT criado_em, publicado_em FROM outbox WHERE id = $1`, [envelope.messageId]);
      expect(rows[0].publicado_em).not.toBeNull();
      expect(new Date(envelope.occurredAt as string).getTime()).toBe(new Date(rows[0].criado_em as Date).getTime());
    } finally {
      await relay.onModuleDestroy();
      await admin.close();
    }
  });
});
