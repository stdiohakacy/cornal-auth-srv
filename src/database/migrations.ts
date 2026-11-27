import { Init1795651200000 } from './migrations/0001-init.migration.js';
import { Outbox1795651201000 } from './migrations/0002-outbox.migration.js';
import { OrgInviteIndex1795762800000 } from './migrations/0003-org-invite-index.migration.js';

/** Ordered migration list. Explicit on purpose: no glob loading under ESM. */
export const MIGRATIONS = [
  Init1795651200000,
  Outbox1795651201000,
  OrgInviteIndex1795762800000,
];
