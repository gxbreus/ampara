import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataType, newDb } from 'pg-mem';
import { Pool } from 'pg';

type Migracao = { up(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void> };

export interface BancoDeTeste {
  pool: Pool;
  real: boolean;
  encerrar(): Promise<void>;
}

/**
 * Banco para os testes. Com IDENTIDADE_TEST_DATABASE_URL, usa um PostgreSQL real
 * num schema descartável; sem ela (como na CI), usa o pg-mem em memória.
 * Nos dois casos, as tabelas vêm das migrations de src/migrations.
 */
export async function criarBanco(): Promise<BancoDeTeste> {
  const url = process.env.IDENTIDADE_TEST_DATABASE_URL;
  return url ? bancoReal(url) : bancoEmMemoria();
}

async function bancoReal(url: string): Promise<BancoDeTeste> {
  const schema = `teste_${randomUUID().replace(/-/g, '')}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  await migrar((sql) => pool.query(sql));
  return {
    pool,
    real: true,
    async encerrar() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

async function bancoEmMemoria(): Promise<BancoDeTeste> {
  const db = newDb();
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true });
  });
  // o pg-mem não entende o índice parcial da outbox; ele só existe por desempenho
  await migrar(async (sql) => {
    if (/^\s*CREATE INDEX .* WHERE /is.test(sql)) return;
    db.public.none(sql);
  });
  const { Pool: PoolEmMemoria } = db.adapters.createPg() as { Pool: typeof Pool };
  const pool = new PoolEmMemoria();
  return { pool, real: false, encerrar: () => pool.end() };
}

async function migrar(query: (sql: string) => Promise<unknown>): Promise<void> {
  const pasta = join(__dirname, '..', '..', 'src', 'migrations');
  const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith('.ts')).sort();
  for (const arquivo of arquivos) {
    const modulo = (await import(join(pasta, arquivo))) as Record<string, new () => Migracao>;
    for (const Classe of Object.values(modulo)) await new Classe().up({ query });
  }
}
