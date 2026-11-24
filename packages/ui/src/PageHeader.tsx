import { Bouton, type BoutonProps } from './Bouton';
import { Indicateur, type IndicateurProps } from './Indicateur';
import css from './PageHeader.module.css';
import { useShortcut } from './shortcuts';
import { Statut, type StatutProps } from './Statut';

export type PageAction = Omit<BoutonProps, 'variant'> & { primary?: boolean };
export interface PageHeaderProps {
  title: string;
  description?: string;
  stats?: Omit<IndicateurProps, 'variant'>[];
  actions?: PageAction[];
  status?: Pick<StatutProps, 'label' | 'tone'>;
  statsLabel?: string;
  loading?: boolean;
}

export function PageHeader({ title, description, stats = [], actions = [], status, statsLabel = 'Chiffres clés', loading }: PageHeaderProps) {
  useShortcut((event) => {
    if (!/^[a-z]$/i.test(event.key)) return;
    const target = document.querySelector<HTMLElement>(`[data-ph-key="${event.key.toUpperCase()}"]`);
    if (target) {
      event.preventDefault();
      target.click();
    }
  });
  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.text}>
          <h1 className={css.title}>{title}</h1>
          {description && <p className={css.description}>{description}</p>}
        </div>
        <div className={css.actions}>
          {status && <Statut live {...status} />}
          {actions.map(({ primary, ...action }) => (
            <Bouton key={action.label} {...action} variant={primary ? 'primary' : 'secondary'} />
          ))}
        </div>
      </header>
      {stats.length > 0 && (
        <section aria-label={statsLabel} className={css.stats}>
          {stats.map((stat) => (
            <Indicateur key={stat.label} {...stat} variant="cell" loading={loading} />
          ))}
        </section>
      )}
    </div>
  );
}
