import type { Clock } from '#src/shared/application/ports.js';
import type { UserId } from '../domain/user.js';
import type { UserRepository } from './ports.js';

export type UserAuthState = {
  readonly tokenVersion: number;
  readonly canAuthenticate: boolean;
  readonly emailVerified: boolean;
};

/** Façade for the session module: may this user keep a session, and which token version is current? */
export class GetUserAuthStateUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId }): Promise<UserAuthState | undefined> {
    const user = await this.users.findById(input.userId);
    if (!user) return undefined;
    return {
      tokenVersion: user.tokenVersion,
      canAuthenticate: user.ensureCanAttemptLogin(this.clock.now()).ok,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
