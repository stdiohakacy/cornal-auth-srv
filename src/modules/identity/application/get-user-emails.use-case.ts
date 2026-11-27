import type { UserId } from '../domain/user.js';
import type { UserRepository } from './ports.js';

/** Façade for listings in other modules (e.g. organization members). */
export class GetUserEmailsUseCase {
  constructor(private readonly users: UserRepository) {}

  execute(input: {
    userIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    // ids come from other modules' rows referencing users(id): trusted boundary
    return this.users.emailsByIds(input.userIds as UserId[]);
  }
}
