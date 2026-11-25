import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSagaIdentidade1728460800000 implements MigrationInterface {
  name = 'CreateSagaIdentidade1728460800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE vagas_solicitacao (adotante_id uuid PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE, saga_id uuid NOT NULL UNIQUE, ocupada_em timestamptz NOT NULL DEFAULT now())`);
    await queryRunner.query(`CREATE TABLE adocoes_historico (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), adotante_id uuid NOT NULL REFERENCES contas(id) ON DELETE RESTRICT, animal_id varchar(24) NOT NULL, saga_id uuid NOT NULL UNIQUE, concluida_em timestamptz NOT NULL DEFAULT now())`);
    await queryRunner.query(`CREATE TABLE sagas_compensadas (saga_id uuid PRIMARY KEY, compensada_em timestamptz NOT NULL DEFAULT now())`);
    await queryRunner.query(`CREATE TABLE inbox (message_id uuid PRIMARY KEY, tipo varchar(100) NOT NULL, resposta jsonb NOT NULL, processada_em timestamptz NOT NULL DEFAULT now())`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE inbox');
    await queryRunner.query('DROP TABLE sagas_compensadas');
    await queryRunner.query('DROP TABLE adocoes_historico');
    await queryRunner.query('DROP TABLE vagas_solicitacao');
  }
}
