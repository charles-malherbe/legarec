import { supportTicket, ticketSent } from '@legarec/contracts';
import { openExternal } from '@legarec/platform';
import { Alerte, Badge, Bouton, Carte, Champ, Icone, Statut, useConfirm } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import { matches } from '../../shared/listState';
import { ARTICLES, CATEGORIES, categoryLabel } from './articles';
import css from './Help.module.css';

const KEYS = [
  ['Rechercher', 'Ctrl K'],
  ['Créer (débiteur, courrier…)', 'C'],
  ['Aller au tableau de bord', 'G puis T'],
  ['Aller à l’agenda des relances', 'G puis R'],
  ['Appeler le débiteur affiché', 'A'],
  ['Ouvrir l’aide', '?'],
];
const SERVICES = ['Application', 'E-mails automatiques (Resend)', 'Messagerie (OVH)', 'Envoi des SMS', 'Téléphonie 3CX'];
const SUBJECTS = ['Question sur une fonctionnalité', 'Signaler un problème', 'Accès et compte', 'Facturation'];

export function HelpPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const searching = query.trim() !== '';
  const list = ARTICLES.filter((item) => (!category || item.category === category) && matches(query, item.title, categoryLabel(item.category)));
  const shown = searching || category ? list : list.filter((item) => item.popular);
  return (
    <>
      <section aria-labelledby="aide-titre" className={css.hero}>
        <h1 id="aide-titre">Comment pouvons-nous vous aider ?</h1>
        <p>Guides pas à pas, réponses aux questions fréquentes et contact du support.</p>
        <div className={css.search}>
          <Champ
            type="search"
            size="lg"
            label="Rechercher dans l’aide"
            hideLabel
            placeholder="Ex. : échéancier, mise en demeure, double authentification…"
            value={query}
            onChange={setQuery}
          />
        </div>
        <div className={css.frequent}>
          <span>Recherches fréquentes :</span>
          {['Échéancier', 'Mise en demeure', 'Double authentification', 'Import CSV'].map((label) => (
            <button
              key={label}
              type="button"
              className={css.popular}
              onClick={() => {
                setQuery(label);
                setCategory('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <div className={layout.columns}>
        <div className={layout.wide}>
          <section aria-labelledby="cat-titre" className={css.block}>
            <div className={layout.between}>
              <h2 id="cat-titre">Parcourir par thème</h2>
              {category && <Bouton variant="link" size="sm" label="Tous les thèmes" onPress={() => setCategory('')} />}
            </div>
            <div className={css.categories}>
              {CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={category === item.id}
                  className={css.category}
                  onClick={() => setCategory(category === item.id ? '' : item.id)}
                >
                  <span style={{ background: `var(--${item.tone.split('|')[0]})`, color: `var(--${item.tone.split('|')[1]})` }}>
                    <Icone icon={item.icon} size={18} />
                  </span>
                  <span className={layout.text}>
                    <span className={layout.strong}>{item.label}</span>
                    <span>{item.text}</span>
                  </span>
                  <span className={layout.hint}>{ARTICLES.filter((article) => article.category === item.id).length} articles</span>
                </button>
              ))}
            </div>
          </section>
          <Carte
            title={searching ? `Résultats pour « ${query} »` : category ? categoryLabel(category) : 'Articles les plus consultés'}
            description={`${shown.length} article${shown.length > 1 ? 's' : ''}`}
            padding="none"
          >
            {shown.length === 0 && (
              <p className={css.empty}>
                Aucun article ne correspond. <a href="#contact">Contactez le support</a>, nous vous répondons sous un jour ouvré.
              </p>
            )}
            <ul className={layout.list}>
              {shown.map((item) => (
                <li key={item.slug}>
                  <Link to={`/aide/${item.slug}`} className={css.article}>
                    <Icone icon="file" size={18} />
                    <span className={`${layout.text} ${layout.grow}`}>
                      <span className={layout.strong}>{item.title}</span>
                      <span className={layout.hint}>
                        {categoryLabel(item.category)} · {item.time} de lecture
                      </span>
                    </span>
                    {item.role && <Badge label={`Rôle ${item.role}`} tone="marine" />}
                    <Icone icon="chevron-right" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Carte>
          <section aria-labelledby="ext-titre" className={css.block}>
            <h2 id="ext-titre">Aider vos créanciers et vos débiteurs</h2>
            <div className={css.portals}>
              <PortalCard
                title="Guide de l’espace créancier"
                text="Déposer des créances, suivre les dossiers, lire les relevés de reversement. À envoyer à vos clients."
                label="Ouvrir l’espace créancier"
                url="https://partenaires.legarec.fr"
              />
              <PortalCard
                title="Questions fréquentes des débiteurs"
                text="Accès par lien, paiement partiel, échéancier, contestation : les réponses à donner au téléphone."
                label="Voir l’espace de paiement"
                url="https://paiement.legarec.fr"
              />
            </div>
          </section>
        </div>
        <aside className={layout.aside}>
          <Support />
          <Carte title="Raccourcis clavier">
            <dl className={layout.facts}>
              {KEYS.map(([label, key]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd className={css.kbd}>{key}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </Carte>
          <Carte title="État des services">
            <dl className={layout.facts}>
              {SERVICES.map((name) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    <Statut label="Opérationnel" tone="success" />
                  </dd>
                </div>
              ))}
            </dl>
          </Carte>
          <Carte title="Nouveautés" padding="none">
            <ul className={layout.list}>
              {['Conversations SMS avec les débiteurs', 'Espace créancier et dépôt de créances en lot', 'Espace de paiement débiteur'].map((label) => (
                <li key={label}>
                  <span className={`${layout.strong} ${layout.grow}`}>{label}</span>
                  <span className={layout.hint}>Novembre 2026</span>
                </li>
              ))}
            </ul>
          </Carte>
        </aside>
      </div>
    </>
  );
}

function PortalCard({ title, text, label, url }: { title: string; text: string; label: string; url: string }) {
  return (
    <div className={css.portal}>
      <span className={layout.strong}>{title}</span>
      <span className={layout.muted}>{text}</span>
      <div>
        <Bouton variant="link" size="sm" iconRight="external" label={label} onPress={() => openExternal(url)} />
      </div>
    </div>
  );
}

function Support() {
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const [subject, setSubject] = useState(SUBJECTS[0] ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const send = () => {
    const parsed = supportTicket.safeParse({ subject, message });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '');
    setError('');
    confirm({
      title: 'Envoyer cette demande au support ?',
      body: 'La réponse arrive à votre adresse e-mail.',
      details: [
        { k: 'Sujet', v: subject },
        { k: 'Réponse à', v: user.email },
      ],
      confirmLabel: 'Envoyer la demande',
      onConfirm: async () => {
        setSent((await change('/support-tickets', { body: parsed.data, schema: ticketSent })).number);
        setMessage('');
      },
    });
  };
  return (
    <div id="contact">
      <Carte title="Contacter le support" description="Du lundi au vendredi, 9 h – 18 h · réponse sous un jour ouvré">
        <form
          className={layout.stack}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {sent && <Alerte tone="success" text={`Demande n° ${sent} envoyée. Vous recevrez la réponse par e-mail.`} />}
          <Champ label="Sujet" type="select" value={subject} options={SUBJECTS} onChange={setSubject} />
          <Champ
            label="Message"
            type="textarea"
            value={message}
            error={error}
            placeholder="Décrivez votre question ; indiquez la référence du dossier si besoin."
            onChange={setMessage}
          />
          <Bouton type="submit" full label="Envoyer la demande" />
          <div className={layout.between}>
            <span className={layout.hint}>Ou directement</span>
            <a className={layout.link} href="mailto:support@legarec.fr">
              support@legarec.fr
            </a>
          </div>
        </form>
      </Carte>
    </div>
  );
}
