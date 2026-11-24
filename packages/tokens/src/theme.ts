import { createTheme, type CSSVariablesResolver, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';

const marine: MantineColorsTuple = ['#EEF2F8', '#D6E0F0', '#B8CBEA', '#7F9CD0', '#4F73B8', '#345DA8', '#1A4590', '#002B74', '#00225C', '#001B4D'];
const or: MantineColorsTuple = ['#FFF8E1', '#FFF3C4', '#FEE89A', '#FDDC6B', '#FDD23F', '#FCC91F', '#FCBE03', '#D9A302', '#A97E02', '#7A5B01'];

const base: MantineThemeOverride = {
  primaryColor: 'marine',
  primaryShade: { light: 7, dark: 5 },
  colors: { marine, or },
  fontFamily: 'var(--font-text)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: { fontFamily: 'var(--font-title)', fontWeight: '700' },
  fontSizes: { xs: 'var(--fs-xs)', sm: 'var(--fs-sm)', md: 'var(--fs-base)', lg: 'var(--fs-lg)', xl: 'var(--fs-xl)' },
  radius: { xs: 'var(--r-xs)', sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)', xl: 'var(--r-full)' },
  shadows: { xs: 'var(--shadow-sm)', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)', xl: 'var(--shadow-lg)' },
  defaultRadius: 'sm',
  cursorType: 'pointer',
  respectReducedMotion: true,
};

/** Dense theme of espace.legarec.fr. */
export const espaceTheme = createTheme({
  ...base,
  spacing: { xs: 'var(--sp-2)', sm: 'var(--sp-3)', md: 'var(--sp-4)', lg: 'var(--sp-5)', xl: 'var(--sp-6)' },
});

/** Airier theme of partenaires and paiement, with Lora headings. */
export const publicTheme = createTheme({
  ...base,
  headings: { fontFamily: 'var(--font-brand)', fontWeight: '700' },
  spacing: { xs: 'var(--sp-3)', sm: 'var(--sp-4)', md: 'var(--sp-5)', lg: 'var(--sp-6)', xl: 'var(--sp-8)' },
});

/** Maps Mantine's own variables onto the Legarec tokens, so both modes follow tokens.css. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-color-body': 'var(--surface-2)',
    '--mantine-color-text': 'var(--text)',
    '--mantine-color-dimmed': 'var(--text-3)',
    '--mantine-color-error': 'var(--danger-fg)',
    '--mantine-color-placeholder': 'var(--text-3)',
    '--mantine-color-anchor': 'var(--marine-text)',
    '--mantine-color-default': 'var(--surface)',
    '--mantine-color-default-color': 'var(--text)',
    '--mantine-color-default-border': 'var(--border-strong)',
    '--mantine-color-default-hover': 'var(--surface-2)',
    '--mantine-primary-color-filled': 'var(--marine)',
    '--mantine-primary-color-filled-hover': 'var(--marine-hover)',
  },
  light: {},
  dark: {},
});
