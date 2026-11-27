import {
  PERMISSION_CATALOG_VERSION,
  permissionCatalog,
} from '#src/contracts/permissions.js';
import { encodePermissionBits } from '#src/sdk/permission-bits.js';
import type { OrganizationReads } from './ports.js';

/** What an access token says about the active organization. */
export type OrgContext = {
  readonly orgId: string;
  readonly membershipId: string;
  /** membership.authz_version */
  readonly mv: number;
  /** organization.authz_epoch */
  readonly ov: number;
  readonly pcv: number;
  readonly pbits: string;
  readonly mfaRequired: boolean;
};

/** Façade for the session module: org claims for a user, encoded with the permission catalog. */
export class ResolveOrgContextUseCase {
  private readonly catalog = permissionCatalog();

  constructor(private readonly reads: OrganizationReads) {}

  async contextFor(
    userId: string,
    orgId: string,
  ): Promise<OrgContext | undefined> {
    const membership = await this.reads.membershipContext(userId, orgId);
    if (!membership) return undefined;
    return {
      orgId,
      membershipId: membership.membershipId,
      mv: membership.authzVersion,
      ov: membership.authzEpoch,
      pcv: PERMISSION_CATALOG_VERSION,
      pbits: encodePermissionBits(this.catalog, membership.permissions),
      mfaRequired: membership.mfaRequired,
    };
  }

  /**
   * Org for a fresh login: the preferred (most recently used) org while still a member, otherwise
   * the only membership if there is exactly one, otherwise none (the client asks the user).
   */
  async defaultFor(
    userId: string,
    preferredOrgId: string | null,
  ): Promise<OrgContext | undefined> {
    if (preferredOrgId !== null) {
      const preferred = await this.contextFor(userId, preferredOrgId);
      if (preferred) return preferred;
    }
    const memberships = await this.reads.activeMembershipsOf(userId);
    const [only, ...others] = memberships;
    return only && others.length === 0
      ? this.contextFor(userId, only.orgId)
      : undefined;
  }
}
