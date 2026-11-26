import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { SagaConsumer } from '../../src/saga/saga.consumer';
import { Comando, Resposta } from '../../src/saga/saga.mensagens';
import { SagaService } from '../../src/saga/saga.service';
import { BancoDeTeste, criarBanco } from '../support/banco';

/**
 * Integração da SAGA com PostgreSQL real (o pg-mem não entende `FOR UPDATE OF c`) e,
 * opcionalmente, com o RabbitMQ real montado pelo infra/rabbitmq (definitions.json e
 * usuário `identidade` sem configure). Variáveis: as mesmas de verificacao.e2e-spec.ts.
 * Atenção: a parte do broker consome identidade.comandos e esvazia orquestrador.respostas;
 * use um broker descartável.
 */
const comPostgres = process.env.IDENTIDADE_TEST_DATABASE_URL ? describe : describe.skip;
const amqpUrl = process.env.IDENTIDADE_TEST_AMQP_URL;
const amqpAdminUrl = process.env.IDENTIDADE_TEST_AMQP_ADMIN_URL;
const comBroker = amqpUrl && amqpAdminUrl ? describe : describe.skip;

comPostgres('SAGA da Identidade (PostgreSQL real)', () => {
  let banco: BancoDeTeste;
  let service: SagaService;

  beforeAll(async () => {
    banco = await criarBanco();
    service = new SagaService(banco.pool);
  });
  afterAll(async () => { await banco?.encerrar(); });

  async function novoAdotante(perfilCompleto = true): Promise<string> {
    const id = randomUUID();
    await banco.pool.query(
      `INSERT INTO contas (id, nome, email, senha_hash, cidade, role, status_verificacao) VALUES ($1, 'Bruna', $2, 'x', 'Lavras', 'ADOTANTE', 'VERIFICADA')`,
      [id, `${id}@example.com`],
    );
    await banco.pool.query(
      `INSERT INTO perfis_adocao (conta_id, tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em) VALUES ($1, 'CASA', $2, false, 4, $3)`,
      [id, perfilCompleto ? true : null, perfilCompleto ? new Date() : null],
    );
    return id;
  }

  const comando = (type: Comando['type'], adotanteId: string, sagaId: string = randomUUID(), extra: Record<string, unknown> = {}): Comando => ({
    messageId: randomUUID(), type, version: 1, correlationId: 'c-integracao', sagaId, occurredAt: new Date().toISOString(),
    payload: { adotanteId, ...extra } as Comando['payload'],
  });
  const vagas = async (adotanteId: string) => (await banco.pool.query('SELECT saga_id FROM vagas_solicitacao WHERE adotante_id = $1', [adotanteId])).rows;

  it('perfil completo: PerfilValidado e uma linha em vagas_solicitacao (FOR UPDATE OF c aceito pelo PostgreSQL)', async () => {
    const adotante = await novoAdotante();
    const cmd = comando('ValidarPerfil', adotante);
    const { resposta } = await service.processar(cmd);
    expect(resposta).toMatchObject({ type: 'PerfilValidado', sagaId: cmd.sagaId, correlationId: 'c-integracao', payload: { adotanteId: adotante } });
    expect(await vagas(adotante)).toEqual([{ saga_id: cmd.sagaId }]);
  });

  it('o mesmo messageId duas vezes ocupa a vaga uma vez e devolve respostas idênticas', async () => {
    const adotante = await novoAdotante();
    const cmd = comando('ValidarPerfil', adotante);
    const primeira = await service.processar(cmd);
    const segunda = await service.processar(cmd);
    expect(segunda).toEqual({ resposta: primeira.resposta, repetido: true });
    expect(await vagas(adotante)).toHaveLength(1);
  });

  it('perfil incompleto: PERFIL_INCOMPLETO com os camposFaltando', async () => {
    const adotante = await novoAdotante(false);
    const { resposta } = await service.processar(comando('ValidarPerfil', adotante));
    expect(resposta.payload).toEqual({ adotanteId: adotante, motivo: 'PERFIL_INCOMPLETO', camposFaltando: ['temQuintal', 'aceiteTermo'] });
    expect(await vagas(adotante)).toHaveLength(0);
  });

  it('segunda solicitação com a vaga ocupada: LIMITE_SOLICITACOES', async () => {
    const adotante = await novoAdotante();
    await service.processar(comando('ValidarPerfil', adotante));
    const { resposta } = await service.processar(comando('ValidarPerfil', adotante));
    expect(resposta.payload).toMatchObject({ motivo: 'LIMITE_SOLICITACOES' });
  });

  it('LiberarVaga antes do ValidarPerfil (mesmo sagaId): SAGA_ENCERRADA; LiberarVaga repetido não dá erro', async () => {
    const adotante = await novoAdotante();
    const saga = randomUUID();
    expect((await service.processar(comando('LiberarVaga', adotante, saga))).resposta.payload).toEqual({ adotanteId: adotante, liberou: false });
    expect((await service.processar(comando('LiberarVaga', adotante, saga))).resposta.payload).toEqual({ adotanteId: adotante, liberou: false });
    expect((await service.processar(comando('ValidarPerfil', adotante, saga))).resposta.payload).toMatchObject({ motivo: 'SAGA_ENCERRADA' });
    expect(await vagas(adotante)).toHaveLength(0);
  });

  it('ValidarPerfil concorrente para o mesmo adotante ocupa uma vaga só', async () => {
    const adotante = await novoAdotante();
    const respostas = await Promise.all([0, 1, 2].map(() => service.processar(comando('ValidarPerfil', adotante))));
    expect(respostas.filter((r) => r.resposta.type === 'PerfilValidado')).toHaveLength(1);
    expect(await vagas(adotante)).toHaveLength(1);
  });

  it('RegistrarAdocao grava o histórico e libera a vaga', async () => {
    const adotante = await novoAdotante();
    const saga = randomUUID();
    await service.processar(comando('ValidarPerfil', adotante, saga));
    const { resposta } = await service.processar(comando('RegistrarAdocao', adotante, saga, { animalId: '65a2f1c4e8b9d3a7f0c1b2d4' }));
    expect(resposta.type).toBe('AdocaoRegistrada');
    expect(await vagas(adotante)).toHaveLength(0);
    const { rows } = await banco.pool.query('SELECT animal_id FROM adocoes_historico WHERE saga_id = $1', [saga]);
    expect(rows).toEqual([{ animal_id: '65a2f1c4e8b9d3a7f0c1b2d4' }]);
  });

  comBroker('com RabbitMQ real', () => {
    let admin: amqp.ChannelModel;
    let canal: amqp.Channel;
    let consumer: SagaConsumer;

    beforeAll(async () => {
      for (const nivel of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined);
      admin = await amqp.connect(amqpAdminUrl!);
      canal = await admin.createChannel();
      await canal.purgeQueue('orquestrador.respostas');
      await canal.purgeQueue('identidade.comandos.dlq');
      consumer = new SagaConsumer(service, { getOrThrow: () => amqpUrl } as unknown as ConfigService);
      consumer.onApplicationBootstrap();
    });

    afterAll(async () => {
      await consumer?.onModuleDestroy();
      await admin?.close();
      jest.restoreAllMocks();
    });

    async function esperar(fila: string, quantas: number): Promise<amqp.GetMessage[]> {
      const recebidas: amqp.GetMessage[] = [];
      for (let i = 0; i < 100 && recebidas.length < quantas; i++) {
        const msg = await canal.get(fila, { noAck: true });
        if (msg) recebidas.push(msg); else await new Promise((r) => setTimeout(r, 100));
      }
      return recebidas;
    }

    const publicar = (corpo: unknown) =>
      canal.publish('ampara.comandos', 'identidade', Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo)), { contentType: 'application/json', persistent: true });

    it('responde em ampara.respostas/orquestrador e o comando repetido recebe a mesma resposta', async () => {
      const adotante = await novoAdotante();
      const cmd = comando('ValidarPerfil', adotante);
      publicar(cmd);
      publicar(cmd);
      const respostas = await esperar('orquestrador.respostas', 2);
      expect(respostas).toHaveLength(2);
      const [a, b] = respostas.map((m) => JSON.parse(m.content.toString()) as Resposta);
      expect(a).toMatchObject({ type: 'PerfilValidado', sagaId: cmd.sagaId, correlationId: cmd.correlationId });
      expect(b).toEqual(a);
      expect(respostas[0].properties).toMatchObject({ type: 'PerfilValidado', correlationId: cmd.correlationId, messageId: a.messageId });
      expect(await vagas(adotante)).toHaveLength(1);
    });

    it('payload com UUID inválido vai direto para identidade.comandos.dlq', async () => {
      publicar({ ...comando('ValidarPerfil', randomUUID()), payload: { adotanteId: 'nao-e-uuid' } });
      publicar('{"json":');
      const mortas = await esperar('identidade.comandos.dlq', 2);
      expect(mortas).toHaveLength(2);
      // direto, sem as 5 devoluções: o x-death registra uma rejeição só
      for (const morta of mortas) {
        const xDeath = (morta.properties.headers?.['x-death'] as { count: number; reason: string }[])[0];
        expect(xDeath).toMatchObject({ reason: 'rejected', count: 1 });
      }
    });
  });
});
