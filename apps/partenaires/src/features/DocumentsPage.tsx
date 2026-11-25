import { portalDocuments } from '@legarec/contracts';
import { Badge, Bouton, EtatListe } from '@legarec/ui';
import css from '../app/Portal.module.css';
import { useApi } from '../app/data';

export function DocumentsPage() {
  const { data, error, refetch } = useApi(portalDocuments, '/portal/documents');
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Relevés et rapports</h1>
          <p>Rapport mensuel disponible le 5 de chaque mois, relevé de reversement le 15.</p>
        </div>
      </div>
      <div className={css.panel} data-flush>
        {!data ? (
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        ) : data.items.length === 0 ? (
          <EtatListe kind="empty" title="Aucun document" text="Vos relevés et rapports apparaîtront ici." />
        ) : (
          <ul className={css.activity}>
            {data.items.map((item) => (
              <li key={item.id}>
                <Badge label={item.extension} tone="marine" />
                <span className={css.lines}>
                  <strong>{item.name}</strong>
                  <small>{item.meta}</small>
                </span>
                <span className={css.when}>
                  <Bouton variant="link" size="sm" label="Télécharger" ariaLabel={`Télécharger : ${item.name}`} disabled title="Disponible avec l’API" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
