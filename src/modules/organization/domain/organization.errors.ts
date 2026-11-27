import { OrgErrorCode } from '#src/contracts/error-codes.js';
import { DomainError } from '#src/shared/domain/domain-error.js';

export class InvalidSlugError extends DomainError<
  typeof OrgErrorCode.InvalidSlug
> {
  readonly code = OrgErrorCode.InvalidSlug;
  constructor() {
    super(
      'Slug must be 3-48 lowercase letters, digits or dashes, not starting or ending with a dash',
    );
  }
}

export class SlugTakenError extends DomainError<typeof OrgErrorCode.SlugTaken> {
  readonly code = OrgErrorCode.SlugTaken;
  constructor() {
    super('This organization slug is already taken');
  }
}

export class EmailNotVerifiedError extends DomainError<
  typeof OrgErrorCode.EmailNotVerified
> {
  readonly code = OrgErrorCode.EmailNotVerified;
  constructor() {
    super('Verify your email address before creating an organization');
  }
}

export class MemberNotFoundError extends DomainError<
  typeof OrgErrorCode.MemberNotFound
> {
  readonly code = OrgErrorCode.MemberNotFound;
  constructor() {
    super('Member not found in this organization');
  }
}

export class AlreadyMemberError extends DomainError<
  typeof OrgErrorCode.AlreadyMember
> {
  readonly code = OrgErrorCode.AlreadyMember;
  constructor() {
    super('You are already a member of this organization');
  }
}

export class LastOwnerError extends DomainError<typeof OrgErrorCode.LastOwner> {
  readonly code = OrgErrorCode.LastOwner;
  constructor() {
    super('An organization must keep at least one active owner');
  }
}

export class InsufficientPrivilegeError extends DomainError<
  typeof OrgErrorCode.InsufficientPrivilege
> {
  readonly code = OrgErrorCode.InsufficientPrivilege;
  constructor() {
    super('You can only grant or manage permissions you hold yourself');
  }
}

export class RoleNotFoundError extends DomainError<
  typeof OrgErrorCode.RoleNotFound
> {
  readonly code = OrgErrorCode.RoleNotFound;
  constructor() {
    super('Role not found in this organization');
  }
}

export class RoleKeyTakenError extends DomainError<
  typeof OrgErrorCode.RoleKeyTaken
> {
  readonly code = OrgErrorCode.RoleKeyTaken;
  constructor() {
    super('A role with this key already exists in this organization');
  }
}

export class RoleInUseError extends DomainError<typeof OrgErrorCode.RoleInUse> {
  readonly code = OrgErrorCode.RoleInUse;
  constructor() {
    super('The role is still assigned to members');
  }
}

export class InvalidRoleKeyError extends DomainError<
  typeof OrgErrorCode.InvalidRoleKey
> {
  readonly code = OrgErrorCode.InvalidRoleKey;
  constructor() {
    super(
      'Role key must be 2-32 lowercase letters, digits, "_" or "-", start with a letter, and not be owner/admin/member',
    );
  }
}

export class InvitationInvalidError extends DomainError<
  typeof OrgErrorCode.InvitationInvalid
> {
  readonly code = OrgErrorCode.InvitationInvalid;
  constructor() {
    super(
      'The invitation is invalid, expired, already used, or for a different email',
    );
  }
}

export class InvitationNotFoundError extends DomainError<
  typeof OrgErrorCode.InvitationNotFound
> {
  readonly code = OrgErrorCode.InvitationNotFound;
  constructor() {
    super('Invitation not found');
  }
}
