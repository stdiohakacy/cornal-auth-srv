import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '../../../shared/domain/domain-event.js';
import { newId, type Id } from '../../../shared/domain/id.js';
import type { Slug } from './slug.js';

export type OrganizationId = Id<'Organization'>;
export type OrganizationStatus = 'active' | 'suspended';

export type OrganizationEvent = DomainEvent<
  'organization.created',
  { slug: string }
>;

export type OrganizationProps = {
  slug: Slug;
  name: string;
  status: OrganizationStatus;
  /** Bumped when any role definition of the org changes: every token of the org becomes stale. */
  authzEpoch: number;
  mfaRequired: boolean;
  createdAt: Date;
};

export class Organization extends AggregateRoot<
  OrganizationId,
  OrganizationProps,
  OrganizationEvent
> {
  private constructor(
    id: OrganizationId,
    props: OrganizationProps,
    version: number,
  ) {
    super(id, props, version);
  }

  static create(input: { name: string; slug: Slug; now: Date }): Organization {
    const org = new Organization(
      newId<'Organization'>(),
      {
        slug: input.slug,
        name: input.name,
        status: 'active',
        authzEpoch: 0,
        mfaRequired: false,
        createdAt: input.now,
      },
      0,
    );
    org.raise(
      createEvent({
        type: 'organization.created',
        aggregateType: 'Organization',
        aggregateId: org.id,
        payload: { slug: input.slug.value },
        occurredAt: input.now,
      }),
    );
    return org;
  }

  static reconstitute(
    id: OrganizationId,
    props: OrganizationProps,
    version: number,
  ): Organization {
    return new Organization(id, props, version);
  }

  /** A role definition of this org changed: every token scoped to the org becomes stale. */
  bumpAuthzEpoch(): void {
    this.props.authzEpoch += 1;
  }

  get snapshot(): Readonly<OrganizationProps> {
    return this.props;
  }
}
