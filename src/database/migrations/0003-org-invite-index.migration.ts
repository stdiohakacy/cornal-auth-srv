import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Open organization invitations are listed and revoked per org (payload->>'orgId'). */
export class OrgInviteIndex1795762800000 implements MigrationInterface {
  name = 'OrgInviteIndex1795762800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX one_time_tokens_org_invite_idx ON one_time_tokens ((payload->>'orgId'))
       WHERE purpose = 'org_invite' AND consumed_at IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS one_time_tokens_org_invite_idx',
    );
  }
}
