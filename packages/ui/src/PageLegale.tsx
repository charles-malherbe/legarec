import { Fragment } from 'react';
import { Bouton } from './Bouton';
import css from './PageLegale.module.css';
import { PiedDePage } from './PiedDePage';

type Section = [heading: string, text: string];

/** Approved by the firm. Bracketed values come from the firm. */
const PAGES: Record<'mentions' | 'confidentialite' | 'cookies', { title: string; sections: Section[] }> = {
  mentions: {
    title: 'Mentions légales',
    sections: [
      [
        'Éditeur',
        'Legarec, [FORME JURIDIQUE ET CAPITAL], cabinet de recouvrement amiable de créances pour le compte d’autrui. Siège : [ADRESSE DU CABINET]. SIREN : [SIREN]. RCS : [RCS]. TVA intracommunautaire : [N° TVA]. Téléphone : 01 87 88 02 98.',
      ],
      ['Directeur de la publication', '[DIRECTEUR DE LA PUBLICATION].'],
      ['Hébergeur', '[HÉBERGEUR : nom, adresse, téléphone].'],
      [
        'Activité',
        'Legarec exerce une activité de recouvrement amiable (articles L124-1 et R124-1 et suivants du Code des procédures civiles d’exécution). Le cabinet n’est ni commissaire de justice ni avocat et ne prend aucune mesure d’exécution forcée.',
      ],
      ['Propriété intellectuelle', 'Les textes, la marque et les éléments graphiques de ce site ne peuvent être repris sans autorisation.'],
    ],
  },
  confidentialite: {
    title: 'Confidentialité (RGPD)',
    sections: [
      [
        'Qui traite vos données',
        'Legarec traite les données des dossiers pour recouvrer à l’amiable les créances que ses clients lui confient. Il agit alors en sous-traitant du créancier, responsable du traitement (article 28 du RGPD). Legarec est responsable du traitement pour sa comptabilité, sa sécurité, son personnel et sa téléphonie.',
      ],
      [
        'Pourquoi et sur quelle base',
        'Pour les dossiers : l’intérêt légitime du créancier à recouvrer sa créance. Pour la comptabilité : les obligations légales du cabinet. Pour la sécurité et les enregistrements d’appels : l’intérêt légitime du cabinet à protéger ses services, former ses équipes et conserver la preuve de ses démarches.',
      ],
      [
        'Quelles données et d’où elles viennent',
        'Identité, coordonnées, factures, paiements, échanges et pièces du dossier. Elles sont transmises par le créancier, ou par vous lors de nos échanges. S’y ajoutent les enregistrements d’appels, lorsqu’ils sont annoncés, et les données de connexion : adresse IP, date, actions sensibles.',
      ],
      [
        'À qui elles sont communiquées',
        'Au créancier, aux collaborateurs habilités du cabinet et à ses prestataires techniques (hébergement, courrier, e-mail, SMS, téléphonie) ; le cas échéant, à l’avocat ou au commissaire de justice choisi par le créancier. Fournisseur de l’assistance par IA : [FOURNISSEUR IA], hébergé dans l’Union européenne.',
      ],
      ['Transferts hors de l’Union européenne', '[PRESTATAIRES CONCERNÉS ET GARANTIES].'],
      [
        'Combien de temps',
        'Dossiers soldés ou irrécouvrables : 5 ans après leur clôture, en archive à accès restreint. Factures et pièces comptables : 10 ans. Enregistrements d’appels : 6 mois. Journal des actions : 1 an.',
      ],
      [
        'Assistance par intelligence artificielle',
        'Une assistance peut aider nos collaborateurs à résumer ou à rédiger. Elle ne prend aucune décision et n’envoie aucun message : un collaborateur relit et valide toujours.',
      ],
      [
        'Priorité des dossiers d’entreprises',
        'Un indicateur de risque, calculé par des règles simples (montant, ancienneté, promesses non tenues), peut aider à organiser le travail. Il est indicatif, n’existe pas pour les particuliers et n’entraîne aucune décision automatique.',
      ],
      [
        'Comptes des créanciers et des collaborateurs',
        'Identité, adresse e-mail, rôle et journal de connexion, pour l’accès au service et sa sécurité. Conservation : durée du compte ; journal : 1 an.',
      ],
      [
        'Vos droits',
        'Accès, rectification, effacement, limitation et opposition : dpo@legarec.fr. Une demande concernant un dossier est transmise au créancier. Vous pouvez saisir la CNIL (cnil.fr).',
      ],
    ],
  },
  cookies: {
    title: 'Cookies',
    sections: [
      [
        'Cookies utilisés',
        'Seuls les cookies nécessaires à la connexion et à la sécurité sont déposés, sans consentement préalable (article 82 de la loi Informatique et Libertés). Aucune mesure d’audience, aucune publicité.',
      ],
      ['Durée', 'Ils disparaissent à la fin de votre session, ou après 30 jours si vous avez demandé à mémoriser votre appareil.'],
      ['Préférences d’affichage', 'Vos choix d’affichage (thème, confort de lecture) sont gardés dans votre navigateur et ne nous sont pas transmis.'],
    ],
  },
};

/** Public legal pages. */
export function PageLegale({ page, homeHref = '/' }: { page: keyof typeof PAGES; homeHref?: string }) {
  const { title, sections } = PAGES[page];
  return (
    <div data-brand className={css.root}>
      <main className={css.main}>
        <Bouton variant="link" size="sm" icon="arrow-left" label="Retour" href={homeHref} layout={{ alignSelf: 'flex-start' }} />
        <h1>{title}</h1>
        {sections.map(([heading, text]) => (
          <Fragment key={heading}>
            <h2>{heading}</h2>
            <p>{text}</p>
          </Fragment>
        ))}
        <p>Legarec, cabinet de recouvrement amiable, Paris · 01 87 88 02 98 · dpo@legarec.fr</p>
      </main>
      <PiedDePage />
    </div>
  );
}
