import { callsData, formatCents, formatPhone, type CallTarget } from '@legarec/contracts';
import { openExternal, startCall } from '@legarec/platform';
import { Alerte, Badge, Bouton, EtatListe, Icone, isShortcutBlocked, Onglets, PageHeader, Progression, Toolbar, useToast } from '@legarec/ui';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';
import { listState, matches } from '../../shared/listState';
import { acwText, callReducer, clock, idle } from './callMachine';
import css from './Calls.module.css';
import { QualificationPanel, type QualificationHandle } from './QualificationPanel';

type Data = z.infer<typeof callsData>;
const KIND = {
  CALL: { label: 'Appel', tone: 'neutral' },
  CALLBACK: { label: 'Rappel', tone: 'warning' },
  MISSED: { label: 'Manqué', tone: 'danger' },
} as const;
const PRIORITY = { HIGH: 'Haute', MEDIUM: 'Moyenne', NORMAL: 'Normale' } as const;
const TABS = [
  ['all', 'Tous', () => true],
  ['callback', 'Rappels', (item: CallTarget) => item.kind === 'CALLBACK'],
  ['missed', 'Manqués', (item: CallTarget) => item.kind === 'MISSED'],
  ['high', 'Priorité haute', (item: CallTarget) => item.priority === 'HIGH'],
] as const;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function CallsPage() {
  const { data, isPending, error, refetch } = useApi(callsData, '/calls');
  if (isPending)
    return (
      <>
        <PageHeader title="Appels" description=" " />
        <div className={layout.card}>
          <EtatListe kind="loading" />
        </div>
      </>
    );
  if (error || !data)
    return (
      <>
        <PageHeader title="Appels" />
        <div className={layout.card}>
          <EtatListe kind="error" onAction={() => void refetch()} />
        </div>
      </>
    );
  if (data.targets.length === 0)
    return (
      <>
        <PageHeader title="Appels" />
        <div className={layout.card}>
          <EtatListe
            kind="empty"
            title="File d’appels terminée"
            text="Plus aucun appel prévu dans ce filtre. Les rappels du jour s’ajouteront automatiquement."
          />
        </div>
      </>
    );
  return <Workspace data={data} onRetry={() => void refetch()} />;
}

function Workspace({ data, onRetry }: { data: Data; onRetry: () => void }) {
  const scope = useCreditorScope();
  const toast = useToast();
  const change = useChange();
  const [state, dispatch] = useReducer(callReducer, data, (initial) => {
    const index = Math.max(
      0,
      initial.targets.findIndex((item) => item.caseId === initial.active?.caseId),
    );
    return initial.active ? { ...idle(index), inCall: true, secs: initial.active.seconds, announced: initial.active.announced } : idle(index);
  });
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all');
  const [tool, setTool] = useState<'script' | 'history' | 'keypad'>('script');
  const [collapsed, setCollapsed] = useState(() => window.innerWidth >= 1024 && window.innerWidth < 1440);
  const [transferOpen, setTransferOpen] = useState(false);
  const [mode, setMode] = useState<'announced' | 'direct'>('announced');
  const [failure, setFailure] = useState<'busy' | 'noanswer' | 'invalid' | null>(null);
  const [dialed, setDialed] = useState('');
  const panel = useRef<QualificationHandle>(null);
  const current = data.targets[state.index] ?? data.targets[0]!;
  const down = data.tcx === 'DOWN';
  const nextIndex = (state.index + 1) % data.targets.length;
  const phone =
    current.coordinates.find((item) => item.kind === 'PHONE' && item.primary && item.status !== 'INVALID') ??
    current.coordinates.find((item) => item.kind === 'PHONE' && item.status !== 'INVALID');
  const test = TABS.find(([id]) => id === tab)?.[2] ?? (() => true);
  const rows = data.targets
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        test(item) &&
        (scope.id === 'all' || item.creditorId === scope.id) &&
        matches(query, item.debtor, item.siret, item.creditor, ...item.coordinates.map((entry) => entry.value)),
    );
  const queueState = listState({
    pending: false,
    error: null,
    count: rows.length,
    query,
    empty: 'File d’appels terminée',
    emptyText: 'Plus aucun appel prévu dans ce filtre. Les rappels du jour s’ajouteront automatiquement.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry,
    onClear: () => setQuery(''),
  });

  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, []);
  const dial = useCallback(
    (value: string) => {
      if (down) return;
      startCall(value);
      dispatch({ type: 'dial' });
    },
    [down],
  );
  const toggleCall = useCallback(() => {
    if (state.inCall) void change(`/calls/${current.caseId}/hangup`);
    else if (!down && phone) startCall(phone.value);
    if (state.inCall || !down) dispatch({ type: 'toggleCall' });
  }, [change, current.caseId, down, phone, state.inCall]);
  const onSaved = (label: string) => {
    const before = state;
    dispatch({ type: 'saved', next: nextIndex });
    toast({
      message: `Fiche enregistrée pour ${current.debtor} : ${label.toLowerCase()}.`,
      undo: () => {
        void change(`/calls/${current.caseId}/qualification`, { method: 'DELETE' });
        dispatch({ type: 'restore', state: before });
      },
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        panel.current?.save();
        return;
      }
      if (isShortcutBlocked(event)) return;
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit && tool !== 'keypad') {
        event.preventDefault();
        panel.current?.pick(Number(digit[1]) - 1);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'm') dispatch({ type: 'mute' });
      else if (key === 'a') dispatch({ type: 'hold' });
      else if (key === 't') setTransferOpen((open) => !open);
      else if (key === 'h') toggleCall();
      else return;
      event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tool, toggleCall]);

  const status = down
    ? { label: '3CX injoignable · mode manuel', tone: 'danger' as const }
    : state.inCall
      ? {
          label: state.hold ? '3CX · appel en attente' : `3CX · en communication · poste ${data.extension ?? '—'}`,
          tone: state.hold ? ('warning' as const) : ('success' as const),
        }
      : {
          label: state.secs > 0 ? `3CX · post-appel · poste ${data.extension ?? '—'}` : `3CX connecté · poste ${data.extension ?? '—'}`,
          tone: 'success' as const,
        };
  const FAIL = {
    busy: ['occupée', 'Le débiteur est déjà en ligne. 3CX propose un nouvel essai dans 15 minutes.', 6, 'Qualifier : pas de réponse'],
    noanswer: ['pas de réponse', 'Aucune réponse après 30 secondes, pas de messagerie détectée.', 6, 'Qualifier : pas de réponse'],
    invalid: ['numéro invalide', 'L’opérateur indique que ce numéro n’est pas attribué.', 7, 'Qualifier : mauvais numéro'],
  } as const;
  const failed = failure && FAIL[failure];
  useEffect(() => {
    const listener = (event: Event) => setFailure((event as CustomEvent<typeof failure>).detail);
    window.addEventListener('legarec:call-failed', listener);
    return () => window.removeEventListener('legarec:call-failed', listener);
  }, []);
  const s = data.stats;

  return (
    <>
      <PageHeader
        title="Appels"
        description={`Campagne « ${data.campaign} » · téléphonie 3CX · ligne ${data.line}${data.extension ? ` · votre poste ${data.extension}` : ''}`}
        status={status}
        statsLabel="Ma session d'appels"
        stats={
          state.inCall
            ? []
            : [
                {
                  label: 'Objectif du jour',
                  value: `${s.calls} / ${s.target} appels`,
                  bar: (s.calls / s.target) * 100,
                  barTone: 'marine',
                  sub: `${s.target - s.calls} restants avant 18:00`,
                },
                { label: 'Débiteurs joints', value: String(s.reached), sub: `${Math.round((s.reached / s.calls) * 100)} % des appels passés` },
                { label: 'Promesses obtenues', value: s.promises, sub: '2 à contrôler cette semaine', tone: 'success' },
                { label: 'Durée moyenne', value: s.duration, sub: 'Équipe : 4 min 05' },
                { label: 'Coordonnées corrigées', value: String(s.corrected), sub: 'aujourd’hui, dont 1 e-mail' },
              ]
        }
        actions={[
          { label: 'Changer de campagne', disabled: true },
          { label: 'Ouvrir 3CX', onPress: () => openExternal('https://legarec.on3cx.fr') },
          { label: 'Appel suivant', primary: true, kbd: 'N', onPress: () => panel.current?.save() },
        ]}
      />
      <Toolbar
        label="Filtrer la file d'appels"
        tabsLabel="File d'appels"
        placeholder="Débiteur, SIRET, numéro…"
        digitKeys={false}
        query={query}
        onQuery={setQuery}
        tabs={TABS.map(([id, label, check]) => ({ label, count: data.targets.filter(check).length, selected: id === tab, pick: () => setTab(id) }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (rows[0]?.item.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
      />
      <div className={css.workspace} data-collapsed={collapsed || undefined}>
        {collapsed ? (
          <button
            type="button"
            className={css.rail}
            aria-expanded={false}
            aria-label={`${rows.length} Afficher la file d'appels`}
            onClick={() => setCollapsed(false)}
          >
            <Icone icon="chevron-right" size={16} />
            <strong>{rows.length}</strong>
          </button>
        ) : (
          <section aria-labelledby="file-titre" className={layout.card}>
            <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: '1px solid var(--border)' }}>
              <h2 id="file-titre" className={css.h2}>
                File d&apos;appels
              </h2>
              <span className={layout.inline}>
                <Badge label={`${rows.length} affichés`} tone="marine" />
                <Bouton label="Réduire la file d'appels" icon="chevron-left" iconOnly variant="ghost" size="xs" onPress={() => setCollapsed(true)} />
              </span>
            </div>
            {queueState ? (
              <EtatListe {...queueState} compact />
            ) : (
              rows.map(({ item, index }) => (
                <button
                  key={item.caseId}
                  type="button"
                  className={layout.rowButton}
                  aria-current={index === state.index}
                  onClick={() => dispatch({ type: 'pick', index })}
                >
                  <span className={`${layout.text} ${layout.grow}`}>
                    <span className={layout.between}>
                      <strong>{item.debtor}</strong>
                      <strong className={layout.num}>{formatCents(item.amount)}</strong>
                    </span>
                    <span className={layout.hint}>SIRET {item.siret}</span>
                    <span className={layout.link}>{item.creditor}</span>
                    <span className={layout.muted}>{item.reason}</span>
                    <span className={layout.between}>
                      <span className={layout.inline}>
                        <Badge label={KIND[item.kind].label} tone={KIND[item.kind].tone} />
                        <span className={layout.hint}>{item.slot}</span>
                      </span>
                      <span className={item.priority === 'HIGH' ? layout.danger : layout.hint}>{PRIORITY[item.priority]}</span>
                    </span>
                    {item.doneOutcome && <span className={layout.success}>✓ Qualifié</span>}
                  </span>
                </button>
              ))
            )}
          </section>
        )}
        <div className={css.middle}>
          <section data-dark aria-label="Appel en cours" className={css.call}>
            {state.preview > 0 && (
              <div role="status" className={css.box}>
                <strong>Composition prévisualisée · 3CX</strong>
                <span>
                  {current.debtor} · composition dans {state.preview} s{state.previewPaused && ' (en pause)'}
                </span>
                <Progression value={((5 - state.preview) / 5) * 100} label="Temps avant la composition" />
                <span className={layout.inline}>
                  <Bouton label="Appeler maintenant" icon="phone" variant="success" size="sm" onPress={() => dispatch({ type: 'previewNow' })} />
                  <Bouton label="Passer ce débiteur" variant="dark" size="sm" onPress={() => dispatch({ type: 'previewSkip', next: nextIndex })} />
                  <Bouton
                    label={state.previewPaused ? 'Reprendre' : 'Mettre en pause'}
                    icon="pause"
                    variant="dark"
                    size="sm"
                    onPress={() => dispatch({ type: 'previewPause' })}
                  />
                </span>
              </div>
            )}
            <div className={css.identity}>
              <span aria-hidden className={css.avatar}>
                {current.debtor.slice(0, 2).toUpperCase()}
              </span>
              <span className={layout.text}>
                <strong className={css.name}>{current.debtor}</strong>
                <span>
                  {current.contact} · {phone ? formatPhone(phone.value) : 'aucun numéro valide'}
                </span>
                <span className={css.soft}>
                  Pour le compte de {current.creditor} · SIRET {current.siret}
                </span>
                <span className={css.muted}>
                  Via 3CX · poste {data.extension ?? '—'} · présentation {data.line}
                </span>
              </span>
            </div>
            <div className={layout.inline}>
              <span role="status">
                <Badge
                  label={state.inCall ? (state.hold ? 'En attente' : 'En communication') : state.secs > 0 ? 'Post-appel' : 'Prêt à appeler'}
                  tone={state.inCall ? (state.hold ? 'warning' : 'success') : 'neutral'}
                  size="md"
                />
              </span>
              <span className={css.timer} role="timer">
                {clock(state.inCall ? state.secs : 0)}
              </span>
            </div>
            <dl className={css.facts}>
              <div>
                <dt>Montant dû</dt>
                <dd>{formatCents(current.amount)}</dd>
              </div>
              <div>
                <dt>Retard max.</dt>
                <dd>{current.daysLate} j</dd>
              </div>
              <div>
                <dt>Dossier</dt>
                <dd>
                  <Link to={`/debiteurs/${current.caseId}`}>{current.reference}</Link>
                </dd>
              </div>
            </dl>
            {down && (
              <Alerte
                tone="danger"
                title="3CX injoignable"
                text={`Le poste ${data.extension ?? ''} n’est plus enregistré. Les appels sont désactivés : appelez depuis le téléphone fixe et qualifiez la fiche normalement (mode manuel).`}
                actionLabel="Réessayer la connexion"
                onAction={onRetry}
              />
            )}
            {failed && (
              <Alerte
                tone="warning"
                title={`Appel non abouti : ${failed[0]}`}
                text={failed[1]}
                actionLabel={failed[3]}
                onAction={() => {
                  panel.current?.pick(failed[2]);
                  setFailure(null);
                }}
              />
            )}
            {state.inCall && state.hold && !state.transfer?.pending && (
              <div role="status" className={css.box}>
                <strong>Débiteur en attente · {clock(state.holdSecs)}</strong>
                <span>Musique d’attente 3CX · au-delà de 1 min, reprenez ou prévenez le débiteur</span>
                <Bouton label="Reprendre l’appel" icon="play" variant="success" kbd="A" onPress={() => dispatch({ type: 'hold' })} />
              </div>
            )}
            <div className={layout.inline}>
              <Bouton
                variant="dark"
                size="lg"
                icon="mic-off"
                label={state.muted ? 'Micro coupé' : 'Muet'}
                title="Raccourci : M"
                pressed={state.muted}
                disabled={!state.inCall}
                onPress={() => dispatch({ type: 'mute' })}
              />
              <Bouton
                variant="dark"
                size="lg"
                icon="pause"
                label={state.hold ? 'Reprendre' : 'Attente'}
                title="Raccourci : A"
                pressed={state.hold}
                disabled={!state.inCall}
                onPress={() => dispatch({ type: 'hold' })}
              />
              <Bouton
                variant="dark"
                size="lg"
                icon="transfer"
                label="Transférer"
                title="Raccourci : T"
                expanded={transferOpen}
                disabled={!state.inCall}
                onPress={() => setTransferOpen(!transferOpen)}
              />
              <Bouton
                variant={state.inCall ? 'danger' : 'success'}
                size="lg"
                icon={state.inCall ? 'phone-off' : 'phone'}
                label={state.inCall ? 'Raccrocher' : 'Appeler'}
                title="Raccourci : H"
                disabled={!state.inCall && (down || !phone)}
                onPress={toggleCall}
                layout={{ marginLeft: 'auto' }}
              />
            </div>
            {transferOpen && state.inCall && (
              <div role="group" aria-label="Transférer vers un poste 3CX" className={css.box}>
                <strong>Transférer via 3CX</strong>
                <Onglets
                  label="Type de transfert"
                  items={[
                    { label: 'Annoncé', selected: mode === 'announced', pick: () => setMode('announced') },
                    { label: 'Direct', selected: mode === 'direct', pick: () => setMode('direct') },
                  ]}
                />
                <span className={css.soft}>
                  {mode === 'direct'
                    ? 'Le débiteur est transféré tout de suite, sans présentation.'
                    : 'Vous parlez d’abord au collègue, puis vous finalisez le transfert.'}
                </span>
                {data.colleagues.map((item) => (
                  <Bouton
                    key={item.extension}
                    variant="dark"
                    full
                    label={`${item.name} · poste ${item.extension} · ${item.state}`}
                    disabled={!item.available}
                    title={item.available ? undefined : 'Indisponible dans 3CX'}
                    onPress={() => {
                      dispatch({ type: 'transfer', to: `${item.name} (poste ${item.extension})`, mode });
                      setTransferOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
            {state.transfer && (
              <div role="status" className={css.box}>
                <span>
                  {state.transfer.pending
                    ? `Transfert annoncé vers ${state.transfer.to} : présentez le dossier, le débiteur est en attente.`
                    : `Débiteur transféré vers ${state.transfer.to}. Complétez la fiche.`}
                </span>
                {state.transfer.pending && (
                  <span className={layout.inline}>
                    <Bouton label="Finaliser le transfert" variant="success" size="sm" onPress={() => dispatch({ type: 'transferFinish' })} />
                    <Bouton label="Reprendre le débiteur" variant="dark" size="sm" onPress={() => dispatch({ type: 'transferCancel' })} />
                  </span>
                )}
              </div>
            )}
            <label className={css.announce}>
              <input type="checkbox" checked={state.announced} onChange={() => dispatch({ type: 'announce' })} />
              <span>
                Annonce de l’enregistrement faite au débiteur{' '}
                <span className={css.muted}>· obligatoire · enregistrement 3CX rattaché au dossier, conservé 6 mois</span>
              </span>
            </label>
          </section>
          <section aria-label="Outils d'appel" className={layout.card}>
            <div className={layout.tabs}>
              <Onglets
                variant="underline"
                label="Outils"
                items={[
                  { label: 'Script', selected: tool === 'script', pick: () => setTool('script') },
                  { label: 'Historique du débiteur', selected: tool === 'history', pick: () => setTool('history') },
                  { label: 'Clavier', selected: tool === 'keypad', pick: () => setTool('keypad') },
                ]}
              />
            </div>
            <div style={{ padding: 'var(--sp-5)' }}>
              {tool === 'script' && (
                <ol className={css.script}>
                  {[
                    [
                      'Se présenter',
                      `Au nom de Legarec, pour le compte de ${current.creditor}. Vérifier que l’on parle à ${current.contact} et annoncer l’enregistrement.`,
                    ],
                    [
                      'Rappeler la créance',
                      `${formatCents(current.amount)} restent dus, retard maximal de ${current.daysLate} j. Citer les numéros de facture si demandé.`,
                    ],
                    ['Vérifier les coordonnées', 'Confirmer le numéro et l’adresse e-mail. Corriger dans « Coordonnées du débiteur » en cas d’erreur.'],
                    ['Obtenir un engagement', 'Une date et un montant précis. Sinon, proposer un échéancier (6 mois maximum sans validation).'],
                    ['Conclure', 'Reformuler l’engagement et annoncer l’e-mail de confirmation avec le lien de l’espace débiteur.'],
                  ].map(([title, text], index) => (
                    <li key={title}>
                      <span aria-hidden className={layout.step}>
                        {index + 1}
                      </span>
                      <span>
                        <strong>{title}.</strong> {text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {tool === 'history' && (
                <div className={layout.stack}>
                  <ul className={layout.list}>
                    {current.history.map((item) => (
                      <li key={item.text} style={{ paddingInline: 0 }}>
                        <Badge label={item.channel} />
                        <span className={layout.grow}>{item.text}</span>
                        <span className={layout.hint}>{item.when}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={`/debiteurs/${current.caseId}`} className={layout.link}>
                    Ouvrir la fiche complète →
                  </Link>
                </div>
              )}
              {tool === 'keypad' && (
                <div className={layout.stack}>
                  <div className={layout.between}>
                    <output className={css.display}>{dialed || 'Composer un numéro'}</output>
                    <Bouton variant="ghost" icon="x" iconOnly label="Effacer le dernier chiffre" onPress={() => setDialed(dialed.slice(0, -1))} />
                  </div>
                  <div className={css.keypad}>
                    {KEYS.map((key) => (
                      <Bouton key={key} variant="secondary" size="lg" label={key} onPress={() => setDialed((dialed + key).slice(0, 15))} />
                    ))}
                  </div>
                  <Bouton label="Appeler ce numéro" icon="phone" disabled={dialed.length < 10 || down || state.inCall} onPress={() => dial(dialed)} />
                  <span className={layout.hint}>Les touches du clavier envoient des tonalités pendant l&apos;appel (serveurs vocaux).</span>
                </div>
              )}
            </div>
          </section>
        </div>
        <QualificationPanel
          key={current.caseId}
          ref={panel}
          target={current}
          state={state}
          dispatch={dispatch}
          acw={!state.inCall && state.secs > 0 ? acwText(state.acw) : null}
          onDial={dial}
          onSaved={onSaved}
        />
      </div>
    </>
  );
}
