import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Resposta, lerComando } from './saga.mensagens';
import { SagaService } from './saga.service';

export const FILA_COMANDOS = 'identidade.comandos';
export const EXCHANGE_RESPOSTAS = 'ampara.respostas';
export const ROTA_RESPOSTAS = 'orquestrador';
const PREFETCH = 10;
const ESPERA_RECONEXAO_MS = 5_000;

/** O canal que o consumidor usa; separado para os testes trocarem por um dublê. */
export type CanalComandos = Pick<amqp.ConfirmChannel, 'publish' | 'waitForConfirms' | 'ack' | 'nack'>;

/**
 * Consome identidade.comandos e responde em ampara.respostas. A ordem é sempre:
 * commit (efeito + inbox) → publica a resposta com confirm → ack do comando.
 * Se cair entre o commit e o ack, o comando volta e a inbox devolve a mesma resposta.
 */
@Injectable()
export class SagaConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SagaConsumer.name);
  private conexao?: amqp.ChannelModel;
  private encerrando = false;
  private reconexao?: NodeJS.Timeout;

  constructor(private readonly saga: SagaService, private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    // não bloqueia a subida do HTTP: sem broker, tenta de novo em segundo plano
    void this.conectar();
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    if (this.reconexao) clearTimeout(this.reconexao);
    await this.conexao?.close().catch(() => undefined);
  }

  private async conectar(): Promise<void> {
    if (this.encerrando) return;
    try {
      const conexao = await amqp.connect(this.config.getOrThrow<string>('IDENTIDADE_AMQP_URL'));
      conexao.on('error', (err: unknown) => this.logger.warn({ err }, 'Conexão AMQP do consumidor da SAGA com erro.'));
      conexao.on('close', () => this.agendarReconexao('conexão fechada'));
      const canal = await conexao.createConfirmChannel();
      canal.on('error', (err: unknown) => this.logger.warn({ err }, 'Canal AMQP do consumidor da SAGA com erro.'));
      // sem canal não há consumo: fechar a conexão dispara a reconexão
      canal.on('close', () => { void conexao.close().catch(() => undefined); });
      await canal.prefetch(PREFETCH);
      await canal.consume(FILA_COMANDOS, (mensagem) => {
        if (!mensagem) return; // consumidor cancelado pelo broker; a conexão cai e reconecta
        this.receber(mensagem, canal).catch((err: unknown) => this.logger.error({ err }, 'Erro inesperado no consumidor da SAGA.'));
      }, { noAck: false });
      this.conexao = conexao;
      this.logger.log(`Consumindo ${FILA_COMANDOS}.`);
    } catch (err) {
      this.logger.warn({ err }, 'Não foi possível conectar ao RabbitMQ para consumir os comandos da SAGA.');
      this.agendarReconexao('falha ao conectar');
    }
  }

  private agendarReconexao(motivo: string): void {
    this.conexao = undefined;
    if (this.encerrando || this.reconexao) return;
    this.logger.warn(`Consumidor da SAGA desconectado (${motivo}); nova tentativa em ${ESPERA_RECONEXAO_MS / 1000} s.`);
    this.reconexao = setTimeout(() => { this.reconexao = undefined; void this.conectar(); }, ESPERA_RECONEXAO_MS);
    this.reconexao.unref();
  }

  /** Trata uma entrega. Nunca rejeita: todo erro vira nack (e o próprio nack é protegido). */
  async receber(mensagem: amqp.ConsumeMessage, canal: CanalComandos): Promise<void> {
    const leitura = lerComando(mensagem.content);
    if (!leitura.ok) {
      // inválida é definitiva: direto para a DLQ, sem gastar as devoluções
      this.logger.error({ ...leitura.parcial, motivo: leitura.motivo, fila: FILA_COMANDOS }, 'Comando inválido; enviado para a DLQ.');
      this.nack(canal, mensagem, false);
      return;
    }
    const { comando } = leitura;
    const contexto = { correlationId: comando.correlationId, sagaId: comando.sagaId, type: comando.type, messageId: comando.messageId };
    try {
      const { resposta, repetido } = await this.saga.processar(comando);
      await this.publicar(canal, resposta);
      canal.ack(mensagem);
      this.logger.log(
        { ...contexto, resposta: resposta.type, motivo: resposta.payload.motivo, repetido },
        repetido ? 'Comando da SAGA repetido; resposta gravada republicada.' : 'Comando da SAGA processado.',
      );
    } catch (err) {
      this.logger.error({ err, ...contexto }, 'Falha temporária ao processar comando da SAGA; volta para a fila.');
      this.nack(canal, mensagem, true);
    }
  }

  private async publicar(canal: CanalComandos, resposta: Resposta): Promise<void> {
    canal.publish(EXCHANGE_RESPOSTAS, ROTA_RESPOSTAS, Buffer.from(JSON.stringify(resposta)), {
      contentType: 'application/json',
      messageId: resposta.messageId,
      type: resposta.type,
      correlationId: resposta.correlationId,
      persistent: true,
    });
    await canal.waitForConfirms();
  }

  /** Com o canal fechado, o nack lança; o broker devolve a mensagem sozinho quando o canal cai. */
  private nack(canal: CanalComandos, mensagem: amqp.ConsumeMessage, requeue: boolean): void {
    try {
      canal.nack(mensagem, false, requeue);
    } catch (err) {
      this.logger.warn({ err }, 'Não foi possível dar nack: o canal já está fechado; o broker reentrega a mensagem.');
    }
  }
}
