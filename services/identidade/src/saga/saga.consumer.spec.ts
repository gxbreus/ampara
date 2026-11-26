import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { BancoSagaFalso } from '../../test/support/banco-saga-falso';
import { CanalComandos, SagaConsumer } from './saga.consumer';
import { Resposta } from './saga.mensagens';
import { SagaService } from './saga.service';

const ADOTANTE = '5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55';

function comando(type: string, sagaId: string = randomUUID(), payload: Record<string, unknown> = { adotanteId: ADOTANTE }, messageId: string = randomUUID()) {
  const envelope = { messageId, type, version: 1, correlationId: 'c-teste', sagaId, occurredAt: new Date().toISOString(), payload };
  return { envelope, mensagem: { content: Buffer.from(JSON.stringify(envelope)), fields: {}, properties: {} } as unknown as amqp.ConsumeMessage };
}

function cenario() {
  const banco = new BancoSagaFalso();
  const service = new SagaService(banco.pool);
  const consumer = new SagaConsumer(service, { getOrThrow: () => 'amqp://nao-usado' } as unknown as ConfigService);
  const eventos: string[] = [];
  const publicadas: { exchange: string; rota: string; corpo: Resposta; propriedades: amqp.Options.Publish }[] = [];
  const canal = {
    publish: jest.fn((exchange: string, rota: string, conteudo: Buffer, propriedades: amqp.Options.Publish) => {
      eventos.push('publish');
      publicadas.push({ exchange, rota, corpo: JSON.parse(conteudo.toString()) as Resposta, propriedades });
      return true;
    }),
    waitForConfirms: jest.fn(() => { eventos.push('confirm'); return Promise.resolve(); }),
    ack: jest.fn(() => { eventos.push('ack'); }),
    nack: jest.fn((_m: unknown, _all?: boolean, requeue?: boolean) => { eventos.push(requeue ? 'nack-requeue' : 'nack-dlq'); }),
  };
  return { banco, service, consumer, canal: canal as typeof canal & CanalComandos, eventos, publicadas };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('SagaConsumer.receber', () => {
  it('ValidarPerfil com perfil completo: commit → publish → confirm → ack, e ocupa 1 vaga', async () => {
    const { banco, consumer, canal, eventos, publicadas } = cenario();
    banco.adotante(ADOTANTE);
    const { envelope, mensagem } = comando('ValidarPerfil');

    await consumer.receber(mensagem, canal);

    expect(eventos).toEqual(['publish', 'confirm', 'ack']);
    expect(banco.estado.vagas.get(ADOTANTE)).toBe(envelope.sagaId);
    expect(publicadas[0]).toMatchObject({
      exchange: 'ampara.respostas', rota: 'orquestrador',
      corpo: { type: 'PerfilValidado', version: 1, correlationId: 'c-teste', sagaId: envelope.sagaId, payload: { adotanteId: ADOTANTE } },
      propriedades: { type: 'PerfilValidado', correlationId: 'c-teste', persistent: true, contentType: 'application/json' },
    });
    expect(publicadas[0].propriedades.messageId).toBe(publicadas[0].corpo.messageId);
    expect(banco.consultas.find((sql) => sql.includes('FROM contas c LEFT JOIN'))).toContain('FOR UPDATE OF c');
  });

  it('idempotência: o mesmo messageId duas vezes ocupa a vaga uma vez e publica respostas idênticas', async () => {
    const { banco, consumer, canal, publicadas } = cenario();
    banco.adotante(ADOTANTE);
    const { mensagem } = comando('ValidarPerfil');

    await consumer.receber(mensagem, canal);
    const vagasDepoisDaPrimeira = new Map(banco.estado.vagas);
    await consumer.receber(mensagem, canal);

    expect(canal.ack).toHaveBeenCalledTimes(2);
    expect(banco.estado.vagas).toEqual(vagasDepoisDaPrimeira);
    expect(banco.estado.vagas.size).toBe(1);
    expect(banco.estado.inbox.size).toBe(1);
    expect(publicadas).toHaveLength(2);
    expect(publicadas[1].corpo).toEqual(publicadas[0].corpo);
    expect(publicadas[1].propriedades).toEqual(publicadas[0].propriedades);
    // a segunda entrega não chega a consultar a conta: sai da inbox
    expect(banco.consultas.filter((sql) => sql.includes('FROM contas c LEFT JOIN'))).toHaveLength(1);
  });

  it('falha entre o commit e o publish: volta para a fila e, na reentrega, republica a mesma resposta sem novo efeito', async () => {
    const { banco, consumer, canal, eventos, publicadas } = cenario();
    banco.adotante(ADOTANTE);
    const { mensagem } = comando('ValidarPerfil');
    // o broker não confirma a primeira publicação (o processo "cai" depois do commit)
    canal.waitForConfirms.mockImplementationOnce(() => { eventos.push('confirm-falhou'); return Promise.reject(new Error('canal fechado')); });

    await consumer.receber(mensagem, canal);
    expect(eventos).toEqual(['publish', 'confirm-falhou', 'nack-requeue']);
    expect(canal.ack).not.toHaveBeenCalled();
    expect(banco.estado.vagas.size).toBe(1); // o efeito já tinha sido commitado
    expect(banco.estado.inbox.size).toBe(1);

    await consumer.receber(mensagem, canal);
    expect(eventos.slice(3)).toEqual(['publish', 'confirm', 'ack']);
    expect(publicadas[1].corpo).toEqual(publicadas[0].corpo);
    expect(banco.estado.vagas.size).toBe(1);
  });

  it('falha antes do commit desfaz o efeito e volta para a fila', async () => {
    const { banco, consumer, canal, eventos } = cenario();
    banco.adotante(ADOTANTE);
    banco.falharEm = { trecho: 'INSERT INTO inbox', erro: new Error('conexão perdida') };

    await consumer.receber(comando('ValidarPerfil').mensagem, canal);

    expect(eventos).toEqual(['nack-requeue']);
    expect(banco.estado.vagas.size).toBe(0);
    expect(banco.estado.inbox.size).toBe(0);
  });

  it.each([
    ['adotanteId que não é UUID', comando('ValidarPerfil', randomUUID(), { adotanteId: 'nao-e-uuid' }).mensagem],
    ['JSON quebrado', { content: Buffer.from('{"type":'), fields: {}, properties: {} } as unknown as amqp.ConsumeMessage],
    ['version desconhecida', { content: Buffer.from(JSON.stringify({ ...comando('ValidarPerfil').envelope, version: 2 })), fields: {}, properties: {} } as unknown as amqp.ConsumeMessage],
  ])('%s: nack sem requeue (direto para a DLQ), sem tocar no banco', async (_caso, mensagem) => {
    const { banco, consumer, canal, eventos } = cenario();
    await consumer.receber(mensagem, canal);
    expect(eventos).toEqual(['nack-dlq']);
    expect(canal.nack).toHaveBeenCalledWith(mensagem, false, false);
    expect(banco.consultas).toEqual([]);
  });

  it('nack com o canal fechado não gera promise rejeitada', async () => {
    const { banco, consumer, canal } = cenario();
    banco.adotante(ADOTANTE);
    canal.waitForConfirms.mockRejectedValueOnce(new Error('canal fechado'));
    canal.nack.mockImplementationOnce(() => { throw new Error('Channel closed'); });

    await expect(consumer.receber(comando('ValidarPerfil').mensagem, canal)).resolves.toBeUndefined();

    const invalida = comando('ValidarPerfil', randomUUID(), { adotanteId: 'x' }).mensagem;
    canal.nack.mockImplementationOnce(() => { throw new Error('Channel closed'); });
    await expect(consumer.receber(invalida, canal)).resolves.toBeUndefined();
  });
});

describe('SagaService (regras do T2, C2 e T5)', () => {
  async function processar(banco: BancoSagaFalso, type: string, sagaId: string, payload: Record<string, unknown> = { adotanteId: ADOTANTE }) {
    const service = new SagaService(banco.pool);
    const { envelope } = comando(type, sagaId, payload);
    return (await service.processar(envelope as Parameters<SagaService['processar']>[0])).resposta;
  }

  it('perfil incompleto: PERFIL_INCOMPLETO com os camposFaltando, sem ocupar vaga', async () => {
    const banco = new BancoSagaFalso();
    banco.adotante(ADOTANTE, { tem_quintal: null, aceite_termo_em: null });
    const resposta = await processar(banco, 'ValidarPerfil', randomUUID());
    expect(resposta).toMatchObject({ type: 'PerfilRecusado', payload: { adotanteId: ADOTANTE, motivo: 'PERFIL_INCOMPLETO', camposFaltando: ['temQuintal', 'aceiteTermo'] } });
    expect(banco.estado.vagas.size).toBe(0);
  });

  it('segunda SAGA com a vaga ocupada: LIMITE_SOLICITACOES; a mesma SAGA com outro messageId: PerfilValidado', async () => {
    const banco = new BancoSagaFalso();
    banco.adotante(ADOTANTE);
    const saga = randomUUID();
    expect((await processar(banco, 'ValidarPerfil', saga)).type).toBe('PerfilValidado');
    expect((await processar(banco, 'ValidarPerfil', saga)).type).toBe('PerfilValidado');
    expect(await processar(banco, 'ValidarPerfil', randomUUID())).toMatchObject({ type: 'PerfilRecusado', payload: { motivo: 'LIMITE_SOLICITACOES' } });
    expect(banco.estado.vagas.size).toBe(1);
  });

  it('LiberarVaga antes do ValidarPerfil (mesmo sagaId): SAGA_ENCERRADA sem ocupar vaga', async () => {
    const banco = new BancoSagaFalso();
    banco.adotante(ADOTANTE);
    const saga = randomUUID();
    expect(await processar(banco, 'LiberarVaga', saga)).toMatchObject({ type: 'VagaLiberada', payload: { adotanteId: ADOTANTE, liberou: false } });
    expect(await processar(banco, 'ValidarPerfil', saga)).toMatchObject({ type: 'PerfilRecusado', payload: { motivo: 'SAGA_ENCERRADA' } });
    expect(banco.estado.vagas.size).toBe(0);
  });

  it('LiberarVaga é idempotente e libera a vaga da SAGA', async () => {
    const banco = new BancoSagaFalso();
    banco.adotante(ADOTANTE);
    const saga = randomUUID();
    await processar(banco, 'ValidarPerfil', saga);
    expect((await processar(banco, 'LiberarVaga', saga)).payload).toEqual({ adotanteId: ADOTANTE, liberou: true });
    expect((await processar(banco, 'LiberarVaga', saga)).payload).toEqual({ adotanteId: ADOTANTE, liberou: false });
    expect(banco.estado.vagas.size).toBe(0);
  });

  it('conta inexistente ou que não é ADOTANTE: CONTA_INEXISTENTE', async () => {
    const banco = new BancoSagaFalso();
    expect((await processar(banco, 'ValidarPerfil', randomUUID())).payload).toMatchObject({ motivo: 'CONTA_INEXISTENTE' });
    banco.adotante(ADOTANTE, {}, 'ONG');
    expect((await processar(banco, 'ValidarPerfil', randomUUID())).payload).toMatchObject({ motivo: 'CONTA_INEXISTENTE' });
  });

  it('RegistrarAdocao grava o histórico e libera a vaga', async () => {
    const banco = new BancoSagaFalso();
    banco.adotante(ADOTANTE);
    const saga = randomUUID();
    await processar(banco, 'ValidarPerfil', saga);
    const animalId = '65a2f1c4e8b9d3a7f0c1b2d4';
    expect(await processar(banco, 'RegistrarAdocao', saga, { adotanteId: ADOTANTE, animalId })).toMatchObject({ type: 'AdocaoRegistrada', payload: { adotanteId: ADOTANTE, animalId } });
    expect(banco.estado.historico.get(saga)).toEqual({ adotanteId: ADOTANTE, animalId });
    expect(banco.estado.vagas.size).toBe(0);
  });
});
