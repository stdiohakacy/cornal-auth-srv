import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { InvalidTokenError } from '../domain/identity.errors.js';
import type {
  OneTimeTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

export class VerifyEmailUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: OneTimeTokenRepository,
    private readonly generator: SecretTokenGenerator,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    token: string;
  }): Promise<Result<void, InvalidTokenError>> {
    return this.uow.run(async () => {
      const now = this.clock.now();
      const owner = await this.tokens.consume(
        'email_verify',
        this.generator.hash(input.token),
        now,
      );
      if (!owner) return err(new InvalidTokenError());
      const user = await this.users.findById(owner.userId);
      if (!user) return err(new InvalidTokenError());
      user.verifyEmail(now);
      await this.users.save(user);
      return ok(undefined);
    });
  }
}
