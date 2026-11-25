import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../scripts/ecrans.json', import.meta.url), 'utf8')) as Record<string, { app: string; route: string }> & {
  _bases: Record<string, string>;
};
const DONE = JSON.parse(readFileSync(new URL('./done.json', import.meta.url), 'utf8')) as string[];
/** Extra routes without a mockup capture. */
const EXTRA = JSON.parse(readFileSync(new URL('./extra.json', import.meta.url), 'utf8')) as Record<string, { app: string; route: string }>;
const screens = { ...Object.fromEntries(DONE.map((name) => [name, config[name]!])), ...EXTRA };

for (const [name, screen] of Object.entries(screens)) {
  test.describe(name, () => {
    const url = (config._bases as Record<string, string>)[screen.app] + screen.route;
    for (const width of [390, 768, 1024, 1440]) {
      test(`fits ${width}px without horizontal scroll and passes axe`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle' });
        await expect(page.locator('main').first()).toBeVisible();
        await expect(page.getByText('Chargement en cours…')).toHaveCount(0);
        for (const mode of width === 1440 ? ['normal', 'malvoyant', 'sombre'] : ['normal', 'malvoyant']) {
          await page.evaluate((value) => {
            const root = document.documentElement;
            delete root.dataset.a11y;
            root.dataset.theme = value === 'sombre' ? 'dark' : 'light';
            if (value === 'malvoyant') root.dataset.a11y = value;
          }, mode);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${mode}: horizontal scroll`).toBeLessThanOrEqual(0);
          const { violations } = await new AxeBuilder({ page }).analyze();
          expect(
            violations.map(
              (item) =>
                `${mode} ${item.id}: ${item.nodes
                  .slice(0, 3)
                  .map((node) => `${node.target.join(' ')} ${node.any[0]?.message ?? ''}`)
                  .join(' | ')}`,
            ),
          ).toEqual([]);
        }
      });
    }
    test('shows no forbidden text', async ({ page }) => {
      await page.goto(url, { waitUntil: 'networkidle' });
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/PCI-DSS|carte bancaire|prélèvement SEPA|Dirigeant|Démonstration|Voir en tant que/i);
    });
  });
}
