import { describe, expect, it } from 'vitest';
import { acceptsBody, REQUEST_BODIES, requestBody } from './requests';

describe('bodies of the requests', () => {
  it('find the schema of a real path, the most precise one first', () => {
    expect(requestBody('staff', 'POST', '/cases/reminders')).toBe(REQUEST_BODIES.staff['POST /cases/reminders']);
    expect(requestBody('staff', 'POST', '/cases/demo/reminders')).toBe(REQUEST_BODIES.staff['POST /cases/:id/reminders']);
    expect(requestBody('staff', 'PUT', '/cases/demo/reminders')).toBeNull();
    expect(requestBody('partner', 'POST', '/portal/claims')).toBe(REQUEST_BODIES.partner['POST /portal/claims']);
  });

  it('refuse what the contract refuses, and any body on a route that takes none', () => {
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{"text":"Bonjour"}')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{"text":""}')).toBe(false);
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{}')).toBe(false);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '{}')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '{"password":"x"}')).toBe(false);
  });

  it('limit every text: no body without a ceiling reaches a message or a letter', () => {
    const long = 'x'.repeat(30_000);
    for (const [path, body] of [
      ['/cases/demo/portal-messages', { text: long }],
      ['/cases/demo/reminders', { channel: 'E-mail', template: 'x', recipient: 'x', message: long }],
      ['/sms/s1/messages', { text: long }],
      ['/emails/e1/replies', { text: long }],
    ] as const)
      expect(acceptsBody('staff', 'POST', path, JSON.stringify(body)), path).toBe(false);
  });
});
