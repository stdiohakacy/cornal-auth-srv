import { z } from 'zod';

/** Request/response contracts for /auth identity endpoints. Pure Zod: shareable with the frontend. */
export const RegisterRequestSchema = z.strictObject({
  email: z.string().max(254),
  password: z.string().min(1).max(256),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** Same body whether the email was new or already registered (no account enumeration). */
export const RegisterResponseSchema = z.strictObject({
  status: z.literal('accepted'),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

/** 32 random bytes, base64url without padding. */
const SingleUseTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const VerifyEmailRequestSchema = z.strictObject({
  token: SingleUseTokenSchema,
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

/** Same 202 body for known and unknown emails (no account enumeration). */
export const AcceptedResponseSchema = z.strictObject({
  status: z.literal('accepted'),
});
export type AcceptedResponse = z.infer<typeof AcceptedResponseSchema>;

export const ForgotPasswordRequestSchema = z.strictObject({
  email: z.string().max(254),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.strictObject({
  token: SingleUseTokenSchema,
  password: z.string().min(1).max(256),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
