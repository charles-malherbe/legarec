/** A refusal that trying again would not change: `code` says why. */
export class GiveUp extends Error {
  override readonly name = 'GiveUp';
  constructor(readonly code: string) {
    super(code);
  }
}

/** Nothing has left yet: the task is tried again, for as long as it takes, even when a second run would do harm. */
export class TryLater extends Error {
  override readonly name = 'TryLater';
  constructor(readonly code: string) {
    super(code);
  }
}
