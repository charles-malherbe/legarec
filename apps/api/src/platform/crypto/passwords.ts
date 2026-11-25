import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../errors/api-error';

export interface PasswordCost {
  memoryCost: number;
  timeCost: number;
}
/** 64 MB and three passes: about a fifth of a second on the server, and much more for whoever tries millions. */
const PASSWORD: PasswordCost = { memoryCost: 65_536, timeCost: 3 };
/** Memory held at the same time, whatever the number of attempts. */
const AT_ONCE = 3;
/** Beyond, the answer would come too late to be of any use: refused at once. */
const WAITING = 60;

/** Argon2id. Nobody learns from the time of an answer whether an account exists. */
export class Passwords {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private decoy: Promise<string> | undefined;

  constructor(private readonly cost: PasswordCost = PASSWORD) {}

  hash(password: string): Promise<string> {
    return this.oneOfFew(() => this.compute(password));
  }

  /** False without any hash, after the same work. */
  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    // Drawn once, and not among those that wait: it must not be missing because many came at the same time.
    this.decoy ??= this.compute(randomBytes(24).toString('base64'));
    const reference = hash ?? (await this.decoy);
    const same = await this.oneOfFew(() => argon2.verify(reference, password).catch(() => false));
    return same && typeof hash === 'string';
  }

  /** Before an attempt is counted: what will not be checked is not a failure. */
  refuseIfFull(): void {
    if (this.waiting.length >= WAITING) throw new ApiError(503, 'UNAVAILABLE');
  }

  private compute(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, parallelism: 1, ...this.cost });
  }

  private async oneOfFew<T>(work: () => Promise<T>): Promise<T> {
    if (this.running < AT_ONCE) this.running += 1;
    else {
      this.refuseIfFull();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await work();
    } finally {
      // The place goes to the next one, without ever being free in between.
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }
}
export const PASSWORDS = Symbol('PASSWORDS');
