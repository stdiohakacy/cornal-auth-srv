import { AggregateRoot } from '#src/shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '#src/shared/domain/domain-event.js';
import { newId, type Id } from '#src/shared/domain/id.js';
import { WatchedList } from '#src/shared/domain/watched-list.js';

export type MembershipId = Id<'Membership'>;
export type RoleId = Id<'Role'>;
export type MembershipStatus = 'invited' | 'active' | 'suspended';

export type MembershipEvent = DomainEvent<
  'organization.member_added',
  { orgId: string; userId: string }
>;

/** Role assignments tracked as a diff, so the repository writes only added/removed rows. */
export class RoleSet extends WatchedList<RoleId> {
  constructor(initial: readonly RoleId[]) {
    super(initial);
  }
  protected same(a: RoleId, b: RoleId): boolean {
    return a === b;
  }
}

export type MembershipProps = {
  orgId: string;
  userId: string;
  status: MembershipStatus;
  roles: RoleSet;
  /** Bumped when this member's roles or status change: their tokens become stale. */
  authzVersion: number;
  createdAt: Date;
};

export class Membership extends AggregateRoot<
  MembershipId,
  MembershipProps,
  MembershipEvent
> {
  private constructor(
    id: MembershipId,
    props: MembershipProps,
    version: number,
  ) {
    super(id, props, version);
  }

  static createOwner(input: {
    orgId: string;
    userId: string;
    ownerRoleId: RoleId;
    now: Date;
  }): Membership {
    const roles = new RoleSet([]);
    roles.add(input.ownerRoleId);
    const membership = new Membership(
      newId<'Membership'>(),
      {
        orgId: input.orgId,
        userId: input.userId,
        status: 'active',
        roles,
        authzVersion: 0,
        createdAt: input.now,
      },
      0,
    );
    membership.raise(
      createEvent({
        type: 'organization.member_added',
        aggregateType: 'Membership',
        aggregateId: membership.id,
        payload: { orgId: input.orgId, userId: input.userId },
        occurredAt: input.now,
      }),
    );
    return membership;
  }

  static createMember(input: {
    orgId: string;
    userId: string;
    roleIds: readonly RoleId[];
    now: Date;
  }): Membership {
    const roles = new RoleSet([]);
    for (const roleId of input.roleIds) roles.add(roleId);
    const membership = new Membership(
      newId<'Membership'>(),
      {
        orgId: input.orgId,
        userId: input.userId,
        status: 'active',
        roles,
        authzVersion: 0,
        createdAt: input.now,
      },
      0,
    );
    membership.raise(
      createEvent({
        type: 'organization.member_added',
        aggregateType: 'Membership',
        aggregateId: membership.id,
        payload: { orgId: input.orgId, userId: input.userId },
        occurredAt: input.now,
      }),
    );
    return membership;
  }

  static reconstitute(
    id: MembershipId,
    props: MembershipProps,
    version: number,
  ): Membership {
    return new Membership(id, props, version);
  }

  get orgId(): string {
    return this.props.orgId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get status(): MembershipStatus {
    return this.props.status;
  }
  get roles(): RoleSet {
    return this.props.roles;
  }
  get authzVersion(): number {
    return this.props.authzVersion;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get isActive(): boolean {
    return this.props.status === 'active';
  }

  /** Replaces the role set; true (and authzVersion++) only when something changed. */
  replaceRoles(roleIds: readonly RoleId[]): boolean {
    const wanted = new Set(roleIds);
    const toRemove = this.props.roles.items.filter((id) => !wanted.has(id));
    const toAdd = [...wanted].filter((id) => !this.props.roles.has(id));
    for (const id of toRemove) this.props.roles.remove(id);
    for (const id of toAdd) this.props.roles.add(id);
    const changed = toRemove.length + toAdd.length > 0;
    if (changed) this.props.authzVersion += 1;
    return changed;
  }

  suspend(): boolean {
    return this.changeStatus('suspended');
  }

  reactivate(): boolean {
    return this.changeStatus('active');
  }

  private changeStatus(status: 'active' | 'suspended'): boolean {
    if (this.props.status === status) return false;
    this.props.status = status;
    this.props.authzVersion += 1;
    return true;
  }
}
