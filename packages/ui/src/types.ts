import type { CSSProperties } from 'react';

export type Tone = 'neutral' | 'marine' | 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'teal' | 'or';
/** `layout` in the mockup: placement only (margins, flex, width), never look and feel. */
export type LayoutProps = { layout?: CSSProperties };
