import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePerfisOutbox1728374400000 implements MigrationInterface {
  name = 'CreatePerfisOutbox1728374400000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await queryRunner.query(`CREATE TABLE perfis_adocao (conta_id uuid PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE, tipo_moradia varchar(20), tem_quintal boolean, outros_animais boolean, horas_fora_de_casa integer CHECK (horas_fora_de_casa BETWEEN 0 AND 24), aceite_termo_em timestamptz)`);
    await queryRunner.query(`CREATE TABLE outbox (id uuid PRIMARY KEY, tipo varchar(100) NOT NULL, payload jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(), publicado_em timestamptz)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE outbox'); await queryRunner.query('DROP TABLE perfis_adocao'); }
}
