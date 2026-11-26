import { Bouton, PiedDePage } from '@legarec/ui';
import css from '../app/Portal.module.css';

export function HelpPage() {
  return (
    <div data-brand className={css.root}>
      <main className={css.help}>
        <Bouton variant="link" size="sm" icon="arrow-left" label="Retour" href="/" layout={{ alignSelf: 'flex-start' }} />
        <h1>Aide de l’espace créancier</h1>
        <h2>Déposer des créances</h2>
        <p>Déposez une créance avec sa facture, ou un fichier CSV ou Excel avec une ligne par facture. Rien n’est créé avant votre confirmation.</p>
        <h2>Donner votre accord sur un échéancier</h2>
        <p>Quand un échéancier dépasse la durée prévue à votre mandat, une demande d’accord apparaît sur votre tableau de bord.</p>
        <h2>Nous joindre</h2>
        <p>Écrivez à recouvrement@legarec.fr en indiquant la référence du dossier, ou appelez le 01 87 88 02 98 du lundi au vendredi, 9 h – 19 h.</p>
      </main>
      <PiedDePage helpHref="/aide" maxWidth="1320px" />
    </div>
  );
}
