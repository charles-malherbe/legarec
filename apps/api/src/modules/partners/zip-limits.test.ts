import { describe, expect, it } from 'vitest';
import { xlsx, zip } from '../../../test/zip';
import { withinZipLimits } from './zip-limits';

describe('the limits of an archive, read before the reader of Excel files', () => {
  it('lets a workbook through', () => {
    expect(withinZipLimits(xlsx([['debiteur'], ['Garage Valmont']]))).toBe(true);
  });

  it('refuses a file that inflates beyond the ceiling, whatever it announces', () => {
    const bomb = '0'.repeat(25 * 1024 * 1024);
    expect(withinZipLimits(zip([{ name: 'xl/worksheets/sheet1.xml', data: bomb }]))).toBe(false);
    expect(withinZipLimits(zip([{ name: 'xl/worksheets/sheet1.xml', data: bomb, size: 1000 }]))).toBe(false);
  });

  it('refuses a size announced larger than the file, which the reader would reserve', () => {
    expect(withinZipLimits(zip([{ name: 'a.xml', data: 'abc', size: 3 * 1024 * 1024 * 1024 - 1 }]))).toBe(false);
  });

  it('refuses what is not an archive, or bytes hidden between its files', () => {
    expect(withinZipLimits(new TextEncoder().encode('debiteur;siret'))).toBe(false);
    const archive = zip([{ name: 'a.xml', data: 'abc' }]);
    const hidden = new Uint8Array(archive.length + 4);
    hidden.set(archive.subarray(0, 30 + 5 + 5), 0);
    expect(withinZipLimits(hidden)).toBe(false);
  });
});
