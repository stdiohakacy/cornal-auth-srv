import { z } from 'zod';

/** Error body shape (RFC 9457 `application/problem+json`). Pure Zod: shareable with the frontend. */
export const FieldErrorSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});

export const ProblemDetailsSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  /** Stable machine-readable code from contracts/error-codes.ts. Branch on this, never on `detail`. */
  code: z.string(),
  detail: z.string(),
  instance: z.string(),
  requestId: z.string(),
  /** Code-specific extras, e.g. `retryAfterSeconds` on 423 and 503. */
  details: z.record(z.string(), z.unknown()).optional(),
  /** Present on 422 COMMON.VALIDATION_FAILED. */
  errors: z.array(FieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
