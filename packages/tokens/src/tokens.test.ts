import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

it('keeps tokens.css identical to the mockup reference', () => {
  expect(read('./tokens.css')).toBe(read('../../../maquette/tokens.css'));
});
it('loads no external font', () => {
  expect(read('./fonts.css')).not.toMatch(/https?:/);
});
