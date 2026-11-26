import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DATABASE_POOL } from '../database/database.module';
import { CriarContaDto, CriarSessaoDto } from './dtos';
import { Role, StatusVerificacao } from './auth.types';
import { conferirSenha, gerarHashSenha } from './senha';

interface ContaRow { id: string; nome: string; email: string; senha_hash: string; role: Role; cidade: string; status_verificacao: StatusVerificacao }

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    private readonly jwt: JwtService,
  ) {}

  async criarConta(dto: CriarContaDto) {
    const role = dto.tipo;
    const status = role === 'ADOTANTE' ? 'VERIFICADA' : 'PENDENTE_VERIFICACAO';
    const senhaHash = await gerarHashSenha(dto.senha);
    const { rows } = await this.db.query<ContaRow>(
      `INSERT INTO contas (id, nome, email, senha_hash, cidade, role, status_verificacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nome, email, senha_hash, cidade, role, status_verificacao`,
      [randomUUID(), dto.nome.trim(), dto.email.trim().toLowerCase(), senhaHash, dto.cidade.trim(), role, status],
    );
    return this.contaCriada(rows[0]);
  }

  async criarSessao(dto: CriarSessaoDto) {
    const { rows } = await this.db.query<ContaRow>(
      'SELECT id, nome, email, senha_hash, cidade, role, status_verificacao FROM contas WHERE email = $1',
      [dto.email.trim().toLowerCase()],
    );
    const conta = rows[0];
    // o bcrypt roda mesmo sem conta, para o tempo de resposta não revelar se o e-mail existe
    if (!(await conferirSenha(dto.senha, conta?.senha_hash)) || !conta) return null;
    const accessToken = await this.jwt.signAsync({ sub: conta.id, role: conta.role });
    const decoded = this.jwt.decode<{ exp: number; iss: string; sub: string; role: Role }>(accessToken);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiraEm: new Date(decoded.exp * 1000).toISOString(),
      claims: { iss: decoded.iss, sub: decoded.sub, role: decoded.role, exp: decoded.exp },
    };
  }

  private contaCriada(conta: ContaRow) {
    return { id: conta.id, nome: conta.nome, email: conta.email, role: conta.role, cidade: conta.cidade, statusVerificacao: conta.status_verificacao };
  }
}
