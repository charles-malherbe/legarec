import { EMAIL_CATEGORIES, emailCategory, formatCents, mailboxData, type EmailDraft, type EmailThread, type MessageTemplate } from '@legarec/contracts';
import {
  Alerte,
  Badge,
  Bouton,
  Case,
  Champ,
  EditeurTexte,
  EtatListe,
  Icone,
  PageHeader,
  Pagination,
  SuggestionIA,
  Toolbar,
  useConfirm,
  useToast,
  type Tone,
} from '@legarec/ui';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import { soonAt } from '../../app/features';
import layout from '@legarec/ui/layout.module.css';
import { pageOf } from '../../shared/paging';
import { listState, matches } from '../../shared/listState';
import css from './Emails.module.css';
import { StaffMessageForm } from './StaffMessageForm';

const TONE: Record<EmailThread['category'], Tone> = {
  PAYMENT_PLAN: 'warning',
  DISPUTE: 'violet',
  PAYMENT: 'success',
  PROMISE: 'warning',
  BOUNCE: 'danger',
  OTHER: 'neutral',
};
const TODO: EmailThread['category'][] = ['PAYMENT_PLAN', 'DISPUTE', 'BOUNCE'];
type Filter = 'all' | 'unread' | 'todo' | 'portal';
const FILTERS: [Filter, string, (item: EmailThread) => boolean][] = [
  ['all', 'Tous', () => true],
  ['unread', 'Non lus', (item) => item.unread],
  ['todo', 'À traiter', (item) => TODO.includes(item.category)],
  ['portal', 'Espace débiteur', (item) => item.source === 'DEBTOR_PORTAL'],
];
const LABELS = ['PAYMENT', 'PAYMENT_PLAN', 'DISPUTE', 'BOUNCE'] as const;
const FOLDERS = [
  ['inbox', 'Boîte de réception'],
  ['sent', 'Envoyés'],
  ['drafts', 'Brouillons'],
  ['auto', 'Relances auto.'],
  ['archive', 'Archivés'],
] as const;

export function EmailsPage() {
  const scope = useCreditorScope();
  const { data, isPending, error, refetch } = useApi(mailboxData, '/emails');
  const change = useChange();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [folder, setFolder] = useState<(typeof FOLDERS)[number][0]>('inbox');
  const [label, setLabel] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const location = useLocation() as { pathname: string; state: { to?: string } | null };
  const navigate = useNavigate();
  const from = location.state;
  const [compose, setCompose] = useState(!!from?.to);
  const [initialTo, setInitialTo] = useState(from?.to ?? '');
  // The address only serves once: it must not survive in the browser history.
  useEffect(() => {
    if (from?.to) void navigate(location.pathname, { replace: true, state: null });
  }, [from?.to, location.pathname, navigate]);
  const [draft, setDraft] = useState<EmailDraft | undefined>();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const threads = data?.threads ?? [];
  const inbox = threads.filter((item) => !item.archived);
  const test = FILTERS.find(([id]) => id === filter)?.[2] ?? (() => true);
  const base =
    folder === 'archive'
      ? threads.filter((item) => item.archived)
      : folder === 'inbox'
        ? inbox
        : folder === 'sent'
          ? threads.filter((item) => item.replies.length > 0)
          : [];
  const rows = base.filter(
    (item) =>
      test(item) &&
      (label === 'all' || item.category === label) &&
      (scope.id === 'all' || item.creditorId === scope.id) &&
      matches(query, item.from, item.subject, item.debtor, item.reference, item.creditor),
  );
  const current = rows.find((item) => item.id === selected) ?? rows[0];
  const paged = pageOf(rows, page, size);
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Boîte vide',
    emptyText: 'Aucun e-mail dans ce dossier pour le moment.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const s = data?.stats;
  const counts = { inbox: data?.folders.inbox, drafts: data?.folders.drafts, auto: data?.folders.automatic, sent: undefined, archive: undefined };
  return (
    <>
      <PageHeader
        title="E-mails"
        loading={isPending}
        description="Boîte recouvrement@legarec.fr en réception seule · réponses depuis votre adresse professionnelle (OVH) · envois automatiques par Resend"
        status={data && { label: `Synchronisée il y a ${data.syncedMinutesAgo} min`, tone: 'success' }}
        statsLabel="Indicateurs e-mails"
        stats={[
          { label: 'Non lus', value: String(s?.unread ?? ''), sub: 'dans la boîte partagée' },
          { label: 'À traiter', value: String(s?.todo ?? ''), sub: 'échéancier, litige, rebond', tone: 'warning' },
          { label: 'Délai de réponse moyen', value: s?.delay ?? '', sub: 'sur 7 jours' },
          { label: 'Envoyés automatiquement', value: String(s?.automatic ?? ''), sub: 'cette semaine, via Resend' },
        ]}
        actions={[
          { label: 'Modèles', href: '/parametres/modeles' },
          {
            label: '+ Rédiger',
            primary: true,
            kbd: 'N',
            expanded: compose,
            onPress: () => {
              setDraft(undefined);
              setInitialTo('');
              setCompose(!compose);
            },
          },
        ]}
      />
      <Toolbar
        label="Filtrer les e-mails"
        placeholder="Débiteur, SIRET, objet…"
        query={query}
        onQuery={setQuery}
        tabs={FILTERS.map(([id, text, check]) => ({ label: text, count: inbox.filter(check).length, selected: id === filter, pick: () => setFilter(id) }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (rows[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
        filters={[
          {
            label: 'Étiquette',
            value: label,
            options: [
              { value: 'all', label: 'Toutes les étiquettes' },
              ...emailCategory.options.map((value) => ({ value, label: EMAIL_CATEGORIES[value].tag })),
            ],
            onChange: setLabel,
          },
        ]}
      />
      {compose && data && (
        <StaffMessageForm
          key={draft?.id ?? 'new'}
          sender={data.sender}
          templates={data.templates.filter((item) => item.use !== 'REPLY')}
          draft={draft}
          initialTo={initialTo}
          recipient={
            draft?.caseId && draft.recipient
              ? { email: draft.to, name: draft.recipient.name, reference: draft.recipient.reference, caseId: draft.caseId, isDebtor: true }
              : undefined
          }
          onClose={() => {
            setCompose(false);
            setDraft(undefined);
            setInitialTo('');
          }}
        />
      )}
      <div className={css.grid} data-wide={folder === 'drafts' || folder === 'auto' || undefined}>
        <nav aria-label="Dossiers de messagerie" className={css.folders}>
          {FOLDERS.map(([id, text]) => (
            <button key={id} type="button" className={css.folder} aria-current={id === folder} onClick={() => setFolder(id)}>
              {text}
              {counts[id] !== undefined && counts[id] !== 0 && <span className={layout.num}>{counts[id]}</span>}
            </button>
          ))}
          {(folder === 'inbox' || folder === 'sent' || folder === 'archive') && <span className={css.labels}>Étiquettes</span>}
          {(folder === 'inbox' || folder === 'sent' || folder === 'archive') &&
            LABELS.map((value) => (
              <button key={value} type="button" className={css.label} aria-pressed={label === value} onClick={() => setLabel(label === value ? 'all' : value)}>
                <span aria-hidden className={css.dot} style={{ background: `var(--${TONE[value]})` }} />
                {EMAIL_CATEGORIES[value].tag}
              </button>
            ))}
        </nav>
        {(folder === 'drafts' || folder === 'auto') && !data && <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />}
        {folder === 'drafts' && data && (
          <Drafts
            drafts={data.drafts.filter((item) => matches(query, item.to, item.subject, item.text, item.recipient?.name ?? ''))}
            searching={!!query.trim()}
            onClear={() => setQuery('')}
            onOpen={(item) => {
              setDraft(item);
              setCompose(true);
            }}
          />
        )}
        {folder === 'auto' && data && (
          <Automatic
            items={data.automatic.filter(
              (item) => (scope.id === 'all' || item.creditorId === scope.id) && matches(query, item.debtor, item.creditor, item.subject),
            )}
            searching={!!query.trim()}
            onClear={() => setQuery('')}
          />
        )}
        {folder !== 'drafts' && folder !== 'auto' && (
          <>
            <section aria-label="Liste des e-mails" className={layout.card}>
              <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
                <strong>{FOLDERS.find(([id]) => id === folder)?.[1]}</strong>
                <span className={layout.hint}>{rows.length} messages</span>
              </div>
              {state ? (
                <EtatListe {...state} />
              ) : (
                <div className={layout.scroll} tabIndex={0} role="group" aria-label="Messages">
                  {paged.shown.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={layout.rowButton}
                      aria-current={item.id === current?.id}
                      onClick={() => {
                        setSelected(item.id);
                        if (item.unread && item.canAct !== false) void change(`/emails/${item.id}/read`);
                      }}
                    >
                      <span className={`${layout.text} ${layout.grow}`}>
                        <span className={layout.between}>
                          <strong style={{ fontWeight: item.unread ? 700 : 500 }}>
                            {item.from}
                            {item.unread && <span className={layout.hidden}> (non lu)</span>}
                          </strong>
                          <span className={layout.hint}>{item.time}</span>
                        </span>
                        <span className={layout.ellipsis}>{item.subject}</span>
                        <span className={`${layout.muted} ${layout.ellipsis}`}>{item.body.replace(/\s+/g, ' ')}</span>
                        <span className={layout.inline}>
                          <Badge
                            label={EMAIL_CATEGORIES[item.category].tag}
                            tone={TONE[item.category]}
                            icon={item.ai ? 'sparkle' : undefined}
                            title={item.ai ? 'Catégorie proposée par l’IA' : undefined}
                          />
                          <Badge label={item.creditor} />
                          {item.source === 'DEBTOR_PORTAL' && <Badge label="Espace débiteur" tone="teal" />}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!state && data && (
                <Pagination
                  total={paged.total}
                  page={paged.current}
                  size={size}
                  unit="e-mails"
                  label="Pagination des e-mails"
                  onPage={setPage}
                  onSize={setSize}
                />
              )}
            </section>
            {current && data ? (
              <Reader key={current.id} mail={current} sender={data.sender} templates={data.templates.filter((item) => item.use !== 'NEW')} />
            ) : (
              <div className={layout.card}>
                <EtatListe kind="empty" compact title="Aucun message sélectionné" text="Choisissez un message pour le lire." />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

const AUTO_STATUS = { DELIVERED: ['Distribué', 'info'], OPENED: ['Ouvert', 'success'], FAILED: ['Rejeté', 'danger'] } as const;

interface ListSearch {
  searching: boolean;
  onClear: () => void;
}

function Drafts({ drafts, searching, onClear, onOpen }: ListSearch & { drafts: EmailDraft[]; onOpen: (item: EmailDraft) => void }) {
  const change = useChange();
  const toast = useToast();
  const remove = async (item: EmailDraft) => {
    try {
      await change(`/emails/drafts/${item.id}`, { method: 'DELETE' });
    } catch {
      toast({ message: 'Le brouillon n’a pas été supprimé. Réessayez.' });
      return;
    }
    toast({ message: 'Brouillon supprimé.', undo: () => void change('/emails/drafts', { body: item, schema: z.object({ id: z.string() }) }) });
  };
  return (
    <section aria-label="Brouillons">
      {drafts.length === 0 ? (
        searching ? (
          <EtatListe kind="noresult" onAction={onClear} />
        ) : (
          <EtatListe kind="empty" title="Aucun brouillon" text="Les messages enregistrés sans être envoyés apparaissent ici." />
        )
      ) : (
        <ul className={layout.list}>
          {drafts.map((item) => (
            <li key={item.id}>
              <span className={`${layout.text} ${layout.grow}`}>
                <span className={layout.strong}>{item.subject || '(sans objet)'}</span>
                <span className={layout.hint}>
                  {item.to || 'Sans destinataire'} · {item.updated}
                </span>
              </span>
              <Bouton variant="secondary" size="sm" label="Reprendre" ariaLabel={`Reprendre : ${item.subject || 'sans objet'}`} onPress={() => onOpen(item)} />
              <Bouton variant="ghost" size="sm" label="Supprimer" ariaLabel={`Supprimer : ${item.subject || 'sans objet'}`} onPress={() => void remove(item)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Automatic({ items, searching, onClear }: ListSearch & { items: z.infer<typeof mailboxData>['automatic'] }) {
  return (
    <section aria-label="Relances automatiques">
      {items.length === 0 ? (
        searching ? (
          <EtatListe kind="noresult" onAction={onClear} />
        ) : (
          <EtatListe kind="empty" title="Aucune relance automatique" text="Les envois des scénarios apparaissent ici." />
        )
      ) : (
        <ul className={layout.list}>
          {items.map((item) => (
            <li key={item.id}>
              <span className={`${layout.text} ${layout.grow}`}>
                <Link to={`/debiteurs/${item.caseId}`} className={layout.strong}>
                  {item.debtor}
                </Link>
                <span className={layout.hint}>
                  {item.subject} · {item.creditor} · {item.when}
                </span>
              </span>
              <Badge label={AUTO_STATUS[item.status][0]} tone={AUTO_STATUS[item.status][1]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reader({ mail, sender, templates }: { mail: EmailThread; sender: z.infer<typeof mailboxData>['sender']; templates: MessageTemplate[] }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [drafted, setDrafted] = useState(false);
  const [template, setTemplate] = useState('');
  const [statement, setStatement] = useState(false);
  const portal = mail.source === 'DEBTOR_PORTAL';
  const canAct = mail.canAct !== false;
  const quotaLeft = sender.hourlyQuota - sender.sentThisHour;
  const archive = async (archived: boolean) => {
    await change(`/emails/${mail.id}/archive`, { method: 'PUT', body: { archived } });
    toast({
      message: archived ? 'Message archivé.' : 'Message remis dans la boîte.',
      undo: () => void change(`/emails/${mail.id}/archive`, { method: 'PUT', body: { archived: !archived } }),
    });
  };
  const send = (text: string) =>
    confirm({
      title: portal ? 'Répondre dans l’espace débiteur ?' : `Envoyer cette réponse à ${mail.from} ?`,
      body: portal
        ? 'La réponse apparaît dans l’espace débiteur ; un e-mail l’avertit sans reprendre le contenu.'
        : 'Le message part de votre boîte OVH avec votre signature ; une copie est ajoutée à l’historique du dossier.',
      confirmLabel: 'Envoyer',
      details: [
        { k: 'Destinataire', v: portal ? `${mail.debtor} (espace débiteur)` : mail.email },
        ...(portal ? [] : [{ k: 'Expéditeur', v: `${sender.name} <${sender.address}>` }]),
        { k: 'Dossier', v: `${mail.debtor} · ${mail.reference}` },
        ...(statement ? [{ k: 'Pièce jointe', v: 'Relevé de compte' }] : []),
      ],
      onConfirm: async () => {
        await change(`/emails/${mail.id}/replies`, { body: { text, statement } });
        setReply('');
        setTemplate('');
        setStatement(false);
        setDrafted(false);
        toast({ message: 'Réponse envoyée.' });
      },
    });
  const recategorize = async (category: string) => {
    const before = mail.category;
    await change(`/emails/${mail.id}/category`, { method: 'PUT', body: { category } });
    toast({ message: 'Catégorie corrigée.', undo: () => void change(`/emails/${mail.id}/category`, { method: 'PUT', body: { category: before } }) });
  };
  return (
    <article aria-labelledby="mail-sujet" className={layout.card}>
      <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
        <span className={layout.inline}>
          <Bouton variant="secondary" size="sm" label="Transférer" soon />
          {canAct && <Bouton variant="secondary" size="sm" label={mail.archived ? 'Désarchiver' : 'Archiver'} onPress={() => void archive(!mail.archived)} />}
        </span>
        <Bouton
          variant="secondary"
          size="sm"
          label="Appeler l'expéditeur"
          icon="phone"
          href="/appels"
          disabled={mail.category === 'BOUNCE'}
          soon={mail.category === 'BOUNCE' ? undefined : soonAt('/appels')}
        />
      </div>
      <div className={layout.stack} style={{ padding: 'var(--sp-5)' }}>
        <div className={layout.text}>
          <h2 id="mail-sujet" style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>
            {mail.subject}
          </h2>
          <span>
            <strong>{mail.from}</strong> <span className={layout.muted}>{portal ? 'via l’espace débiteur' : `<${mail.email}>`}</span>
          </span>
          <span className={layout.hint}>
            {portal ? 'Espace débiteur' : 'À : recouvrement@legarec.fr'} · {mail.date}
          </span>
        </div>
        {portal && !mail.verified && (
          <Alerte tone="warning" compact text="Message envoyé sans code d’accès : « non vérifié ». Confirmez l’identité avant de répondre sur le dossier." />
        )}
        <div className={layout.notice} style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
          <span className={layout.between}>
            <span className={layout.text}>
              <span className={layout.hint}>Dossier lié</span>
              <Link to={`/debiteurs/${mail.caseId}`} className={layout.strong}>
                {mail.debtor} · {mail.reference}
              </Link>
              <span className={layout.hint}>Créancier : {mail.creditor}</span>
            </span>
            <span className={layout.text}>
              <span className={layout.hint}>Montant dû</span>
              <strong className={layout.num}>{formatCents(mail.due)}</strong>
            </span>
            <Badge label={EMAIL_CATEGORIES[mail.category].tag} tone={TONE[mail.category]} />
          </span>
        </div>
        <div style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{mail.body}</div>
        {mail.attachment && (
          <span className={layout.inline}>
            <Icone icon="file" />
            <span className={layout.text}>
              <strong>{mail.attachment}</strong>
              <span className={layout.hint}>PDF · 84 Ko</span>
            </span>
          </span>
        )}
        {mail.ai && (
          <SuggestionIA
            title="Analyse IA"
            facts={mail.ai.facts}
            note="Proposé par l’IA d’après le message et le dossier, à vérifier."
            headerExtra={
              <Champ
                label="Catégorie"
                hideLabel
                type="select"
                value={mail.category}
                options={emailCategory.options.map((value) => ({ value, label: EMAIL_CATEGORIES[value].label }))}
                disabled={!canAct}
                onChange={(value) => void recategorize(value)}
                layout={{ marginLeft: 'auto' }}
              />
            }
          >
            <p className={layout.body}>{mail.ai.summary}</p>
            <div className={layout.chips}>
              <span className={layout.hint}>Actions proposées</span>
              {mail.ai.actions.map((action) =>
                canAct && /échéancier/i.test(action) ? (
                  <Bouton key={action} variant="secondary" size="sm" label={action} href={`/echeanciers?dossier=${mail.caseId}`} />
                ) : canAct ? (
                  <Bouton key={action} variant="secondary" size="sm" label={action} href={`/debiteurs/${mail.caseId}`} />
                ) : (
                  <Badge key={action} label={action} tone="marine" size="md" />
                ),
              )}
            </div>
            {mail.recategorized && (
              <span role="status" className={layout.hint}>
                Catégorie corrigée : la correction est enregistrée et améliore le tri.
              </span>
            )}
          </SuggestionIA>
        )}
        {mail.replies.map((item) => (
          <Alerte
            key={item.id}
            tone={item.status === 'SENT' ? 'neutral' : 'danger'}
            title={item.status === 'SENT' ? `Votre réponse · ${item.when}` : 'Échec de l’envoi par OVH'}
            text={item.status === 'SENT' ? item.text : `${item.text} — Le message n’est pas parti ; il n’est pas envoyé par un autre service.`}
            actionLabel={item.status === 'FAILED' && canAct ? 'Nouvelle tentative' : undefined}
            onAction={() => send(item.text)}
          />
        ))}
        {!canAct && <Alerte tone="info" compact icon="lock" text="Lecture seule : ce dossier est suivi par un autre collaborateur." />}
        {canAct && mail.category !== 'BOUNCE' && (
          <div className={layout.stack}>
            <div className={layout.between}>
              <span className={layout.muted}>
                Répondre à {mail.from}
                {!portal && (
                  <>
                    {' '}
                    · de <strong>{sender.address}</strong>
                  </>
                )}
              </span>
              {mail.ai && (
                <Bouton
                  variant="secondary"
                  size="sm"
                  icon="sparkle"
                  label={mail.ai.draft ? (drafted ? 'Brouillon IA inséré' : 'Brouillon IA') : 'Brouillon IA indisponible'}
                  disabled={!mail.ai.draft || drafted}
                  onPress={() => {
                    setReply(mail.ai?.draft ?? '');
                    setDrafted(true);
                    setTemplate('');
                  }}
                />
              )}
            </div>
            <Champ
              label="Modèle"
              type="select"
              value={template}
              options={[{ value: '', label: 'Aucun (message libre)' }, ...templates.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={(id) => {
                const before = reply;
                setTemplate(id);
                const next = templates.find((item) => item.id === id);
                if (!next) return;
                const wasDrafted = drafted;
                setReply(next.text);
                // The text no longer comes from the AI.
                setDrafted(false);
                if (before.trim())
                  toast({
                    message: `Modèle « ${next.name} » inséré.`,
                    undo: () => {
                      setReply(before);
                      setDrafted(wasDrafted);
                      setTemplate('');
                    },
                  });
              }}
            />
            {portal ? (
              // The portal of payment shows a plain text: no marks there.
              <Champ label="Votre réponse" type="textarea" rows={6} value={reply} onChange={setReply} />
            ) : (
              <EditeurTexte label="Votre réponse" value={reply} onChange={setReply} />
            )}
            {drafted && (
              <span role="status" className={layout.muted}>
                Brouillon proposé par l’IA : relisez et complétez avant d’envoyer. Les mentions obligatoires sont ajoutées par le modèle.
              </span>
            )}
            {!portal && quotaLeft <= 0 && (
              <Alerte
                tone="danger"
                compact
                text={`Quota OVH atteint pour ${sender.address} (${sender.hourlyQuota} e-mails par heure). Réessayez dans l’heure ; le message est conservé.`}
              />
            )}
            <div className={layout.between}>
              <Case label="Joindre le relevé de compte" checked={statement} onToggle={setStatement} />
              <Bouton label="Envoyer" icon="send" disabled={!reply.trim() || (!portal && quotaLeft <= 0)} onPress={() => send(reply)} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
