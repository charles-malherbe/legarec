import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { Passwords } from './passwords';

const cheap = () => new Passwords({ memoryCost: 1_024, timeCost: 2 });

describe('passwords', () => {
  it('are hashed with Argon2id, 64 MB and three passes, never twice the same way', async () => {
    const passwords = new Passwords();
    const [first, second] = [await passwords.hash('un mot de passe'), await passwords.hash('un mot de passe')];
    expect(first).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/u);
    expect(first).not.toBe(second);
    expect(await passwords.verify(first, 'un mot de passe')).toBe(true);
    expect(await passwords.verify(first, 'un mot de passE')).toBe(false);
  });

  it('are false without any hash, with one that is not one, and for the decoy itself', async () => {
    const passwords = cheap();
    for (const hash of [null, undefined, '', 'x', '$argon2id$v=19$m=1$']) expect(await passwords.verify(hash, 'x'), String(hash)).toBe(false);
  });

  it('cost the same work whether the account exists or not', async () => {
    const passwords = cheap();
    const hash = await passwords.hash('un mot de passe');
    const verify = vi.spyOn(argon2, 'verify');
    await passwords.verify(null, 'x');
    await passwords.verify(hash, 'x');
    await passwords.verify(null, 'x');
    const [unknown, known, again] = verify.mock.calls.map(([reference]) => reference as string);
    const cost = (reference: string | undefined) => reference?.split('$').slice(0, 4).join('$');
    expect(cost(unknown)).toBe(cost(known));
    // Drawn once.
    expect(again).toBe(unknown);
    vi.restoreAllMocks();
  });

  it('are checked three at a time, in the order they came, even when one fails', async () => {
    const passwords = cheap();
    await passwords.verify(null, 'x');
    let running = 0;
    let most = 0;
    const seen: string[] = [];
    vi.spyOn(argon2, 'verify').mockImplementation(async (_hash, value) => {
      running += 1;
      most = Math.max(most, running);
      seen.push(String(value));
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      if (value === '4') throw new Error('broken');
      return true;
    });
    const hash = '$argon2id$x';
    const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => passwords.verify(hash, String(i))));
    expect(most).toBe(3);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
    expect(answers.map((answer, i) => (answer ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]);
    vi.restoreAllMocks();
  });

  it('are refused at once when too many wait, and checked again as soon as there is room', async () => {
    const passwords = cheap();
    // The decoy is there, whatever comes next.
    let release: (() => void)[] = [];
    vi.spyOn(argon2, 'verify').mockImplementation(() => new Promise((resolve) => release.push(() => resolve(true))));
    const waiting = Array.from({ length: 70 }, () =>
      passwords.verify(null, 'x').then(
        () => 'checked',
        (error: unknown) => (error as { code: string }).code,
      ),
    );
    await vi.waitFor(() => expect(release).toHaveLength(3));
    for (let checked = 0; checked < 63;) {
      const now = release;
      release = [];
      for (const go of now) go();
      checked += now.length;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const answers = await Promise.all(waiting);
    expect(answers.filter((answer) => answer === 'checked')).toHaveLength(63);
    expect(answers.filter((answer) => answer === 'UNAVAILABLE')).toHaveLength(7);
    vi.restoreAllMocks();
    expect(await passwords.verify(null, 'x')).toBe(false);
  });
});
