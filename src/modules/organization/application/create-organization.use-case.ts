import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { Membership, type RoleId } from '../domain/membership.js';
import {
  EmailNotVerifiedError,
  type InvalidSlugError,
  SlugTakenError,
} from '../domain/organization.errors.js';
import { Organization } from '../domain/organization.js';
import { Slug } from '../domain/slug.js';
import type {
  MembershipRepository,
  OrganizationRepository,
  SystemRoleLookup,
  UserDirectory,
} from './ports.js';

export type CreateOrganizationError =
  EmailNotVerifiedError | InvalidSlugError | SlugTakenError;

/** A verified user creates an organization and becomes its owner (one transaction). */
export class CreateOrganizationUseCase {
  constructor(
    private readonly users: UserDirectory,
    private readonly orgs: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly roles: SystemRoleLookup,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    name: string;
    slug: string;
  }): Promise<
    Result<
      { orgId: string; slug: string; name: string },
      CreateOrganizationError
    >
  > {
    if (!(await this.users.isEmailVerified(input.userId)))
      return err(new EmailNotVerifiedError());
    const slug = Slug.create(input.slug);
    if (!slug.ok) return slug;

    try {
      return await this.uow.run(async () => {
        const now = this.clock.now();
        const org = Organization.create({
          name: input.name,
          slug: slug.value,
          now,
        });
        const owner = Membership.createOwner({
          orgId: org.id,
          userId: input.userId,
          ownerRoleId: this.roles.ownerRoleId() as RoleId,
          now,
        });
        await this.orgs.save(org);
        await this.memberships.save(owner);
        return ok({
          orgId: org.id,
          slug: org.snapshot.slug.value,
          name: org.snapshot.name,
        });
      });
    } catch (error) {
      if (error instanceof SlugTakenError) return err(error);
      throw error;
    }
  }
}
