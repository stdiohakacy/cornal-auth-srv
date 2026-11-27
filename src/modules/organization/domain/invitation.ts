import { AggregateRoot } from '../../../shared/domain/aggregate-root.js';
import {
  createEvent,
  type DomainEvent,
} from '../../../shared/domain/domain-event.js';
import { newId, type Id } from '../../../shared/domain/id.js';

export type InvitationId = Id<'Invitation'>;

export type InvitationCreatedPayload = {
  invitationId: string;
  orgId: string;
  orgName: string;
  email: string;
  roleIds: string[];
  invitedBy: string;
};

export type InvitationEvent = DomainEvent<
  'organization.invitation.created',
  InvitationCreatedPayload
>;

type InvitationProps = Omit<InvitationCreatedPayload, 'invitationId'>;

/**
 * An invitation request. It has no table of its own: the worker turns the event into a
 * single-use token (identity's one_time_tokens) and the email, so no secret enters the outbox.
 */
export class Invitation extends AggregateRoot<
  InvitationId,
  InvitationProps,
  InvitationEvent
> {
  private constructor(id: InvitationId, props: InvitationProps) {
    super(id, props, 0);
  }

  static create(input: InvitationProps & { now: Date }): Invitation {
    const { now, ...props } = input;
    const invitation = new Invitation(newId<'Invitation'>(), props);
    invitation.raise(
      createEvent({
        type: 'organization.invitation.created',
        aggregateType: 'Invitation',
        aggregateId: invitation.id,
        payload: {
          invitationId: invitation.id,
          ...props,
          roleIds: [...props.roleIds],
        },
        occurredAt: now,
      }),
    );
    return invitation;
  }
}
