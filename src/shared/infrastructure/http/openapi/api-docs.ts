import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';
import type { ErrorCode } from '#src/contracts/error-codes.js';

export const API_ERRORS = 'cornal:openapi:errors';
export const API_RESULT = 'cornal:openapi:result';

/** Security scheme names registered in the document (see src/openapi/app-openapi.ts). */
export const ACCESS_TOKEN_SCHEME = 'accessToken';
export const REFRESH_COOKIE_SCHEME = 'refreshCookie';

/**
 * Expected failures of a route (method) or of every route (class), beyond those its guards
 * and validation add. The HTTP status of each code comes from ERROR_STATUS.
 */
export const ApiErrors = (...codes: ErrorCode[]) =>
  SetMetadata(API_ERRORS, codes);

/** Body of the success response. Its status stays the one Nest uses (@HttpCode or the verb). */
export const ApiResult = (schema: z.ZodType) => SetMetadata(API_RESULT, schema);
