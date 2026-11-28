import { expect, it } from 'vitest';
import { openExternal, toTelHref } from './index';

it('builds international tel links', () => {
  expect(toTelHref('01 87 88 02 98')).toBe('tel:+33187880298');
});
it('refuses non-https links', () => {
  expect(() => openExternal('javascript:alert(1)')).toThrow();
});
it('computes the French VAT number of a SIREN', async () => {
  const { vatNumberOf } = await import('./publicData');
  expect(vatNumberOf('130 025 265')).toBe('FR07130025265');
  expect(vatNumberOf('552120222')).toBe('FR27552120222');
  expect(vatNumberOf('12345')).toBe('');
});
