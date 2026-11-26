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
export const VerifyEmailRequestSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;
