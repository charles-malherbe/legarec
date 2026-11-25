import { expect, it } from 'vitest';
import { openExternal, toTelHref } from './index';

it('builds international tel links', () => {
  expect(toTelHref('01 87 88 02 98')).toBe('tel:+33187880298');
});
it('refuses non-https links', () => {
  expect(() => openExternal('javascript:alert(1)')).toThrow();
});
