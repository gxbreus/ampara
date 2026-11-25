import { MigrationInterface, QueryRunner } from 'typeorm';

/** O envelope do catálogo (eventos.md §2) leva o X-Correlation-Id da requisição que originou o evento. */
export class OutboxCorrelationId1728417600000 implements MigrationInterface {
  name = 'OutboxCorrelationId1728417600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE outbox ADD COLUMN correlation_id varchar(200)');
    await queryRunner.query('CREATE INDEX outbox_pendentes_idx ON outbox (criado_em) WHERE publicado_em IS NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX outbox_pendentes_idx');
    await queryRunner.query('ALTER TABLE outbox DROP COLUMN correlation_id');
  }
}
