import { PostgresOutboxStore } from '@nestjs/outbox/postgres';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * @nestjs/outbox tables (schema `nest_outbox`), applied by our migration runner instead of the
 * store itself (`migrate: false`), so production has a single, reviewed migration path.
 */
export class Outbox1795651201000 implements MigrationInterface {
  name = 'Outbox1795651201000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(PostgresOutboxStore.migrationSql());
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP SCHEMA IF EXISTS nest_outbox CASCADE');
  }
}
