import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The front tests share the machine with those of the API: one second, the default, is too short under load.
configure({ asyncUtilTimeout: 5_000 });

afterEach(cleanup);

// API tests run in the node environment, without a window.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // ProseMirror (the editor of the e-mails) asks where the caret is drawn; jsdom draws nothing.
  const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  const none = () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects ??= empty;
  Range.prototype.getBoundingClientRect ??= none;
  Element.prototype.getClientRects ??= empty;
  (Text.prototype as unknown as Element).getClientRects ??= empty;
  document.elementFromPoint ??= () => null;
}
