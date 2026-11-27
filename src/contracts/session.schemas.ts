import { z } from 'zod';

/** Contracts for /auth session endpoints. Pure Zod: shareable with the frontend. */
export const LoginRequestSchema = z.strictObject({
  email: z.string().max(254),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Web clients send nothing (HttpOnly cookie); mobile clients send the token in the body. */
export const RefreshRequestSchema = z
  .strictObject({ refreshToken: z.string().max(200).optional() })
  .optional();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const TokenResponseSchema = z.strictObject({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
  /** Only for `X-Client-Type: mobile`; web clients get an HttpOnly cookie instead. */
  refreshToken: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const SessionInfoResponseSchema = z.strictObject({
  userId: z.string(),
  sessionId: z.string(),
  authTime: z.string(),
  amr: z.array(z.string()),
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponseSchema>;
