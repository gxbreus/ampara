import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

type EventoPendente = { id: string; tipo: string; payload: unknown };

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(DATABASE_POOL) private readonly db: Pool, private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.publicarPendentes(), 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async publicarPendentes(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let connection: amqp.ChannelModel | undefined;
    try {
      connection = await amqp.connect(this.config.getOrThrow<string>('IDENTIDADE_AMQP_URL'));
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange('ampara.eventos', 'topic', { durable: true });
      const pendentes = await this.pendentes();
      for (const evento of pendentes) {
        channel.publish('ampara.eventos', evento.tipo, Buffer.from(JSON.stringify({
          messageId: evento.id,
          type: evento.tipo,
          payload: evento.payload,
          occurredAt: new Date().toISOString(),
        })), { contentType: 'application/json', messageId: evento.id, persistent: true });
        await channel.waitForConfirms();
        await this.db.query('UPDATE outbox SET publicado_em = now() WHERE id = $1 AND publicado_em IS NULL', [evento.id]);
      }
      await channel.close();
    } catch (error) {
      this.logger.warn({ err: error }, 'Não foi possível publicar eventos pendentes da outbox.');
    } finally {
      await connection?.close().catch(() => undefined);
      this.running = false;
    }
  }

  private async pendentes(): Promise<EventoPendente[]> {
    const { rows } = await this.db.query<EventoPendente>(
      'SELECT id, tipo, payload FROM outbox WHERE publicado_em IS NULL ORDER BY criado_em ASC LIMIT 20',
    );
    return rows;
  }
}
