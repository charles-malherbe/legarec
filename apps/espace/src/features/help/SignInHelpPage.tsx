import { Bouton, PageConnexion } from '@legarec/ui';
import page from '@legarec/ui/PageConnexion.module.css';
import css from './SignInHelp.module.css';

/**
 * Help for whoever cannot sign in, reachable without an account from the sign-in pages: the help centre itself needs a
 * session (DECISIONS.md, 27/11/2026). Only what the sign-in screens and the rules of the firm already say.
 */
export function SignInHelpPage() {
  return (
    <PageConnexion help={false}>
      <div className={page.step}>
        <Bouton variant="link" size="sm" icon="arrow-left" label="Retour à la connexion" href="/connexion" layout={{ alignSelf: 'flex-start' }} />
        <div className={page.heading}>
          <h1>Aide à la connexion</h1>
          <p>Les cas les plus fréquents, et qui peut vous dépanner.</p>
        </div>
        <section className={css.section}>
          <h2>Mot de passe oublié</h2>
          <p>
            Choisissez « Mot de passe oublié ? » sur la page de connexion : nous vous envoyons par e-mail un lien de réinitialisation, valable 1 heure. Le mot
            de passe compte au moins 12 caractères.
          </p>
        </section>
        <section className={css.section}>
          <h2>Compte bloqué</h2>
          <p>Après 5 tentatives échouées, le compte est bloqué pendant 15 minutes. Attendez la fin du blocage, ou réinitialisez votre mot de passe.</p>
        </section>
        <section className={css.section}>
          <h2>Invitation</h2>
          <p>
            L’e-mail d’invitation contient un lien valable 72 heures pour choisir votre mot de passe. Passé ce délai, demandez une nouvelle invitation à la
            personne qui vous a invité.
          </p>
        </section>
        <section className={css.section}>
          <h2>Double authentification</h2>
          <p>
            Après le mot de passe, saisissez le code à 6 chiffres de votre application d’authentification, ou utilisez votre clé de sécurité. Téléphone perdu :
            utilisez l’un de vos codes de secours. Elle est obligatoire pour le rôle Développeur.
          </p>
        </section>
        <section className={css.section}>
          <h2>Toujours bloqué ?</h2>
          <p>
            Le Développeur du cabinet peut débloquer votre compte ou réinitialiser votre double authentification ; le Responsable du recouvrement aussi, sauf
            pour le compte du Directeur.
          </p>
        </section>
        <section className={css.section}>
          <h2>Déconnexion automatique</h2>
          <p>Sans activité, un avertissement s’affiche au bout de 28 minutes, puis la session se ferme à 30 minutes.</p>
        </section>
        <section className={css.section}>
          <h2>Vous êtes créancier ?</h2>
          <p>
            Votre espace est sur <a href="https://partenaires.legarec.fr">partenaires.legarec.fr</a>.
          </p>
        </section>
      </div>
    </PageConnexion>
  );
}
