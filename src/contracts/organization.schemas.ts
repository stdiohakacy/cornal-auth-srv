import { z } from 'zod';
import { DisplayNameSchema } from './common.schemas.js';
import { PERMISSIONS } from './permissions.js';

/** Contracts for /iam organization endpoints and org switching. Pure Zod. */
export const OrgIdParamSchema = z.uuid();

export const CreateOrganizationRequestSchema = z.strictObject({
  name: DisplayNameSchema,
  slug: z.string().max(48),
});
export type CreateOrganizationRequest = z.infer<
  typeof CreateOrganizationRequestSchema
>;

export const OrganizationSummarySchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const OrganizationListResponseSchema = z.strictObject({
  organizations: z.array(OrganizationSummarySchema),
});
export type OrganizationListResponse = z.infer<
  typeof OrganizationListResponseSchema
>;

export const MemberListResponseSchema = z.strictObject({
  members: z.array(
    z.strictObject({
      membershipId: z.string(),
      userId: z.string(),
      email: z.string().nullable(),
      status: z.string(),
      roles: z.array(z.string()),
    }),
  ),
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const SwitchOrganizationRequestSchema = z.strictObject({
  orgId: z.uuid(),
});
export type SwitchOrganizationRequest = z.infer<
  typeof SwitchOrganizationRequestSchema
>;

export const PermissionCatalogResponseSchema = z.strictObject({
  version: z.number().int(),
  permissions: z.array(
    z.strictObject({
      code: z.string(),
      bit: z.number().int(),
      description: z.string(),
    }),
  ),
});
export type PermissionCatalogResponse = z.infer<
  typeof PermissionCatalogResponseSchema
>;

const PermissionCodeSchema = z.enum(
  PERMISSIONS.map((p) => p.code),
  { message: 'Unknown permission code' },
);

/** Roles assigned in one request (invite, member update). */
const RoleIdsSchema = z.array(z.uuid()).min(1).max(10);
/** A role's permission set. */
const PermissionCodesSchema = z.array(PermissionCodeSchema).max(64);

export const MembershipIdParamSchema = z.uuid();
export const RoleIdParamSchema = z.uuid();
export const InvitationIdParamSchema = z.uuid();

export const InviteMemberRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  roleIds: RoleIdsSchema,
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const AcceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(20).max(200),
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
>;

export const InvitationCreatedResponseSchema = z.strictObject({
  invitationId: z.string(),
});
export type InvitationCreatedResponse = z.infer<
  typeof InvitationCreatedResponseSchema
>;

export const AcceptInvitationResponseSchema = z.strictObject({
  orgId: z.string(),
});
export type AcceptInvitationResponse = z.infer<
  typeof AcceptInvitationResponseSchema
>;

export const InvitationListResponseSchema = z.strictObject({
  invitations: z.array(
    z.strictObject({
      invitationId: z.string(),
      email: z.string(),
      roleIds: z.array(z.string()),
      invitedBy: z.string(),
      expiresAt: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type InvitationListResponse = z.infer<
  typeof InvitationListResponseSchema
>;

export const CreateRoleRequestSchema = z.strictObject({
  key: z.string().max(32),
  name: DisplayNameSchema,
  permissions: PermissionCodesSchema,
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z
  .strictObject({
    name: DisplayNameSchema.optional(),
    permissions: PermissionCodesSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.permissions !== undefined, {
    message: 'Provide name and/or permissions',
  });
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const RoleSchema = z.strictObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  system: z.boolean(),
  permissions: z.array(z.string()),
});
export type RoleResponse = z.infer<typeof RoleSchema>;

export const RoleListResponseSchema = z.strictObject({
  roles: z.array(RoleSchema),
});
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

export const UpdateMemberRequestSchema = z
  .strictObject({
    roleIds: RoleIdsSchema.optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((body) => body.roleIds !== undefined || body.status !== undefined, {
    message: 'Provide roleIds and/or status',
  });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;
