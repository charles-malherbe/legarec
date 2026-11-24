import { formatCents, measureSms, smsData, type SmsThread } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Case, Champ, EtatListe, PageHeader, Pagination, Toolbar, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { listState, matches } from '../../shared/listState';
import { CaseLink } from './CaseLink';

// Straight apostrophes and no « ê » or « ç »: the message keeps 160 characters per SMS.
const QUICK = [
  ['RIB / espace de paiement', 'Bonjour, voici le lien de votre espace : RIB, consignes et messages. Merci.'],
  ['Confirmer une promesse', 'Merci, nous notons votre règlement prévu le [DATE]. Bonne journée.'],
  ['Proposer un échéancier', 'Nous pouvons vous proposer un paiement en plusieurs fois. Souhaitez-vous un rappel ?'],
  ['Demander un rappel', 'Pouvez-vous nous rappeler au 01 87 88 02 98 (lun-ven 9h-19h) ? Merci.'],
] as const;
const STATUS: Record<NonNullable<SmsThread['status']>, [string, Tone]> = {
  OVERDUE: ['En retard', 'danger'],
  PROMISE: ['Promesse', 'warning'],
  REMINDER: ['En relance', 'info'],
  SETTLED: ['Réglé', 'success'],
};
type Filter = 'all' | 'unread' | 'todo' | 'unlinked';
const FILTERS: [Filter, string, (item: SmsThread) => boolean][] = [
  ['all', 'Toutes', (item) => item.linked],
  ['unread', 'Non lues', (item) => item.linked && item.unread > 0],
  ['todo', 'À traiter', (item) => item.linked && item.status !== 'SETTLED' && (item.unread > 0 || item.messages.some((message) => message.failed))],
  ['unlinked', 'Non rattachés', (item) => !item.linked],
];

export function SmsPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(smsData, '/sms');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [withLink, setWithLink] = useState(true);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const threads = data?.threads ?? [];
  const test = FILTERS.find(([id]) => id === filter)?.[2] ?? (() => true);
  const rows = threads.filter(
    (item) =>
      test(item) && (scope.id === 'all' || !item.linked || item.creditorId === scope.id) && matches(query, item.name, item.contact, item.phone, item.creditor),
  );
  const current = rows.find((item) => item.id === selected) ?? rows[0];
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucune conversation',
    emptyText: 'Les réponses des débiteurs aux SMS de relance apparaissent ici.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const full = draft.trim() ? `${draft.trim()}${withLink ? ' [LIEN ESPACE DEBITEUR]' : ''} ${data?.stopNotice ?? ''}` : '';
  const size_ = measureSms(full);
  const pick = (item: SmsThread) => {
    setSelected(item.id);
    setDraft('');
    if (item.unread > 0) void change(`/sms/${item.id}/read`);
  };
  const send = (item: SmsThread) =>
    confirm({
      tone: item.stopped ? 'danger' : 'primary',
      title: `Envoyer ce SMS à ${item.contact} ?`,
      body: item.stopped
        ? 'Ce numéro a répondu STOP : seul un message indispensable doit être envoyé. Le gestionnaire est prévenu.'
        : 'Le SMS part immédiatement et est ajouté à l’historique du dossier.',
      confirmLabel: 'Envoyer le SMS',
      details: [
        { k: 'Débiteur', v: item.name },
        { k: 'Numéro', v: item.phone },
        { k: 'Message', v: full },
        { k: 'Facturation', v: `${size_.segments} SMS · ${size_.length} caractères` },
      ],
      onConfirm: async () => {
        await change(`/sms/${item.id}/messages`, { body: { text: full } });
        setDraft('');
        toast({ message: 'SMS envoyé.' });
      },
    });
  const s = data?.stats;
  return (
    <>
      <PageHeader
        title="SMS"
        loading={isPending}
        description="Conversations avec les débiteurs · réponses reçues dans l’application · réponse STOP gérée automatiquement"
        statsLabel="Indicateurs SMS"
        stats={[
          { label: 'Envoyés en novembre', value: s ? s.sent.toLocaleString('fr-FR') : '', sub: 'dont 1 196 automatiques' },
          { label: 'Taux de réponse', value: s ? `${s.answers} %` : '', sub: '▲ 3 pts', tone: 'success' },
          { label: 'Distribués', value: s ? `${s.delivered.toLocaleString('fr-FR')} %` : '', sub: 'sur 30 jours' },
          { label: 'Désinscriptions (STOP)', value: String(s?.stops ?? ''), sub: 'numéros ce mois' },
        ]}
        actions={[
          { label: 'Modèles de SMS', href: '/parametres/modeles/sms' },
          { label: 'Envoi groupé', href: '/documents/rediger' },
        ]}
      />
      <Toolbar
        label="Filtrer les conversations"
        placeholder="Débiteur, SIRET, numéro…"
        query={query}
        onQuery={setQuery}
        tabs={FILTERS.map(([id, label, check]) => ({
          label,
          count: threads.filter(check).length,
          selected: id === filter,
          pick: () => {
            setFilter(id);
            setSelected(null);
          },
        }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (rows[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
      />
      <div className={layout.split}>
        <section aria-label="Conversations" className={layout.card}>
          <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <strong>Conversations</strong>
            <span className={layout.hint}>{rows.length} affichées</span>
          </div>
          {state ? (
            <EtatListe {...state} />
          ) : (
            <div className={layout.scroll} tabIndex={0} role="group" aria-label="Liste des conversations">
              {rows.map((item) => {
                const last = item.messages.at(-1);
                return (
                  <button key={item.id} type="button" className={layout.rowButton} aria-current={item.id === current?.id} onClick={() => pick(item)}>
                    <span className={`${layout.text} ${layout.grow}`}>
                      <span className={layout.between}>
                        <strong>{item.name}</strong>
                        <span className={layout.hint}>{item.time}</span>
                      </span>
                      <span className={layout.hint}>{item.creditor}</span>
                      <span className={`${layout.muted} ${layout.ellipsis}`}>
                        {last?.direction === 'OUT' && 'Vous : '}
                        {last?.text}
                      </span>
                    </span>
                    {item.unread > 0 && <Badge label={String(item.unread)} tone="or" title={`${item.unread} non lus`} />}
                  </button>
                );
              })}
            </div>
          )}
          {!state && data && (
            <Pagination
              total={filter === 'all' && !query ? data.total : rows.length}
              page={page}
              size={size}
              unit="conversations"
              label="Pagination des conversations"
              onPage={setPage}
              onSize={setSize}
            />
          )}
        </section>
        {current && (
          <div className={layout.columns}>
            <section aria-label="Conversation" className={`${layout.card} ${layout.wide}`} style={{ gap: 0 }}>
              <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
                <span className={layout.text}>
                  <strong>{current.name}</strong>
                  <span className={layout.hint}>
                    {current.contact} · {current.phone}
                  </span>
                </span>
                <span className={layout.inline}>
                  <Bouton variant="secondary" size="sm" label="Appeler" icon="phone" href="/appels" />
                  {current.caseId && <Bouton variant="secondary" size="sm" label="Ouvrir le dossier" href={`/debiteurs/${current.caseId}`} />}
                </span>
              </div>
              {current.stopped && (
                <Alerte tone="warning" compact text="Ce numéro a répondu STOP : les SMS automatiques sont arrêtés et le gestionnaire du dossier est prévenu." />
              )}
              <ol className={layout.thread}>
                {current.messages.map((message) => (
                  <li key={message.id} data-out={message.direction === 'OUT' || undefined}>
                    {message.automatic && <span className={layout.hint}>{message.automatic}</span>}
                    <div>{message.text}</div>
                    <span className={message.failed ? layout.danger : layout.hint}>{message.meta}</span>
                  </li>
                ))}
              </ol>
              {current.linked ? (
                <div className={layout.stack} style={{ padding: 'var(--sp-4) var(--sp-5)', borderTop: '1px solid var(--border)' }}>
                  <div className={layout.chips}>
                    <span className={layout.muted}>Réponses rapides :</span>
                    {QUICK.map(([label, text]) => (
                      <button key={label} type="button" className={layout.chip} onClick={() => setDraft(text)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <Champ label="Votre SMS" type="textarea" rows={3} value={draft} placeholder={`Écrire un SMS à ${current.contact}…`} onChange={setDraft} />
                  <Case label="Ajouter le lien de l’espace débiteur" checked={withLink} onToggle={setWithLink} />
                  <div className={layout.between}>
                    <span className={layout.text} aria-live="polite">
                      <span className={size_.segments > 1 ? layout.danger : layout.hint}>
                        {size_.length} caractères · {size_.segments} SMS facturé{size_.segments > 1 ? 's' : ''} · limite {size_.limit}
                      </span>
                      {size_.unicode && (
                        <span className={layout.danger}>{`Les caractères ${size_.unicodeChars.join(' ')} font passer le SMS de 160 à 70 caractères.`}</span>
                      )}
                      <span className={layout.hint}>Mention « STOP » ajoutée automatiquement</span>
                    </span>
                    <span className={layout.inline}>
                      <Bouton variant="secondary" label="Programmer" disabled />
                      <Bouton label="Envoyer" icon="send" disabled={!draft.trim()} onPress={() => send(current)} />
                    </span>
                  </div>
                </div>
              ) : (
                <CaseLink
                  thread={current}
                  onLinked={() => {
                    setFilter('all');
                    setSelected(current.id);
                  }}
                />
              )}
            </section>
            {current.linked && (
              <aside className={layout.aside} aria-label="Contexte du dossier">
                <Carte title="Dossier">
                  <div className={layout.stack}>
                    <div className={layout.text}>
                      <Link to={`/debiteurs/${current.caseId}`} className={layout.strong}>
                        {current.name}
                      </Link>
                      <span className={layout.muted}>Pour le compte de {current.creditor}</span>
                    </div>
                    <dl className={layout.facts}>
                      <div>
                        <dt>Montant dû</dt>
                        <dd>{current.due === null ? '—' : formatCents(current.due)}</dd>
                      </div>
                      <div>
                        <dt>Retard</dt>
                        <dd>{current.late}</dd>
                      </div>
                      <div>
                        <dt>Statut</dt>
                        <dd>{current.status && <Badge label={STATUS[current.status][0]} tone={STATUS[current.status][1]} />}</dd>
                      </div>
                      <div>
                        <dt>Consentement SMS</dt>
                        <dd>{current.stopped ? 'Retiré (STOP)' : 'Actif'}</dd>
                      </div>
                    </dl>
                  </div>
                </Carte>
                <Carte title="Actions">
                  <div className={layout.tightStack}>
                    <Link to="/echeanciers" className={layout.link}>
                      Enregistrer une promesse
                    </Link>
                    <Link to="/echeanciers" className={layout.link}>
                      Proposer un échéancier
                    </Link>
                    <Link to="/relances" className={layout.link}>
                      Planifier un rappel
                    </Link>
                  </div>
                </Carte>
                <Carte title="Prochain SMS automatique">
                  <p className={layout.body}>{current.next}</p>
                </Carte>
              </aside>
            )}
          </div>
        )}
      </div>
    </>
  );
}
