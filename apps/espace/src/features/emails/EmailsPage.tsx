import { EMAIL_CATEGORIES, emailCategory, formatCents, mailboxData, type EmailThread } from '@legarec/contracts';
import {
  Alerte,
  Badge,
  Bouton,
  Champ,
  EtatListe,
  Icone,
  Onglets,
  PageHeader,
  Pagination,
  SuggestionIA,
  Toolbar,
  useConfirm,
  useToast,
  type Tone,
} from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { listState, matches } from '../../shared/listState';
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
  const [compose, setCompose] = useState(false);
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
          { label: 'Modèles', href: '/parametres' },
          { label: '+ Rédiger', primary: true, kbd: 'N', expanded: compose, onPress: () => setCompose(!compose) },
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
      {compose && data && <StaffMessageForm sender={data.sender} onClose={() => setCompose(false)} />}
      <Onglets
        label="Dossiers de messagerie"
        items={FOLDERS.map(([id, text]) => ({ label: text, count: counts[id], selected: id === folder, pick: () => setFolder(id) }))}
        layout={{ alignSelf: 'flex-start' }}
      />
      <div className={layout.split}>
        <section aria-label="Liste des e-mails" className={layout.card}>
          <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <strong>{FOLDERS.find(([id]) => id === folder)?.[1]}</strong>
            <span className={layout.hint}>{rows.length} messages</span>
          </div>
          {state ? (
            <EtatListe {...state} />
          ) : (
            <div className={layout.scroll} tabIndex={0} role="group" aria-label="Messages">
              {rows.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={layout.rowButton}
                  aria-current={item.id === current?.id}
                  onClick={() => {
                    setSelected(item.id);
                    if (item.unread) void change(`/emails/${item.id}/read`);
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
              total={folder === 'inbox' && filter === 'all' && !query ? data.total : rows.length}
              page={page}
              size={size}
              unit="e-mails"
              label="Pagination des e-mails"
              onPage={setPage}
              onSize={setSize}
            />
          )}
        </section>
        {current && data && <Reader key={current.id} mail={current} sender={data.sender} />}
      </div>
    </>
  );
}

function Reader({ mail, sender }: { mail: EmailThread; sender: z.infer<typeof mailboxData>['sender'] }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const [drafted, setDrafted] = useState(false);
  const portal = mail.source === 'DEBTOR_PORTAL';
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
      ],
      onConfirm: async () => {
        await change(`/emails/${mail.id}/replies`, { body: { text } });
        setReply('');
        setDrafted(false);
        toast({ message: 'Réponse envoyée.' });
      },
    });
  const recategorize = (category: string) => void change(`/emails/${mail.id}/category`, { method: 'PUT', body: { category } });
  return (
    <article aria-labelledby="mail-sujet" className={layout.card}>
      <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
        <span className={layout.inline}>
          <Bouton variant="secondary" size="sm" label="Transférer" disabled />
          <Bouton variant="secondary" size="sm" label={mail.archived ? 'Désarchiver' : 'Archiver'} onPress={() => void archive(!mail.archived)} />
        </span>
        <Bouton variant="secondary" size="sm" label="Appeler l'expéditeur" icon="phone" href="/appels" disabled={mail.category === 'BOUNCE'} />
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
                onChange={recategorize}
                layout={{ marginLeft: 'auto' }}
              />
            }
          >
            <p className={layout.body}>{mail.ai.summary}</p>
            <div className={layout.chips}>
              <span className={layout.hint}>Actions proposées</span>
              {mail.ai.actions.map((action) => (
                <Badge key={action} label={action} tone="marine" size="md" />
              ))}
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
            actionLabel={item.status === 'FAILED' ? 'Nouvelle tentative' : undefined}
            onAction={() => send(item.text)}
          />
        ))}
        {mail.category !== 'BOUNCE' && (
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
                  }}
                />
              )}
            </div>
            <Champ label="Votre réponse" type="textarea" rows={6} value={reply} onChange={setReply} />
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
            <div className={layout.end}>
              <Bouton label="Envoyer" icon="send" disabled={!reply.trim() || (!portal && quotaLeft <= 0)} onPress={() => send(reply)} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
