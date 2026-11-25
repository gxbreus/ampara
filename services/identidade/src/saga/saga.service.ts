import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { PerfilAdocaoRow, camposFaltando } from '../perfis/perfil-adocao';
import { Comando, Resposta, TipoResposta } from './saga.mensagens';

type ContaPerfilRow = PerfilAdocaoRow & { role: string };

/**
 * Efeito dos comandos da SAGA com inbox idempotente: o efeito e a resposta já
 * montada são gravados na mesma transação. Um comando repetido (mesmo messageId)
 * devolve a resposta gravada, idêntica, sem repetir o efeito.
 */
@Injectable()
export class SagaService {
  constructor(@Inject(DATABASE_POOL) private readonly db: Pool) {}

  /** Devolve a resposta e se ela veio da inbox (comando repetido). */
  async processar(comando: Comando): Promise<{ resposta: Resposta; repetido: boolean }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: gravada } = await client.query<{ resposta: Resposta }>('SELECT resposta FROM inbox WHERE message_id = $1', [comando.messageId]);
      if (gravada[0]) {
        await client.query('COMMIT');
        return { resposta: gravada[0].resposta, repetido: true };
      }
      const resposta = await this.executar(client, comando);
      await client.query('INSERT INTO inbox (message_id, tipo, resposta) VALUES ($1, $2, $3::jsonb)', [comando.messageId, comando.type, JSON.stringify(resposta)]);
      await client.query('COMMIT');
      return { resposta, repetido: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private executar(client: PoolClient, comando: Comando): Promise<Resposta> {
    if (comando.type === 'ValidarPerfil') return this.validarPerfil(client, comando);
    if (comando.type === 'LiberarVaga') return this.liberarVaga(client, comando);
    return this.registrarAdocao(client, comando);
  }

  private async validarPerfil(client: PoolClient, comando: Comando): Promise<Resposta> {
    const { adotanteId } = comando.payload;
    // Trava só a conta (o PostgreSQL não aceita FOR UPDATE no lado nulo do LEFT JOIN).
    // A trava serializa ValidarPerfil e LiberarVaga do mesmo adotante.
    const { rows } = await client.query<ContaPerfilRow>(
      `SELECT c.role, p.tipo_moradia, p.tem_quintal, p.outros_animais, p.horas_fora_de_casa, p.aceite_termo_em
       FROM contas c LEFT JOIN perfis_adocao p ON p.conta_id = c.id WHERE c.id = $1 FOR UPDATE OF c`, [adotanteId],
    );
    const conta = rows[0];
    if (!conta || conta.role !== 'ADOTANTE') return this.resposta(comando, 'PerfilRecusado', { adotanteId, motivo: 'CONTA_INEXISTENTE' });

    // consultada depois da trava, para ver um LiberarVaga que acabou de gravar a marca
    const { rows: compensada } = await client.query('SELECT 1 FROM sagas_compensadas WHERE saga_id = $1', [comando.sagaId]);
    if (compensada[0]) return this.resposta(comando, 'PerfilRecusado', { adotanteId, motivo: 'SAGA_ENCERRADA' });

    const faltando = camposFaltando(conta);
    if (faltando.length) return this.resposta(comando, 'PerfilRecusado', { adotanteId, motivo: 'PERFIL_INCOMPLETO', camposFaltando: faltando });

    const { rows: vaga } = await client.query<{ saga_id: string }>('SELECT saga_id FROM vagas_solicitacao WHERE adotante_id = $1', [adotanteId]);
    if (vaga[0]) {
      // a mesma SAGA com outro messageId (chave semântica sagaId + passo): a vaga já é dela
      return vaga[0].saga_id === comando.sagaId
        ? this.resposta(comando, 'PerfilValidado', { adotanteId })
        : this.resposta(comando, 'PerfilRecusado', { adotanteId, motivo: 'LIMITE_SOLICITACOES' });
    }
    const { rows: ocupada } = await client.query(
      'INSERT INTO vagas_solicitacao (adotante_id, saga_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING adotante_id', [adotanteId, comando.sagaId],
    );
    return ocupada[0]
      ? this.resposta(comando, 'PerfilValidado', { adotanteId })
      : this.resposta(comando, 'PerfilRecusado', { adotanteId, motivo: 'LIMITE_SOLICITACOES' });
  }

  private async liberarVaga(client: PoolClient, comando: Comando): Promise<Resposta> {
    const { adotanteId } = comando.payload;
    await client.query('SELECT 1 FROM contas WHERE id = $1 FOR UPDATE', [adotanteId]);
    const { rowCount } = await client.query('DELETE FROM vagas_solicitacao WHERE adotante_id = $1 AND saga_id = $2', [adotanteId, comando.sagaId]);
    await client.query('INSERT INTO sagas_compensadas (saga_id) VALUES ($1) ON CONFLICT DO NOTHING', [comando.sagaId]);
    return this.resposta(comando, 'VagaLiberada', { adotanteId, liberou: rowCount === 1 });
  }

  private async registrarAdocao(client: PoolClient, comando: Comando): Promise<Resposta> {
    const { adotanteId, animalId } = comando.payload;
    await client.query('SELECT 1 FROM contas WHERE id = $1 FOR UPDATE', [adotanteId]);
    await client.query(
      'INSERT INTO adocoes_historico (adotante_id, animal_id, saga_id) VALUES ($1, $2, $3) ON CONFLICT (saga_id) DO NOTHING', [adotanteId, animalId, comando.sagaId],
    );
    await client.query('DELETE FROM vagas_solicitacao WHERE adotante_id = $1 AND saga_id = $2', [adotanteId, comando.sagaId]);
    return this.resposta(comando, 'AdocaoRegistrada', { adotanteId, animalId });
  }

  private resposta(comando: Comando, type: TipoResposta, payload: Record<string, unknown>): Resposta {
    return {
      messageId: randomUUID(),
      type,
      version: 1,
      correlationId: comando.correlationId,
      sagaId: comando.sagaId,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }
}
