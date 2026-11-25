import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

/** Declarada no definitions.json do broker; o usuário `identidade` não tem permissão de configure. */
export const EXCHANGE_EVENTOS = 'ampara.eventos';
const LOTE = 20;

export type EventoPendente = {
  id: string;
  tipo: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  criado_em: Date;
};

/** Envelope do catálogo (eventos.md §2) e propriedades AMQP que o repetem. */
export function montarMensagem(evento: EventoPendente): { conteudo: Buffer; propriedades: amqp.Options.Publish } {
  const correlationId = evento.correlation_id || evento.id;
  const envelope = {
    messageId: evento.id,
    type: evento.tipo,
    version: 1,
    correlationId,
    // conta.verificada não pertence a uma SAGA
    sagaId: null,
    // hora do fato: gravada na outbox na mesma transação da mudança de estado
    occurredAt: new Date(evento.criado_em).toISOString(),
    payload: evento.payload,
  };
  return {
    conteudo: Buffer.from(JSON.stringify(envelope)),
    propriedades: {
      contentType: 'application/json',
      messageId: evento.id,
      type: evento.tipo,
      correlationId,
      persistent: true,
      timestamp: Math.floor(new Date(evento.criado_em).getTime() / 1000),
    },
  };
}

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private conexao?: amqp.ChannelModel;
  private canal?: amqp.ConfirmChannel;

  constructor(@Inject(DATABASE_POOL) private readonly db: Pool, private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.publicarPendentes(), 1_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.conexao?.close().catch(() => undefined);
  }

  /**
   * Publica um lote de pendentes com publisher confirms e marca `publicado_em`.
   * As linhas ficam travadas com FOR UPDATE SKIP LOCKED durante a publicação, para
   * réplicas não publicarem o mesmo evento ao mesmo tempo. Se algo falhar depois de
   * publicar, a transação volta e o evento sai de novo (o consumidor deduplica pelo messageId).
   */
  async publicarPendentes(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let client: PoolClient | undefined;
    try {
      client = await this.db.connect();
      await client.query('BEGIN');
      const { rows } = await client.query<EventoPendente>(
        `SELECT id, tipo, payload, correlation_id, criado_em FROM outbox
         WHERE publicado_em IS NULL ORDER BY criado_em ASC LIMIT ${LOTE} FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) { await client.query('COMMIT'); return 0; }

      const canal = await this.obterCanal();
      for (const evento of rows) {
        const { conteudo, propriedades } = montarMensagem(evento);
        canal.publish(EXCHANGE_EVENTOS, evento.tipo, conteudo, propriedades);
      }
      await canal.waitForConfirms();
      await client.query('UPDATE outbox SET publicado_em = now() WHERE id = ANY($1::uuid[])', [rows.map((e) => e.id)]);
      await client.query('COMMIT');
      return rows.length;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      this.descartarCanal();
      this.logger.warn({ err: error }, 'Não foi possível publicar eventos pendentes da outbox.');
      return 0;
    } finally {
      client?.release();
      this.running = false;
    }
  }

  /** Reaproveita a conexão entre os ciclos; abre outra só se a anterior caiu. */
  private async obterCanal(): Promise<amqp.ConfirmChannel> {
    if (this.canal) return this.canal;
    const conexao = await amqp.connect(this.config.getOrThrow<string>('IDENTIDADE_AMQP_URL'));
    conexao.on('error', (err: unknown) => this.logger.warn({ err }, 'Conexão AMQP da outbox com erro.'));
    conexao.on('close', () => { if (this.conexao === conexao) this.descartarCanal(false); });
    const canal = await conexao.createConfirmChannel();
    canal.on('error', (err: unknown) => this.logger.warn({ err }, 'Canal AMQP da outbox com erro.'));
    canal.on('close', () => { if (this.canal === canal) this.canal = undefined; });
    this.conexao = conexao;
    this.canal = canal;
    return canal;
  }

  private descartarCanal(fechar = true): void {
    const conexao = this.conexao;
    this.conexao = undefined;
    this.canal = undefined;
    if (fechar) void conexao?.close().catch(() => undefined);
  }
}
