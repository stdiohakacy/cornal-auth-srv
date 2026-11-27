import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '../../../shared/domain/domain-event.js';
import { newId, type Id } from '../../../shared/domain/id.js';
import { WatchedList } from '../../../shared/domain/watched-list.js';

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
}
