import { Bouton, PiedDePage } from '@legarec/ui';
import { Link } from 'react-router';
import css from './ErrorPage.module.css';

const CONTENT = {
  403: {
    title: 'Accès réservé',
    text: 'Cette page est réservée à d’autres rôles. Si vous pensez en avoir besoin, demandez l’accès à un responsable du recouvrement.',
    label: 'Voir mes droits',
    href: '/compte',
  },
  404: {
    title: 'Page introuvable',
    text: 'Le lien est peut-être ancien, ou le dossier a été archivé. Utilisez la recherche pour le retrouver par nom, SIRET ou numéro de facture.',
    label: 'Centre d’aide',
    href: '/aide',
  },
  500: {
    title: 'Un incident technique est en cours',
    text: 'Votre action n’a pas été enregistrée. Nos équipes sont prévenues automatiquement ; réessayez dans quelques minutes.',
    label: 'État des services',
    href: '/aide',
  },
} as const;

/** `reference` comes from the API error, never generated in the browser. */
export function ErrorPage({ code = 404, reference }: { code?: keyof typeof CONTENT; reference?: string }) {
  const content = CONTENT[code];
  return (
    <main data-brand className={css.root}>
      <div className={css.box}>
        <Link to="/" aria-label="Legarec, accueil" className={css.brand}>
          <span aria-hidden className={css.logo} />
          <span className={css.name}>Legarec</span>
        </Link>
        <span className={css.code}>Erreur {code}</span>
        <h1 className={css.title}>{content.title}</h1>
        <span aria-hidden className={css.rule} />
        <p className={css.text}>{content.text}</p>
        <div className={css.actions}>
          <Bouton size="lg" label="Retour au tableau de bord" href="/" />
          <Bouton variant="secondary" size="lg" label={content.label} href={content.href} />
        </div>
        <span className={css.reference}>
          Référence à communiquer au support : <code>{reference ?? `LGR-${code}`}</code> · administratif@legarec.fr
        </span>
        <div className={css.foot}>
          <PiedDePage variant="integre" helpHref="/aide" />
        </div>
      </div>
    </main>
  );
}

/** Shown inside the shell when the current role cannot open a screen. */
export function AccessDenied() {
  return (
    <section className={css.denied} aria-labelledby="acces-refuse">
      <h1 id="acces-refuse" className={css.deniedTitle}>
        {CONTENT[403].title}
      </h1>
      <p className={css.text}>{CONTENT[403].text}</p>
      <div className={css.actions}>
        <Bouton label="Retour au tableau de bord" href="/" />
        <Bouton variant="secondary" label={CONTENT[403].label} href="/compte" />
      </div>
    </section>
  );
}
