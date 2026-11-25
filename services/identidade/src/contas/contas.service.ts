import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { ProblemaException } from '../problemas/problema';
import { PerfilAdocaoRow, serializarPerfil, serializarPerfilResumo } from '../perfis/perfil-adocao';
import { AtualizarPerfilDto } from './dtos';

type Conta = { id: string; nome: string; email: string; role: string; cidade: string; status_verificacao: string };

const COLUNAS_PERFIL = 'tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em';

@Injectable()
export class ContasService {
  constructor(@Inject(DATABASE_POOL) private readonly db: Pool) {}

  async eu(id: string) {
    const conta = await this.conta(id);
    return conta && { ...this.resumoConta(conta), email: conta.email };
  }

  async obterPerfil(id: string) { return serializarPerfil(await this.perfil(id)); }

  async atualizarPerfil(id: string, dto: AtualizarPerfilDto) {
    const { rows } = await this.db.query<PerfilAdocaoRow>(
      `INSERT INTO perfis_adocao (conta_id, ${COLUNAS_PERFIL})
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
       ON CONFLICT (conta_id) DO UPDATE SET tipo_moradia = EXCLUDED.tipo_moradia, tem_quintal = EXCLUDED.tem_quintal,
       outros_animais = EXCLUDED.outros_animais, horas_fora_de_casa = EXCLUDED.horas_fora_de_casa, aceite_termo_em = EXCLUDED.aceite_termo_em
       RETURNING ${COLUNAS_PERFIL}`,
      [id, dto.tipoMoradia, dto.temQuintal ?? null, dto.outrosAnimais ?? null, dto.horasForaDeCasa ?? null, dto.aceiteTermo],
    );
    return serializarPerfil(rows[0]);
  }

  async resumo(id: string) { const conta = await this.conta(id); return conta && this.resumoConta(conta); }

  /** `ids` já validados pelo controller: no máximo 100, todos UUID. */
  async listarPorIds(ids: string[], incluirPerfil: boolean) {
    const { rows } = await this.db.query<Conta & PerfilAdocaoRow>(
      `SELECT c.id, c.nome, c.email, c.role, c.cidade, c.status_verificacao, p.tipo_moradia, p.tem_quintal, p.outros_animais, p.horas_fora_de_casa, p.aceite_termo_em
       FROM contas c LEFT JOIN perfis_adocao p ON p.conta_id = c.id WHERE c.id = ANY($1::uuid[])`, [ids],
    );
    return rows.map((conta) => incluirPerfil ? { ...this.resumoConta(conta), perfil: serializarPerfilResumo(conta) } : this.resumoConta(conta));
  }

  async listarPendentes(status?: string, role?: string) {
    const { rows } = await this.db.query<Conta>(
      'SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE status_verificacao = COALESCE($1, status_verificacao) AND role = COALESCE($2, role) ORDER BY criado_em ASC LIMIT 100',
      [status ?? null, role ?? null],
    );
    return rows.map((conta) => this.resumoConta(conta));
  }

  /**
   * Verifica a conta e grava `conta.verificada` na outbox na mesma transação.
   * `correlationId` é o X-Correlation-Id da requisição; vai para o envelope do evento.
   */
  async verificar(id: string, status: string, correlationId: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<Conta>('SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE id = $1 FOR UPDATE', [id]);
      const conta = rows[0];
      if (!conta) { await client.query('ROLLBACK'); return null; }
      if (conta.role === 'ADOTANTE' || conta.role === 'ADMIN') {
        throw new ProblemaException('contaNaoVerificavel', 'Só contas PROTETOR ou ONG passam por verificação.');
      }
      if (conta.status_verificacao !== status) {
        await client.query('UPDATE contas SET status_verificacao = $2 WHERE id = $1', [id, status]);
        await client.query(
          `INSERT INTO outbox (id, tipo, payload, correlation_id) VALUES (gen_random_uuid(), 'conta.verificada', $1::jsonb, $2)`,
          [JSON.stringify({ contaId: conta.id, nome: conta.nome, role: conta.role, cidade: conta.cidade }), correlationId || null],
        );
      }
      await client.query('COMMIT');
      return { ...this.resumoConta(conta), statusVerificacao: status };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  private async conta(id: string) { const { rows } = await this.db.query<Conta>('SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE id = $1', [id]); return rows[0]; }
  private async perfil(id: string) { const { rows } = await this.db.query<PerfilAdocaoRow>(`SELECT ${COLUNAS_PERFIL} FROM perfis_adocao WHERE conta_id = $1`, [id]); return rows[0]; }
  private resumoConta(conta: Conta) { return { id: conta.id, nome: conta.nome, role: conta.role, cidade: conta.cidade, statusVerificacao: conta.status_verificacao }; }
}
