import { Bouton, Carte, EtatListe, Icone, PageHeader } from '@legarec/ui';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import layout from '@legarec/ui/layout.module.css';
import { ARTICLES, categoryLabel } from './articles';
import css from './Help.module.css';

const STEPS: { title: string; text: string; link?: string; href?: string }[] = [
  {
    title: 'Ouvrez le dossier du débiteur',
    text: 'Depuis Débiteurs ou la recherche (Ctrl K), ouvrez la fiche, puis cliquez sur « Proposer un échéancier ».',
    link: 'Ouvrir une fiche débiteur',
    href: '/debiteurs',
  },
  {
    title: 'Simulez le plan',
    text: 'Choisissez le nombre de mensualités : la mensualité et la date de la dernière échéance se calculent automatiquement.',
    link: 'Ouvrir le simulateur',
    href: '/echeanciers',
  },
  { title: 'Choisissez le mode de paiement', text: 'Virement ou chèque, avec la référence du dossier sur chaque versement.' },
  {
    title: 'Envoyez la proposition',
    text: 'Si vous êtes Gestionnaire, la proposition part d’abord en validation chez un Responsable du recouvrement. Sinon, elle est envoyée directement au débiteur.',
  },
  {
    title: 'Le débiteur signe',
    text: 'Il reçoit un lien pour accepter et signer le plan. L’échéancier passe alors « À jour » et les relances classiques s’arrêtent.',
  },
];
const FAQ = [
  [
    'Puis-je modifier un échéancier déjà signé ?',
    'Oui, depuis Échéanciers › Modifier le plan. La modification repart en validation et le débiteur signe un nouveau plan.',
  ],
  [
    'Que se passe-t-il si une échéance n’est pas payée ?',
    'Le débiteur reçoit un rappel et le plan passe « En retard ». Après deux échéances impayées, il passe « En défaut » et vous pouvez reprendre les relances ou proposer le contentieux.',
  ],
  ['Le créancier est-il prévenu ?', 'Oui : l’échéancier apparaît dans son espace créancier, avec le statut « Échéancier » et le détail des paiements reçus.'],
] as const;
const TOC = [
  ['roles', 'Qui peut faire quoi'],
  ['etapes', 'Étape par étape'],
  ['debiteur', 'Demande du débiteur'],
  ['suivi', 'Suivre les échéances'],
  ['faq', 'Questions fréquentes'],
];

export function ArticlePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const article = ARTICLES.find((item) => item.slug === slug);
  if (!article || article.slug !== 'proposer-un-echeancier')
    return (
      <>
        <Bouton label="Centre d’aide" icon="arrow-left" variant="link" size="sm" href="/aide" layout={{ alignSelf: 'flex-start' }} />
        <PageHeader title={article?.title ?? 'Article introuvable'} description={article ? categoryLabel(article.category) : undefined} />
        <div className={layout.card}>
          <EtatListe
            kind="empty"
            title={article ? 'Article en cours de rédaction' : 'Article introuvable'}
            text="Le support répond à vos questions sous un jour ouvré."
            actionLabel="Contacter le support"
            onAction={() => void navigate('/aide#contact')}
          />
        </div>
      </>
    );
  return <PlanArticle title={article.title} time={article.time} />;
}

function PlanArticle({ title, time }: { title: string; time: string }) {
  const [open, setOpen] = useState<number | null>(0);
  const [vote, setVote] = useState<'yes' | 'no' | null>(null);
  return (
    <div className={layout.columns}>
      <article className={`${layout.wide} ${css.content}`}>
        <header className={layout.stack}>
          <Bouton label="Centre d’aide" icon="arrow-left" variant="link" size="sm" href="/aide" layout={{ alignSelf: 'flex-start' }} />
          <h1>{title}</h1>
          <p>
            Quand un débiteur ne peut pas régler en une fois, un échéancier étale le paiement sur plusieurs mois. Voici comment le proposer, qui le valide et
            comment le suivre.
          </p>
          <div className={layout.inline}>
            <span className={layout.hint}>{time} de lecture</span>
            <span className={layout.hint}>Mis à jour le 18 novembre 2026</span>
            <span className={layout.hint}>Pour : Gestionnaires et Responsables</span>
          </div>
        </header>
        <section id="roles" aria-labelledby="h-roles">
          <h2 id="h-roles">Qui peut faire quoi</h2>
          <div className={css.box}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Rôles</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Proposer un échéancier', 'Gestionnaire de créances, Responsable du recouvrement'],
                  ['Valider un échéancier', 'Responsable du recouvrement, Directeur'],
                  ['Demander un échéancier', 'Le débiteur, depuis son espace de paiement'],
                ].map(([action, roles]) => (
                  <tr key={action}>
                    <td>{action}</td>
                    <td>{roles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section id="etapes" aria-labelledby="h-etapes">
          <h2 id="h-etapes">Proposer un échéancier, étape par étape</h2>
          <ol className={css.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className={css.number} aria-hidden>
                  {index + 1}
                </span>
                <div className={layout.text}>
                  <span className={layout.strong}>{step.title}</span>
                  <span>{step.text}</span>
                  {step.href && (
                    <Link className={layout.link} to={step.href}>
                      {step.link} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <div role="note" className={css.note}>
          <Icone icon="alert" size={18} />
          <span>
            <strong>Au-delà de la durée prévue au mandat</strong> (6 mois par défaut), l’échéancier doit aussi être accepté par le créancier. Legarec lui envoie
            la demande dans son espace et vous prévient de sa réponse.
          </span>
        </div>
        <section id="debiteur" aria-labelledby="h-deb">
          <h2 id="h-deb">Quand c’est le débiteur qui demande</h2>
          <p>
            Depuis son espace de paiement, le débiteur peut choisir un paiement en 2, 3 ou 6 mois. Sa demande apparaît dans{' '}
            <Link to="/echeanciers">Échéanciers</Link> avec l’état « À valider », et les relances automatiques sont suspendues jusqu’à la décision.
          </p>
          <p>Une fois la demande validée, le débiteur reçoit le plan à signer et la première échéance est programmée.</p>
        </section>
        <section id="suivi" aria-labelledby="h-suivi">
          <h2 id="h-suivi">Suivre les échéances</h2>
          <p>
            Chaque échéance apparaît dans l’<Link to="/relances">agenda des relances</Link>. Un rappel part 3 jours avant ; en cas d’impayé, le plan passe « En
            retard », puis « En défaut » après deux échéances manquées. Le solde redevient alors exigible.
          </p>
        </section>
        <section id="faq" aria-labelledby="h-faq">
          <h2 id="h-faq">Questions fréquentes</h2>
          <div className={css.box}>
            {FAQ.map(([question, answer], index) => (
              <div key={question} className={css.question}>
                <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
                  {question}
                  <Icone icon={open === index ? 'minus' : 'chevron-down'} size={16} />
                </button>
                {open === index && <p>{answer}</p>}
              </div>
            ))}
          </div>
        </section>
        <section aria-label="Avis sur l’article" className={`${layout.between} ${css.vote}`}>
          {vote ? (
            <span role="status">
              {vote === 'yes' ? 'Merci pour votre retour !' : 'Merci. Dites-nous ce qui manque via le support, nous améliorerons l’article.'}
            </span>
          ) : (
            <span className={layout.inline}>
              Cet article vous a-t-il aidé ?
              <Bouton variant="secondary" size="sm" label="Oui" onPress={() => setVote('yes')} />
              <Bouton variant="secondary" size="sm" label="Non" onPress={() => setVote('no')} />
            </span>
          )}
          <Link className={layout.link} to="/aide#contact">
            Contacter le support
          </Link>
        </section>
      </article>
      <aside className={layout.aside}>
        <Carte title="Sur cette page">
          <nav aria-label="Sur cette page" className={layout.tightStack}>
            {TOC.map(([id, label]) => (
              <a key={id} className={layout.link} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        </Carte>
        <Carte title="Articles liés">
          <div className={layout.tightStack}>
            {['lien-de-paiement', 'remise-ou-abandon', 'roles-et-permissions'].map((slug) => (
              <Link key={slug} className={layout.link} to={`/aide/${slug}`}>
                {ARTICLES.find((item) => item.slug === slug)?.title}
              </Link>
            ))}
          </div>
        </Carte>
      </aside>
    </div>
  );
}
