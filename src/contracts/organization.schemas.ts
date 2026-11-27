import { z } from 'zod';
import { type Permission, PERMISSIONS } from './permissions.js';

/** Contracts for /iam organization endpoints and org switching. Pure Zod. */
export const OrgIdParamSchema = z.uuid();

export const CreateOrganizationRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
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

const PERMISSION_CODES: ReadonlySet<string> = new Set(
  PERMISSIONS.map((p) => p.code),
);
const PermissionCodeSchema = z.custom<Permission>(
  (value) => typeof value === 'string' && PERMISSION_CODES.has(value),
  { message: 'Unknown permission code' },
);

export const MembershipIdParamSchema = z.uuid();
export const RoleIdParamSchema = z.uuid();
export const InvitationIdParamSchema = z.uuid();

export const InviteMemberRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  roleIds: z.array(z.uuid()).min(1).max(10),
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequestSchema>;

export const AcceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(20).max(200),
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
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
  name: z.string().trim().min(1).max(100),
  permissions: z.array(PermissionCodeSchema).max(64),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    permissions: z.array(PermissionCodeSchema).max(64).optional(),
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
    roleIds: z.array(z.uuid()).min(1).max(10).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((body) => body.roleIds !== undefined || body.status !== undefined, {
    message: 'Provide roleIds and/or status',
  });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;
