import '@testing-library/jest-dom/vitest';
import { cssVariablesResolver, espaceTheme } from '@legarec/tokens';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from './Confirm';
import { ToastProvider } from './Toast';

export function renderUi(element: ReactElement, path = '/') {
  return render(
    <MantineProvider theme={espaceTheme} cssVariablesResolver={cssVariablesResolver} env="test">
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <ConfirmProvider>{element}</ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

/** Colour contrast needs a real browser: it is covered by the Playwright runs. */
export async function axeViolations(node: Element) {
  const result = await axe.run(node, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((item) => item.html).join(' | ')}`);
}
