import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { AtualizarPerfilDto } from './dtos';

type Conta = { id: string; nome: string; email: string; role: string; cidade: string; status_verificacao: string };
type Perfil = { tipo_moradia: string | null; tem_quintal: boolean | null; outros_animais: boolean | null; horas_fora_de_casa: number | null; aceite_termo_em: Date | null };

@Injectable()
export class ContasService {
  constructor(@Inject(DATABASE_POOL) private readonly db: Pool) {}

  async eu(id: string) { const conta = await this.conta(id); if (!conta) throw new NotFoundException(); return this.comEmail(conta); }

  async obterPerfil(id: string) { return this.serializarPerfil(await this.perfil(id)); }

  async atualizarPerfil(id: string, dto: AtualizarPerfilDto) {
    const { rows } = await this.db.query<Perfil>(
      `INSERT INTO perfis_adocao (conta_id, tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END)
       ON CONFLICT (conta_id) DO UPDATE SET tipo_moradia = EXCLUDED.tipo_moradia, tem_quintal = EXCLUDED.tem_quintal,
       outros_animais = EXCLUDED.outros_animais, horas_fora_de_casa = EXCLUDED.horas_fora_de_casa, aceite_termo_em = EXCLUDED.aceite_termo_em
       RETURNING tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em`,
      [id, dto.tipoMoradia, dto.temQuintal ?? null, dto.outrosAnimais ?? null, dto.horasForaDeCasa ?? null, dto.aceiteTermo],
    );
    return this.serializarPerfil(rows[0]);
  }

  async resumo(id: string) { const conta = await this.conta(id); return conta && this.resumoConta(conta); }

  async listarPorIds(ids: string[], incluirPerfil: boolean) {
    const { rows } = await this.db.query<Conta & Perfil>(
      `SELECT c.id, c.nome, c.email, c.role, c.cidade, c.status_verificacao, p.tipo_moradia, p.tem_quintal, p.outros_animais, p.horas_fora_de_casa, p.aceite_termo_em
       FROM contas c LEFT JOIN perfis_adocao p ON p.conta_id = c.id WHERE c.id = ANY($1::uuid[])`, [ids],
    );
    return rows.map((conta) => incluirPerfil ? { ...this.resumoConta(conta), perfil: this.serializarPerfilResumo(conta) } : this.resumoConta(conta));
  }

  async listarPendentes(status?: string, role?: string) {
    const { rows } = await this.db.query<Conta>(
      'SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE status_verificacao = COALESCE($1, status_verificacao) AND role = COALESCE($2, role) ORDER BY criado_em ASC LIMIT 100', [status, role],
    );
    return rows.map((conta) => this.resumoConta(conta));
  }

  async verificar(id: string, status: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<Conta>('SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE id = $1 FOR UPDATE', [id]);
      const conta = rows[0];
      if (!conta) { await client.query('ROLLBACK'); return null; }
      if (conta.role === 'ADOTANTE' || conta.role === 'ADMIN') throw new ConflictException('Esta conta não pode ser verificada.');
      if (conta.status_verificacao !== status) {
        await client.query('UPDATE contas SET status_verificacao = $2 WHERE id = $1', [id, status]);
        await client.query(`INSERT INTO outbox (id, tipo, payload) VALUES (gen_random_uuid(), 'conta.verificada', $1::jsonb)`, [JSON.stringify({ contaId: conta.id, nome: conta.nome, role: conta.role, cidade: conta.cidade })]);
      }
      await client.query('COMMIT');
      return { ...this.resumoConta(conta), statusVerificacao: status };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  idsDemais(): never { throw new BadRequestException('A consulta aceita no máximo 100 identificadores.'); }

  private async conta(id: string) { const { rows } = await this.db.query<Conta>('SELECT id, nome, email, role, cidade, status_verificacao FROM contas WHERE id = $1', [id]); return rows[0]; }
  private async perfil(id: string) { const { rows } = await this.db.query<Perfil>('SELECT tipo_moradia, tem_quintal, outros_animais, horas_fora_de_casa, aceite_termo_em FROM perfis_adocao WHERE conta_id = $1', [id]); return rows[0]; }
  private comEmail(conta: Conta) { return { ...this.resumoConta(conta), email: conta.email }; }
  private resumoConta(conta: Conta) { return { id: conta.id, nome: conta.nome, role: conta.role, cidade: conta.cidade, statusVerificacao: conta.status_verificacao }; }
  private camposFaltando(perfil?: Perfil) { return !perfil ? ['tipoMoradia', 'temQuintal', 'horasForaDeCasa', 'aceiteTermo'] : [
    ...(perfil.tipo_moradia ? [] : ['tipoMoradia']), ...(perfil.tem_quintal === null ? ['temQuintal'] : []),
    ...(perfil.horas_fora_de_casa === null ? ['horasForaDeCasa'] : []), ...(perfil.aceite_termo_em ? [] : ['aceiteTermo']),
  ]; }
  private serializarPerfil(perfil?: Perfil) { return { tipoMoradia: perfil?.tipo_moradia ?? null, temQuintal: perfil?.tem_quintal ?? null, outrosAnimais: perfil?.outros_animais ?? null, horasForaDeCasa: perfil?.horas_fora_de_casa ?? null, aceiteTermo: Boolean(perfil?.aceite_termo_em), completo: this.camposFaltando(perfil).length === 0, camposFaltando: this.camposFaltando(perfil) }; }
  private serializarPerfilResumo(perfil: Perfil) { return perfil.tipo_moradia ? { tipoMoradia: perfil.tipo_moradia, temQuintal: perfil.tem_quintal, outrosAnimais: perfil.outros_animais, horasForaDeCasa: perfil.horas_fora_de_casa, completo: this.camposFaltando(perfil).length === 0 } : null; }
}
