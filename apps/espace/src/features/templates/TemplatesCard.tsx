import { templatesData } from '@legarec/contracts';
import { Badge, Bouton, Carte, EtatListe, Onglets, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { useApi } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import css from '../settings/Settings.module.css';

const TONES: Record<string, Tone> = {
  'E-mail': 'info',
  SMS: 'teal',
  Courrier: 'warning',
  LRAR: 'danger',
  Facture: 'violet',
  Devis: 'marine',
  Contrat: 'marine',
};
const TABS = [
  ['all', 'Tous'],
  ['COLLECTION', 'Recouvrement'],
  ['BILLING', 'Facturation'],
] as const;

export function TemplatesCard() {
  const { data, error, refetch } = useApi(templatesData, '/templates');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all');
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  const items = data.items.filter((item) => tab === 'all' || item.category === tab);
  return (
    <Carte
      title="Modèles de documents"
      description="Courriers, LRAR, e-mails et SMS de recouvrement, factures, devis et contrats du cabinet. Chaque modification est validée par le Directeur avant d’être utilisée."
      padding="none"
    >
      <div className={css.pad}>
        <Onglets label="Catégorie de modèles" items={TABS.map(([id, label]) => ({ label, selected: id === tab, pick: () => setTab(id) }))} />
      </div>
      <ul className={layout.list}>
        {items.map((item) => (
          <li key={item.id}>
            <Badge label={item.channel} tone={TONES[item.channel] ?? 'neutral'} />
            <span className={`${layout.text} ${layout.grow}`}>
              <span className={layout.strong}>{item.name}</span>
              <span className={layout.hint}>
                Modifié le {item.date} · utilisé {item.uses.toLocaleString('fr-FR')} fois ce mois
              </span>
            </span>
            <Bouton variant="secondary" size="sm" label="Ouvrir" ariaLabel={`Ouvrir : ${item.name}`} href={`/parametres/modeles/${item.id}`} />
          </li>
        ))}
      </ul>
    </Carte>
  );
}
