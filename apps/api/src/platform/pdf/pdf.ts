import { chromium, type Browser } from 'playwright';

/** A value of the firm still between brackets (`[SIREN]`): nothing that carries it leaves (`FIRM_INCOMPLETE`). */
export const PLACEHOLDER = /\[[A-ZÀ-ÖØ-Þ][^[\]]{2,}\]/u;
export class FirmIncomplete extends Error {
  override readonly name = 'FirmIncomplete';
  constructor() {
    super('FIRM_INCOMPLETE');
  }
}

/**
 * HTML to PDF by Chromium, without JavaScript and without network: the page can only show what it holds. One browser for
 * the worker, started at the first document.
 */
export class PdfRenderer {
  private browser: Promise<Browser> | undefined;

  /** `installed`: the Chromium of the container (`CHROMIUM_PATH`); otherwise that of Playwright. */
  constructor(private readonly installed?: string) {}

  async render(html: string): Promise<Buffer> {
    if (PLACEHOLDER.test(html.replace(/<[^>]+>/gu, ' '))) throw new FirmIncomplete();
    // In the container, the Chromium of Debian without its sandbox: the container is one, and the page runs no script and
    // fetches nothing.
    const { installed } = this;
    this.browser ??= chromium.launch({
      ...(installed ? { executablePath: installed } : {}),
      args: ['--disable-dev-shm-usage', ...(installed ? ['--no-sandbox'] : [])],
    });
    const context = await (await this.browser).newContext({ javaScriptEnabled: false, offline: true });
    try {
      const page = await context.newPage();
      // Nothing is fetched: a resource from elsewhere would say who reads, and could change the document.
      await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) await (await this.browser).close();
    this.browser = undefined;
  }
}
