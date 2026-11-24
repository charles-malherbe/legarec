import { Bouton } from './Bouton';
import css from './PageLegale.module.css';
import { PiedDePage } from './PiedDePage';

const PAGES = {
  mentions: {
    title: 'Mentions légales',
    text: '[TEXTE À FOURNIR : mentions légales du cabinet, [SIREN], [ADRESSE DU CABINET], hébergeur, directeur de la publication.]',
  },
  confidentialite: {
    title: 'Confidentialité (RGPD)',
    text: '[TEXTE À FOURNIR : responsable de traitement, finalités, base légale, destinataires, durées [DURÉE À VALIDER], droits d’accès, de rectification, d’opposition et d’effacement, contact du DPO, réclamation à la CNIL.]',
  },
  cookies: {
    title: 'Cookies',
    text: '[TEXTE À FOURNIR.] Cette application n’utilise que les cookies nécessaires à la connexion : aucune mesure d’audience, aucune publicité.',
  },
};

/** Public legal pages. Their texts are supplied by the firm. */
export function PageLegale({ page, homeHref = '/' }: { page: keyof typeof PAGES; homeHref?: string }) {
  const { title, text } = PAGES[page];
  return (
    <div data-brand className={css.root}>
      <main className={css.main}>
        <Bouton variant="link" size="sm" icon="arrow-left" label="Retour" href={homeHref} layout={{ alignSelf: 'flex-start' }} />
        <h1>{title}</h1>
        <p>{text}</p>
        <p>Legarec, cabinet de recouvrement amiable, Paris · 01 87 88 02 98 · dpo@legarec.fr</p>
      </main>
      <PiedDePage />
    </div>
  );
}
