import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

type CommandType = 'ValidarPerfil' | 'LiberarVaga' | 'RegistrarAdocao';
type Envelope = {
  messageId: string;
  type: CommandType;
  version: number;
  correlationId: string;
  sagaId: string | null;
  occurredAt: string;
  payload: { adotanteId?: string; animalId?: string };
};
type ResponseEnvelope = Omit<Envelope, 'type' | 'payload'> & {
  type: 'PerfilValidado' | 'PerfilRecusado' | 'VagaLiberada' | 'AdocaoRegistrada';
  payload: Record<string, unknown>;
};
type InboxRow = { resposta: ResponseEnvelope };
type PerfilRow = { existe: boolean; tipo_moradia: string | null; tem_quintal: boolean | null; horas_fora_de_casa: number | null; aceite_termo_em: Date | null };

@Injectable()
export class SagaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SagaConsumer.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;

  constructor(@Inject(DATABASE_POOL) private readonly db: Pool, private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.connection = await amqp.connect(this.config.getOrThrow<string>('IDENTIDADE_AMQP_URL'));
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.prefetch(10);
    await this.channel.consume('identidade.comandos', (message) => void this.receber(message), { noAck: false });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private async receber(message: amqp.ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    let command: Envelope;
    try {
      command = JSON.parse(message.content.toString()) as Envelope;
      if (!this.comandoValido(command)) throw new Error('Envelope de comando inválido');
    } catch (error) {
      this.logger.warn({ err: error }, 'Comando inválido enviado para identidade.comandos.');
      this.channel.nack(message, false, false);
      return;
    }

    try {
      const response = await this.processar(command);
      this.channel.publish('ampara.respostas', 'orquestrador', Buffer.from(JSON.stringify(response)), {
        contentType: 'application/json',
        messageId: response.messageId,
        type: response.type,
        correlationId: response.correlationId,
        persistent: true,
      });
      await this.channel.waitForConfirms();
      this.channel.ack(message);
      this.logger.log({ correlationId: command.correlationId, sagaId: command.sagaId, type: command.type }, 'Comando da SAGA processado.');
    } catch (error) {
      this.logger.error({ err: error, correlationId: command.correlationId, sagaId: command.sagaId, type: command.type }, 'Falha temporária ao processar comando da SAGA.');
      this.channel.nack(message, false, true);
    }
  }

  private async processar(command: Envelope): Promise<ResponseEnvelope> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: cached } = await client.query<InboxRow>('SELECT resposta FROM inbox WHERE message_id = $1', [command.messageId]);
      const response = cached[0]?.resposta ?? await this.executar(client, command);
      if (!cached[0]) await client.query('INSERT INTO inbox (message_id, tipo, resposta) VALUES ($1, $2, $3::jsonb)', [command.messageId, command.type, JSON.stringify(response)]);
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async executar(client: PoolClient, command: Envelope): Promise<ResponseEnvelope> {
    const adotanteId = command.payload.adotanteId!;
    if (command.type === 'ValidarPerfil') return this.validarPerfil(client, command, adotanteId);
    if (command.type === 'LiberarVaga') return this.liberarVaga(client, command, adotanteId);
    return this.registrarAdocao(client, command, adotanteId, command.payload.animalId!);
  }

  private async validarPerfil(client: PoolClient, command: Envelope, adotanteId: string): Promise<ResponseEnvelope> {
    const { rows: compensated } = await client.query('SELECT 1 FROM sagas_compensadas WHERE saga_id = $1', [command.sagaId]);
    if (compensated[0]) return this.response(command, 'PerfilRecusado', { adotanteId, motivo: 'SAGA_ENCERRADA' });
    const { rows } = await client.query<PerfilRow>(
      `SELECT c.id IS NOT NULL AS existe, p.tipo_moradia, p.tem_quintal, p.horas_fora_de_casa, p.aceite_termo_em
       FROM contas c LEFT JOIN perfis_adocao p ON p.conta_id = c.id WHERE c.id = $1 FOR UPDATE`, [adotanteId],
    );
    const perfil = rows[0];
    if (!perfil?.existe) return this.response(command, 'PerfilRecusado', { adotanteId, motivo: 'CONTA_INEXISTENTE' });
    const camposFaltando = [
      ...(perfil.tipo_moradia ? [] : ['tipoMoradia']),
      ...(perfil.tem_quintal === null ? ['temQuintal'] : []),
      ...(perfil.horas_fora_de_casa === null ? ['horasForaDeCasa'] : []),
      ...(perfil.aceite_termo_em ? [] : ['aceiteTermo']),
    ];
    if (camposFaltando.length) return this.response(command, 'PerfilRecusado', { adotanteId, motivo: 'PERFIL_INCOMPLETO', camposFaltando });
    const { rows: vaga } = await client.query(
      'INSERT INTO vagas_solicitacao (adotante_id, saga_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING adotante_id', [adotanteId, command.sagaId],
    );
    return vaga[0] ? this.response(command, 'PerfilValidado', { adotanteId }) : this.response(command, 'PerfilRecusado', { adotanteId, motivo: 'LIMITE_SOLICITACOES' });
  }

  private async liberarVaga(client: PoolClient, command: Envelope, adotanteId: string): Promise<ResponseEnvelope> {
    const { rowCount } = await client.query('DELETE FROM vagas_solicitacao WHERE adotante_id = $1 AND saga_id = $2', [adotanteId, command.sagaId]);
    await client.query('INSERT INTO sagas_compensadas (saga_id) VALUES ($1) ON CONFLICT DO NOTHING', [command.sagaId]);
    return this.response(command, 'VagaLiberada', { adotanteId, liberou: rowCount === 1 });
  }

  private async registrarAdocao(client: PoolClient, command: Envelope, adotanteId: string, animalId: string): Promise<ResponseEnvelope> {
    await client.query('INSERT INTO adocoes_historico (adotante_id, animal_id, saga_id) VALUES ($1, $2, $3) ON CONFLICT (saga_id) DO NOTHING', [adotanteId, animalId, command.sagaId]);
    await client.query('DELETE FROM vagas_solicitacao WHERE adotante_id = $1 AND saga_id = $2', [adotanteId, command.sagaId]);
    return this.response(command, 'AdocaoRegistrada', { adotanteId, animalId });
  }

  private response(command: Envelope, type: ResponseEnvelope['type'], payload: Record<string, unknown>): ResponseEnvelope {
    return { messageId: randomUUID(), type, version: 1, correlationId: command.correlationId, sagaId: command.sagaId, occurredAt: new Date().toISOString(), payload };
  }

  private comandoValido(command: Envelope): boolean {
    const hasEnvelope = Boolean(command?.messageId && command.correlationId && command.sagaId && command.version === 1 && command.occurredAt && command.payload);
    if (!hasEnvelope || !['ValidarPerfil', 'LiberarVaga', 'RegistrarAdocao'].includes(command.type)) return false;
    if (typeof command.payload.adotanteId !== 'string') return false;
    return command.type !== 'RegistrarAdocao' || typeof command.payload.animalId === 'string';
  }
}
