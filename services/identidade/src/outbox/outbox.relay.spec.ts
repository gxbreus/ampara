import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { EventoPendente, OutboxRelay, montarMensagem } from './outbox.relay';

jest.mock('amqplib', () => ({ connect: jest.fn() }));
const amqp = jest.requireMock<{ connect: jest.Mock }>('amqplib');

const evento: EventoPendente = {
  id: '0b8f6c2e-91d4-4a7b-8e13-5c2f9a0d4e61',
  tipo: 'conta.verificada',
  payload: { contaId: 'c50a83ab-7db0-41b4-9436-4144c36f97d5', nome: 'ONG Patas de Lavras', role: 'ONG', cidade: 'Lavras' },
  correlation_id: 'c-91a3f2',
  criado_em: new Date('2026-11-17T15:00:00.000Z'),
};

describe('montarMensagem', () => {
  it('monta o envelope do catálogo (eventos.md §2), sem campos extras', () => {
    const { conteudo } = montarMensagem(evento);
    const envelope = JSON.parse(conteudo.toString()) as Record<string, unknown>;
    expect(envelope).toEqual({
      messageId: evento.id,
      type: 'conta.verificada',
      version: 1,
      correlationId: 'c-91a3f2',
      sagaId: null,
      occurredAt: '2026-11-17T15:00:00.000Z',
      payload: evento.payload,
    });
  });

  it('occurredAt é a hora gravada na outbox, não a da publicação', () => {
    const envelope = JSON.parse(montarMensagem({ ...evento, criado_em: new Date('2020-01-01T00:00:00Z') }).conteudo.toString()) as { occurredAt: string };
    expect(envelope.occurredAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('as propriedades AMQP repetem o envelope', () => {
    expect(montarMensagem(evento).propriedades).toMatchObject({
      contentType: 'application/json', messageId: evento.id, type: 'conta.verificada', correlationId: 'c-91a3f2', persistent: true,
    });
  });

  it('sem correlation_id gravado, usa o messageId para não sair vazio', () => {
    const { conteudo, propriedades } = montarMensagem({ ...evento, correlation_id: null });
    expect((JSON.parse(conteudo.toString()) as { correlationId: string }).correlationId).toBe(evento.id);
    expect(propriedades.correlationId).toBe(evento.id);
  });
});

describe('OutboxRelay.publicarPendentes', () => {
  function cenario(pendentes: EventoPendente[], opcoes: { confirmaFalha?: boolean } = {}) {
    const consultas: string[] = [];
    const client = {
      query: jest.fn((sql: string, _params?: unknown[]) => {
        consultas.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        return Promise.resolve({ rows: sql.includes('FROM outbox') ? pendentes : [] });
      }),
      release: jest.fn(),
    };
    const canal = Object.assign(new EventEmitter(), {
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn(() => (opcoes.confirmaFalha ? Promise.reject(new Error('nack do broker')) : Promise.resolve())),
      assertExchange: jest.fn(),
    });
    const conexao = Object.assign(new EventEmitter(), {
      createConfirmChannel: jest.fn(() => Promise.resolve(canal)),
      close: jest.fn(() => Promise.resolve()),
    });
    amqp.connect.mockReset().mockResolvedValue(conexao);
    const db = { connect: jest.fn(() => Promise.resolve(client)) } as unknown as Pool;
    const config = { getOrThrow: () => 'amqp://identidade@rabbitmq' } as unknown as ConfigService;
    return { relay: new OutboxRelay(db, config), client, canal, conexao, consultas };
  }

  it('publica em ampara.eventos sem declarar a exchange e marca publicado_em depois do confirm', async () => {
    const { relay, canal, client, consultas } = cenario([evento]);
    await expect(relay.publicarPendentes()).resolves.toBe(1);

    expect(canal.assertExchange).not.toHaveBeenCalled();
    expect(canal.publish).toHaveBeenCalledWith('ampara.eventos', 'conta.verificada', expect.any(Buffer), expect.objectContaining({ type: 'conta.verificada' }));
    expect(consultas).toEqual(['BEGIN', 'SELECT id,', 'UPDATE outbox', 'COMMIT']);
    expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(client.query.mock.calls[2][1]).toEqual([[evento.id]]);
    expect(client.release).toHaveBeenCalled();
  });

  it('sem pendentes, não abre conexão com o broker', async () => {
    const { relay, consultas } = cenario([]);
    await expect(relay.publicarPendentes()).resolves.toBe(0);
    expect(amqp.connect).not.toHaveBeenCalled();
    expect(consultas).toEqual(['BEGIN', 'SELECT id,', 'COMMIT']);
  });

  it('se o broker não confirma, desfaz a transação e não marca publicado_em', async () => {
    const { relay, consultas, conexao } = cenario([evento], { confirmaFalha: true });
    await expect(relay.publicarPendentes()).resolves.toBe(0);
    expect(consultas).toEqual(['BEGIN', 'SELECT id,', 'ROLLBACK']);
    expect(conexao.close).toHaveBeenCalled();
  });

  it('reaproveita a conexão entre ciclos', async () => {
    const { relay } = cenario([evento]);
    await relay.publicarPendentes();
    await relay.publicarPendentes();
    expect(amqp.connect).toHaveBeenCalledTimes(1);
  });
});
