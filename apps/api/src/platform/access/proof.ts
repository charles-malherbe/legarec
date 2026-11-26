import { PROOF_MINUTES } from '@legarec/contracts';
import { SetMetadata } from '@nestjs/common';
import type { Actor } from '../database/actor';
import { ApiError } from '../errors/api-error';

export const PROOF = Symbol('legarec:proof');
/** What matters most: refused when the password or the second factor was given too long ago (question 122). */
export const RequiresProof = () => SetMetadata(PROOF, true);

/** Nobody whose last proof is unknown. A body that comes later is not read: nothing of the action has started. */
export function requireProof(actor: Actor, now = Date.now()): void {
  const provedAt = actor.kind === 'staff' ? actor.provedAt : undefined;
  if (!provedAt || now - provedAt.getTime() > PROOF_MINUTES * 60_000) throw new ApiError(403, 'PROOF_REQUIRED');
}
