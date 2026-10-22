import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContas1728288000000 implements MigrationInterface {
  name = 'CreateContas1728288000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE contas (
        id uuid PRIMARY KEY,
        nome varchar(255) NOT NULL,
        email varchar(255) NOT NULL UNIQUE,
        senha_hash varchar(255) NOT NULL,
        cidade varchar(255) NOT NULL,
        role varchar(20) NOT NULL,
        status_verificacao varchar(30) NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE contas');
  }
}
