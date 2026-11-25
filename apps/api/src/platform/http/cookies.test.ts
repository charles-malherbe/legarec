import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { CookieJar } from './cookies';

const jar = (header?: string) => {
  const sent: string[][] = [];
  const response = { setHeader: (_name: string, value: string[]) => sent.push(value) } as unknown as Response;
  return { jar: new CookieJar(header, response), sent };
};

describe('cookies', () => {
  it('reads those of this host only', () => {
    const { jar: cookies } = jar('__Host-staff=abc; staff=forged;__Host-device=d=1;  __Host-empty=; =x; alone');
    expect(cookies.get('staff')).toBe('abc');
    expect(cookies.get('device')).toBe('d=1');
    expect(cookies.get('empty')).toBe('');
    expect(cookies.get('partner')).toBeUndefined();
    expect(jar().jar.get('staff')).toBeUndefined();
    // Without its prefix, it may come from another host of the domain.
    expect(jar('staff=forged').jar.get('staff')).toBeUndefined();
  });

  it('keeps the last of two with the same name', () => {
    expect(jar('__Host-staff=first; __Host-staff=second').jar.get('staff')).toBe('second');
  });

  it('writes each one once, with the last value', () => {
    const { jar: cookies, sent } = jar();
    cookies.set('staff', 'a');
    cookies.set('device', 'd', 60);
    cookies.clear('staff');
    expect(sent.at(-1)).toEqual([
      '__Host-staff=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
      '__Host-device=d; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60',
    ]);
  });
});
