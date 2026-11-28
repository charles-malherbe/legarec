import { EtatListe, PageHeader } from '@legarec/ui';
import { useNavigate } from 'react-router';
import layout from '@legarec/ui/layout.module.css';
import { SOON, type Feature } from '../../app/features';

/** The pages of the parts not ready yet, with the title of their menu entry. */
const TITLES = {
  calls: 'Appels',
  emails: 'E-mails',
  sms: 'SMS',
  letters: 'Rédiger un courrier',
} as const satisfies Partial<Record<Feature, string>>;

/**
 * The page of a part whose API is not ready in this build (DECISIONS.md, 28/11/2026): reached from its greyed entry,
 * its shortcut or its address, it says what the part waits for. It asks the API nothing, so it is never in error.
 */
export function SoonPage({ feature }: { feature: keyof typeof TITLES }) {
  const navigate = useNavigate();
  const text = SOON[feature];
  return (
    <>
      <PageHeader title={TITLES[feature]} />
      <section className={layout.card}>
        <EtatListe
          kind="empty"
          title="Bientôt disponible"
          text={`${text.charAt(0).toUpperCase()}${text.slice(1)} Cette page s’ouvrira ici dès qu’elle sera prête.`}
          actionLabel="Retour au tableau de bord"
          onAction={() => void navigate('/')}
        />
      </section>
    </>
  );
}
