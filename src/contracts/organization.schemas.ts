import { z } from 'zod';

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
