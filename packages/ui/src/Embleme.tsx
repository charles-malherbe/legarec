import css from './Embleme.module.css';

/**
 * Emblem of the firm's media kit (the shield), used as the application icon in place of the « L » of the mockup.
 * Decorative: the name of the firm always sits next to it or names the link that holds it.
 */
export function Embleme({ size = 32 }: { size?: number }) {
  return <span aria-hidden className={css.root} style={{ width: size, height: size }} />;
}
