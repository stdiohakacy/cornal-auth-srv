import { z } from 'zod';

/** Field schemas shared by several contracts. Pure Zod: shareable with the frontend. */

/** RFC 5321 caps an address at 254 characters; format is checked by the domain. */
export const EmailInputSchema = z.string().max(254);

/** Bounded so a huge body cannot tie up Argon2; strength is checked by the domain. */
export const PasswordInputSchema = z.string().min(1).max(256);

/** Human-facing names (organizations, roles). */
export const DisplayNameSchema = z.string().trim().min(1).max(100);
