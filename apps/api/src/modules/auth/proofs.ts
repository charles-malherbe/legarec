import { type proofNeeded } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import { PASSWORDS, type Passwords } from '../../platform/crypto/passwords';
import type { Actor } from '../../platform/database/actor';
import type { Transaction } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { Accounts } from './accounts';
import { AuthKeys } from './keys';
import { SecondFactors, type Proof } from './second-factors';
import { Sessions } from './sessions';

type StaffActor = Extract<Actor, { kind: 'staff' }>;
type Given = Proof | { method: 'PASSWORD'; password: string };
/** By network, whatever the accounts. */
const PROOFS: RateLimit = { name: 'proof', max: 30, seconds: 600 };
const STARTS: RateLimit = { name: 'proof-start', max: 60, seconds: 600 };

/** Proof of identity given again by someone who is signed in, before what matters most. */
@Injectable()
export class Proofs {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(SecondFactors) private readonly factors: SecondFactors,
    @Inject(PASSWORDS) private readonly passwords: Passwords,
    @Inject(RateLimits) private readonly limits: RateLimits,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async needed(actor: StaffActor): Promise<z.infer<typeof proofNeeded>> {
    const methods = await this.accounts.about(actor.userId, (tx) => this.factors.methods(tx, actor.userId));
    return { methods: methods.length ? methods : ['PASSWORD'] };
  }

  async keyOptions(actor: StaffActor) {
    await this.limits.take(STARTS);
    return this.accounts.own(actor, (tx) => this.factors.authenticationOptions(tx, 'staff', actor.userId, actor.session?.id));
  }

  /** Counted before it is checked; second factors, with those of the sign-in. The fifth failure closes the session. */
  async give(actor: StaffActor, given: Given): Promise<void> {
    await this.limits.take(PROOFS);
    const { userId } = actor;
    const before = await this.accounts.about(userId, async (tx) => ({
      methods: await this.factors.methods(tx, userId),
      hash: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })).passwordHash,
    }));
    const byPassword = given.method === 'PASSWORD';
    // The second factor when there is one: the password alone is no proof of it.
    if (byPassword === before.methods.length > 0) throw new ApiError(422, 'INVALID', { fields: ['method'] });
    if (byPassword) this.passwords.refuseIfFull();
    const key = this.keys.attempt(byPassword ? 'password' : 'second-factor', userId);
    const attempt = await this.accounts.takeAttempt(key, byPassword ? 'PASSWORD' : 'SECOND_FACTOR');
    if (!attempt.allowed) throw new ApiError(423, 'LOCKED', { closed: false });
    const known = byPassword && (await this.passwords.verify(before.hash, given.password));
    const accepted = await this.accounts.own(actor, async (tx) => {
      if (!(await this.holds(tx, actor, given, before.hash, known))) return false;
      await this.accounts.clearAttempts(tx, key);
      await tx.userSession.updateMany({ where: { id: actor.session?.id ?? userId, userId, revokedAt: null }, data: { provedAt: new Date() } });
      await this.audit.log({ action: 'PROOF_GIVEN' });
      return true;
    });
    if (accepted) return;
    await this.accounts.as(userId, () => this.audit.log({ action: attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'PROOF_REFUSED' }));
    if (attempt.left > 0) throw new ApiError(422, 'INVALID_PROOF', { attemptsLeft: attempt.left });
    await this.sessions.close('staff');
    throw new ApiError(423, 'LOCKED', { closed: true });
  }

  /** Once the account is taken: what it has now, not when the proof was typed. */
  private async holds(tx: Transaction, actor: StaffActor, given: Given, hash: string | null, known: boolean): Promise<boolean> {
    const { userId } = actor;
    if (given.method !== 'PASSWORD') return this.factors.accepts(tx, 'staff', { id: actor.session?.id ?? '', userId }, given);
    if (!known || (await this.factors.methods(tx, userId)).length > 0) return false;
    return (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })).passwordHash === hash;
  }
}
