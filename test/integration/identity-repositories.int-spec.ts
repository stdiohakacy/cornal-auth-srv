import { createHash, randomBytes } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Email } from '../../src/modules/identity/domain/email.js';
import { EmailTakenError } from '../../src/modules/identity/domain/identity.errors.js';
import { User } from '../../src/modules/identity/domain/user.js';
import { TypeOrmOneTimeTokenRepository } from '../../src/modules/identity/infrastructure/typeorm-one-time-token.repository.js';
import { TypeOrmUserRepository } from '../../src/modules/identity/infrastructure/typeorm-user.repository.js';
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../src/shared/application/ports.js';
import { ok } from '../../src/shared/domain/result.js';
import { ConcurrencyConflictError } from '../../src/shared/infrastructure/persistence/concurrency-conflict.error.js';
import { TransactionContext } from '../../src/shared/infrastructure/persistence/transaction-context.js';
import { createPersistenceApp } from './support/persistence-app.js';

const emailOf = (raw: string): Email => {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
};
const uniqueEmail = () => `user-${randomBytes(6).toString('hex')}@test.local`;
const hashToken = () =>
  createHash('sha256').update(randomBytes(32)).digest('hex');

describe('identity repositories (integration)', () => {
  let moduleRef: TestingModule;
  let uow: UnitOfWork;
  let users: TypeOrmUserRepository;
  let tokens: TypeOrmOneTimeTokenRepository;

  const saveInTx = (user: User) =>
    uow.run(async () => {
      await users.save(user);
      return ok(undefined);
    });

  const registerUser = (email = uniqueEmail()) =>
    User.register({
      email: emailOf(email),
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
      now: new Date(),
    });

  beforeAll(async () => {
    moduleRef = await createPersistenceApp();
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    const dataSource = moduleRef.get(DataSource);
    const tx = moduleRef.get(TransactionContext);
    users = new TypeOrmUserRepository(dataSource, tx);
    tokens = new TypeOrmOneTimeTokenRepository(dataSource, tx);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('save then findByEmail round-trips user + password hash', async () => {
    const user = registerUser();
    await saveInTx(user);

    const loaded = await users.findByEmail(user.email);

    expect(loaded?.id).toBe(user.id);
    expect(loaded?.passwordHash).toBe(user.passwordHash);
    expect(loaded?.version).toBe(1);
    expect(loaded?.status).toBe('active');
  });

  it('findByEmail is case-insensitive (citext)', async () => {
    const email = uniqueEmail();
    await saveInTx(registerUser(email));

    const upper = Email.fromPersistence(email.toUpperCase());

    expect(await users.findByEmail(upper)).toBeDefined();
  });

  it('duplicate email on insert throws EmailTakenError', async () => {
    const email = uniqueEmail();
    await saveInTx(registerUser(email));

    await expect(saveInTx(registerUser(email))).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });

  it('stale version throws ConcurrencyConflictError', async () => {
    const user = registerUser();
    await saveInTx(user);
    const first = await users.findById(user.id);
    const second = await users.findById(user.id);
    if (!first || !second) throw new Error('user not found');

    first.verifyEmail(new Date());
    await saveInTx(first);
    second.lock(new Date(), 60_000);

    await expect(saveInTx(second)).rejects.toBeInstanceOf(
      ConcurrencyConflictError,
    );
  });

  it('consume returns userId once, then undefined', async () => {
    const user = registerUser();
    await saveInTx(user);
    const tokenHash = hashToken();
    await uow.run(async () => {
      await tokens.issue({
        purpose: 'email_verify',
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      });
      return ok(undefined);
    });

    const consume = () =>
      uow.run(async () =>
        ok(await tokens.consume('email_verify', tokenHash, new Date())),
      );

    expect(await consume()).toEqual(ok({ userId: user.id }));
    expect(await consume()).toEqual(ok(undefined));
  });

  it('consume of an expired token returns undefined', async () => {
    const user = registerUser();
    await saveInTx(user);
    const tokenHash = hashToken();
    await uow.run(async () => {
      await tokens.issue({
        purpose: 'email_verify',
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 1_000),
      });
      return ok(undefined);
    });

    const result = await uow.run(async () =>
      ok(await tokens.consume('email_verify', tokenHash, new Date())),
    );

    expect(result).toEqual(ok(undefined));
  });

  it('findValid returns the owner without consuming', async () => {
    const user = registerUser();
    await saveInTx(user);
    const tokenHash = hashToken();
    await uow.run(async () => {
      await tokens.issue({
        purpose: 'password_reset',
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      });
      return ok(undefined);
    });

    expect(
      await tokens.findValid('password_reset', tokenHash, new Date()),
    ).toEqual({ userId: user.id });
    expect(
      await tokens.findValid('email_verify', tokenHash, new Date()),
    ).toBeUndefined();
    const consumed = await uow.run(async () =>
      ok(await tokens.consume('password_reset', tokenHash, new Date())),
    );
    expect(consumed).toEqual(ok({ userId: user.id }));
  });

  it('revokeOpen makes earlier tokens unusable', async () => {
    const user = registerUser();
    await saveInTx(user);
    const older = hashToken();
    await uow.run(async () => {
      await tokens.issue({
        purpose: 'email_verify',
        userId: user.id,
        tokenHash: older,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await tokens.revokeOpen(user.id, 'email_verify');
      return ok(undefined);
    });

    const result = await uow.run(async () =>
      ok(await tokens.consume('email_verify', older, new Date())),
    );

    expect(result).toEqual(ok(undefined));
  });
});
