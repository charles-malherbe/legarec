import { expect, test } from '@playwright/test';

test('signs out, signs back in and reaches a page with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Compte de Camille Laurent/ }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.getByLabel('Adresse e-mail').fill('cl@legarec.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('motdepasse12');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
  await page.locator('body').press('/');
  await page.getByPlaceholder('Débiteur, SIRET, SIREN, facture…').fill('batiplus');
  await expect(page.getByRole('option', { name: /Bâtiplus SAS SIRET/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('keeps no token in web storage', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/token|jwt|password|eyJ/i);
});
