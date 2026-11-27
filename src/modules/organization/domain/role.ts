import type { Permission } from '#src/contracts/permissions.js';
import { AggregateRoot } from '#src/shared/domain/aggregate-root.js';
import { newId } from '#src/shared/domain/id.js';
import { WatchedList } from '#src/shared/domain/watched-list.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import type { RoleId } from './membership.js';
import { InvalidRoleKeyError } from './organization.errors.js';

const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const RESERVED = new Set(['owner', 'admin', 'member']);

/** Key of a custom role, unique per organization. System role keys are reserved. */
export class RoleKey {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<RoleKey, InvalidRoleKeyError> {
    return KEY_PATTERN.test(raw) && !RESERVED.has(raw)
      ? ok(new RoleKey(raw))
      : err(new InvalidRoleKeyError());
  }

  static fromPersistence(value: string): RoleKey {
    return new RoleKey(value);
  }
}

export class PermissionSet extends WatchedList<Permission> {
  constructor(initial: readonly Permission[]) {
    super(initial);
  }
  protected same(a: Permission, b: Permission): boolean {
    return a === b;
  }
}

export type RoleProps = {
  orgId: string;
  key: RoleKey;
  name: string;
  permissions: PermissionSet;
  createdAt: Date;
};

/** A custom role of one organization (system roles are code-defined and never loaded as Role). */
export class Role extends AggregateRoot<RoleId, RoleProps> {
  private constructor(id: RoleId, props: RoleProps, version: number) {
    super(id, props, version);
  }

  static create(input: {
    orgId: string;
    key: RoleKey;
    name: string;
    permissions: readonly Permission[];
    now: Date;
  }): Role {
    const permissions = new PermissionSet([]);
    for (const code of input.permissions) permissions.add(code);
    return new Role(
      newId<'Role'>(),
      {
        orgId: input.orgId,
        key: input.key,
        name: input.name,
        permissions,
        createdAt: input.now,
      },
      0,
    );
  }

  static reconstitute(id: RoleId, props: RoleProps, version: number): Role {
    return new Role(id, props, version);
  }

  get orgId(): string {
    return this.props.orgId;
  }
  get key(): RoleKey {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get permissions(): PermissionSet {
    return this.props.permissions;
  }

  rename(name: string): void {
    this.props.name = name;
  }

  /** Returns true when the permission set actually changed. */
  setPermissions(next: readonly Permission[]): boolean {
    const wanted = new Set(next);
    const before = this.props.permissions.items;
    const toRemove = before.filter((code) => !wanted.has(code));
    const toAdd = [...wanted].filter(
      (code) => !this.props.permissions.has(code),
    );
    for (const code of toRemove) this.props.permissions.remove(code);
    for (const code of toAdd) this.props.permissions.add(code);
    return toRemove.length + toAdd.length > 0;
  }
}
