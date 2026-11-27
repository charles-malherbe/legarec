import {
  formatCents,
  formatDate,
  PLAN_STATE_LABELS,
  planApprovals,
  planDates,
  todayInParis,
  plansData,
  planSimulation,
  splitPlan,
  type PaymentPlan,
  type PlanSimulation,
} from '@legarec/contracts';
import {
  Alerte,
  Badge,
  Bouton,
  Carte,
  Champ,
  EtatListe,
  PageHeader,
  Pagination,
  Progression,
  Tableau,
  Toolbar,
  useConfirm,
  useToast,
  type Tone,
} from '@legarec/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { z } from 'zod';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import { shown } from '../../app/features';
import layout from '@legarec/ui/layout.module.css';
import { pageOf } from '../../shared/paging';
import { listState, matches } from '../../shared/listState';

type Data = z.infer<typeof plansData>;
const TONE: Record<PaymentPlan['state'], Tone> = { ON_TRACK: 'success', DEFAULT: 'danger', WAITING_CREDITOR: 'info', WAITING_DEBTOR: 'info' };
const METHOD = { CHEQUE: 'Chèque', TRANSFER: 'Virement' } as const;
const FILTERS = [
  ['all', 'Tous', () => true],
  ['ok', 'À jour', (plan: PaymentPlan) => plan.state === 'ON_TRACK'],
  // In default from the first installment missed (question 145): « Retard / défaut » of the mockup becomes « En défaut ».
  ['late', 'En défaut', (plan: PaymentPlan) => plan.state === 'DEFAULT'],
  ['wait', 'À valider', (plan: PaymentPlan) => plan.state === 'WAITING_CREDITOR'],
] as const;
const paid = (plan: PaymentPlan) => plan.installments.filter((item) => item.state === 'PAID').length;
const missed = (plan: PaymentPlan) => plan.installments.filter((item) => item.state === 'MISSED').length;
const next = (plan: PaymentPlan) => plan.installments.find((item) => item.state === 'UPCOMING');

export function PlansPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(plansData, '/payment-plans');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [method, setMethod] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [simulate, setSimulate] = useState<string | null>(params.get('dossier'));
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const scoped = (data?.plans ?? []).filter((plan) => scope.id === 'all' || plan.creditorId === scope.id);
  const test = FILTERS.find(([id]) => id === filter)?.[2] ?? (() => true);
  const rows = scoped.filter(
    (plan) => test(plan) && (method === 'all' || plan.method === method) && matches(query, plan.debtor, plan.identifier, plan.creditor, plan.id),
  );
  const current = data?.plans.find((plan) => plan.id === selected) ?? rows[0];
  const pending = data?.requests.filter((item) => !item.decision).length ?? 0;
  const paged = pageOf(rows, page, size);
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun échéancier',
    emptyText: 'Les plans de paiement créés depuis le simulateur ou proposés par les débiteurs apparaissent ici.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const decide = (request: Data['requests'][number], decision: 'APPROVED' | 'REFUSED') => {
    const ok = decision === 'APPROVED';
    confirm({
      tone: ok ? 'primary' : 'danger',
      title: `${ok ? 'Valider' : 'Refuser'} l’échéancier de ${request.debtor} ?`,
      body: ok
        ? 'Le plan est envoyé au débiteur pour signature électronique, et les relances automatiques sont suspendues tant qu’il est respecté.'
        : 'Le gestionnaire est prévenu et les relances reprennent selon le scénario du créancier.',
      confirmLabel: ok ? 'Valider l’échéancier' : 'Refuser la demande',
      reasonLabel: ok ? undefined : 'Motif du refus',
      reasonPlaceholder: 'Ex. : capacité de remboursement insuffisante, accord créancier refusé…',
      details: [
        { k: 'Débiteur', v: request.debtor },
        { k: 'Créancier', v: request.creditor },
        { k: 'Plan', v: request.plan },
        { k: 'Origine', v: request.origin },
      ],
      onConfirm: async (reason) => {
        await change(`/payment-plans/requests/${request.id}`, { method: 'PUT', body: { decision, reason, version: request.version } });
        toast({
          message: ok
            ? `Échéancier de ${request.debtor} validé et envoyé pour signature.`
            : `Demande de ${request.debtor} refusée, le gestionnaire est prévenu.`,
        });
      },
    });
  };
  const remind = (plan: PaymentPlan) =>
    confirm({
      title: `Envoyer un rappel à ${plan.debtor} ?`,
      body: 'Un e-mail (Resend) et un SMS rappellent la prochaine échéance avec le lien de l’espace débiteur.',
      confirmLabel: 'Envoyer le rappel',
      details: [
        { k: 'Débiteur', v: plan.debtor },
        { k: 'Plan', v: plan.creditor },
      ],
      onConfirm: async () => {
        await change(`/payment-plans/${plan.id}/reminder`);
        toast({ message: `Rappel envoyé à ${plan.debtor} par e-mail et SMS.` });
      },
    });
  const s = data?.stats;
  return (
    <>
      <PageHeader
        title="Échéanciers"
        loading={isPending}
        statsLabel="Indicateurs des échéanciers"
        description={s ? `${s.active} plans de paiement actifs · ${formatCents(s.remaining)} restant à percevoir · tous créanciers` : ' '}
        stats={[
          { label: 'À percevoir en décembre', value: s ? formatCents(s.nextMonth) : '', sub: s ? `${s.nextMonthCount} échéances` : ' ' },
          { label: 'Échéances honorées', value: s ? `${s.honored} %` : '', sub: '▲ 3 pts sur 90 jours', tone: 'success' },
          { label: 'Plans en défaut', value: String(s?.defaults ?? ''), sub: 'Dès 1 échéance impayée', tone: 'danger' },
          { label: 'À valider', value: String(pending), sub: 'par un responsable', tone: 'warning' },
        ]}
        actions={[
          { label: 'Voir dans l’agenda', href: '/relances' },
          ...(data?.simulation
            ? [
                {
                  label: simulate ? 'Fermer le simulateur' : '+ Nouvel échéancier',
                  primary: !simulate,
                  kbd: 'N',
                  expanded: !!simulate,
                  onPress: () => setSimulate(simulate ? null : (data?.simulation?.caseId ?? null)),
                },
              ]
            : []),
        ]}
      />
      <Toolbar
        label="Filtrer les échéanciers"
        tabsLabel="État des plans"
        placeholder="Débiteur, SIRET, n° de plan…"
        query={query}
        onQuery={setQuery}
        tabs={FILTERS.map(([id, label, check]) => ({ label, count: scoped.filter(check).length, selected: id === filter, pick: () => setFilter(id) }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (scoped[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
        filters={[
          {
            label: 'Mode de paiement',
            value: method,
            options: [
              { value: 'all', label: 'Tous les modes' },
              { value: 'TRANSFER', label: 'Virement' },
              { value: 'CHEQUE', label: 'Chèque' },
            ],
            onChange: setMethod,
          },
        ]}
      />
      {data && data.requests.length > 0 && (
        <Carte
          title="Demandes à valider"
          description={`Échéanciers au-delà de ${data.thresholdMonths} mois ou demandés par le débiteur depuis son espace`}
          badge={`${pending} en attente`}
          badgeTone="warning"
          padding="none"
        >
          <ul className={layout.list}>
            {data.requests.map((request) => (
              <li key={request.id} style={{ flexWrap: 'wrap' }}>
                <span className={`${layout.text} ${layout.grow}`}>
                  <span>
                    <strong>{request.debtor}</strong> <span className={layout.muted}>· {request.creditor}</span>
                  </span>
                  <span>{request.plan}</span>
                  <span className={layout.hint}>{request.origin}</span>
                </span>
                <Badge label={request.flag} tone={request.tone} />
                {request.decision ? (
                  <span role="status" className={request.decision === 'APPROVED' ? layout.success : layout.danger}>
                    {request.decision === 'APPROVED' ? 'Validé · plan envoyé au débiteur pour signature' : 'Refusé · le gestionnaire est prévenu'}
                  </span>
                ) : data.canValidate ? (
                  <span className={layout.inline}>
                    <Bouton
                      variant="secondary"
                      size="sm"
                      label="Refuser"
                      ariaLabel={`Refuser l’échéancier de ${request.debtor}`}
                      onPress={() => decide(request, 'REFUSED')}
                    />
                    <Bouton size="sm" label="Valider" ariaLabel={`Valider l’échéancier de ${request.debtor}`} onPress={() => decide(request, 'APPROVED')} />
                  </span>
                ) : (
                  <span className={layout.muted}>En attente du Responsable</span>
                )}
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <div className={layout.columns}>
        <div className={layout.wide}>
          <Carte title="Plans de paiement" description={`${rows.length} affichés · cliquez sur une ligne pour le détail`} padding="none">
            <Tableau
              caption="Plans de paiement"
              hideCaption
              tight
              bordered={false}
              rows={paged.shown}
              rowId={(row) => row.id}
              activeRowId={current?.id}
              state={state}
              columns={[
                {
                  key: 'debtor',
                  label: 'Débiteur',
                  render: (row) => (
                    <button
                      type="button"
                      aria-pressed={row.id === current?.id}
                      onClick={() => setSelected(row.id)}
                      style={{ border: 0, padding: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      className={layout.text}
                    >
                      <span className={layout.strong}>{row.debtor}</span>
                      <span className={layout.hint}>
                        {row.creditor} · {row.identifier}
                      </span>
                    </button>
                  ),
                },
                {
                  key: 'total',
                  label: 'Montant',
                  align: 'right',
                  sortValue: (row) => row.total,
                  value: (row) => ({ text: formatCents(row.total), strong: true }),
                },
                {
                  key: 'progress',
                  label: 'Avancement',
                  render: (row) => (
                    <span className={layout.inline} style={{ flexWrap: 'nowrap' }}>
                      <Progression
                        value={(paid(row) / row.installments.length) * 100}
                        tone="marine"
                        size="md"
                        label={`Avancement de ${row.debtor}`}
                        layout={{ width: 72 }}
                      />
                      <span className={layout.hint}>
                        {paid(row)} / {row.installments.length}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'next',
                  label: 'Prochaine échéance',
                  value: (row) =>
                    row.state === 'DEFAULT'
                      ? { text: '—', sub: `${missed(row)} impayées` }
                      : { text: next(row) ? formatDate(next(row)!.date) : '—', sub: next(row) ? formatCents(next(row)!.amount) : undefined },
                },
                { key: 'method', label: 'Mode', value: (row) => METHOD[row.method] },
                { key: 'state', label: 'État', render: (row) => <Badge label={PLAN_STATE_LABELS[row.state]} tone={TONE[row.state]} /> },
              ]}
            />
            {!state && s && (
              <Pagination
                total={paged.total}
                page={paged.current}
                size={size}
                unit="échéanciers"
                label="Pagination des échéanciers"
                onPage={setPage}
                onSize={setSize}
              />
            )}
          </Carte>
        </div>
        <aside className={layout.aside} aria-label="Détail et simulation">
          {current && (
            <Carte title={current.debtor} description={`${current.creditor} · ${formatCents(current.total)} en ${current.installments.length} mensualités`}>
              <div className={layout.stack}>
                <ol className={layout.list}>
                  {current.installments.map((item) => (
                    <li key={item.number} style={{ padding: 'var(--sp-2) 0' }}>
                      <span aria-hidden className={layout.step} data-state={item.state === 'PAID' ? 'DONE' : undefined}>
                        {item.number}
                      </span>
                      <span className={layout.grow}>{formatDate(item.date)}</span>
                      <strong className={layout.num}>{formatCents(item.amount)}</strong>
                      <span className={item.state === 'PAID' ? layout.success : item.state === 'MISSED' ? layout.danger : layout.hint}>
                        {{ PAID: 'Payée', MISSED: 'Impayée', UPCOMING: 'À venir' }[item.state]}
                      </span>
                    </li>
                  ))}
                </ol>
                {current.canAct && (
                  <div className={layout.inline}>
                    <Bouton variant="secondary" label="Modifier le plan" onPress={() => setSimulate(current.caseId)} />
                    {shown('installment-reminders') && <Bouton variant="secondary" label="Envoyer un rappel" onPress={() => remind(current)} />}
                  </div>
                )}
              </div>
            </Carte>
          )}
          {simulate && data && (
            <CaseSimulator
              key={simulate}
              caseId={simulate}
              threshold={data.thresholdMonths}
              onDone={() => {
                setSimulate(null);
                setParams({}, { replace: true });
              }}
            />
          )}
        </aside>
      </div>
    </>
  );
}

/** Always simulates the case it was opened for, with the balance given by the API. */
function CaseSimulator({ caseId, threshold, onDone }: { caseId: string; threshold: number; onDone: () => void }) {
  const { data, error, refetch } = useApi(planSimulation, `/payment-plans/simulation/${encodeURIComponent(caseId)}`);
  if (!data)
    return (
      <Carte title="Simuler un échéancier">
        {error ? (
          <EtatListe
            kind="error"
            compact
            title="Simulation impossible"
            text="Ce dossier n’est pas accessible ou n’est pas le vôtre."
            onAction={() => void refetch()}
          />
        ) : (
          <EtatListe kind="loading" compact />
        )}
      </Carte>
    );
  return <Simulator simulation={data} threshold={threshold} onDone={onDone} />;
}

function Simulator({ simulation, threshold, onDone }: { simulation: PlanSimulation; threshold: number; onDone: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [months, setMonths] = useState(4);
  const [method, setMethod] = useState<'TRANSFER' | 'CHEQUE'>('TRANSFER');
  const amounts = splitPlan(simulation.balance, months);
  const approvals = planApprovals(months, threshold, simulation.ownedByDirector);
  const last = `${planDates(months, todayInParis()).at(-1) ?? ''}T00:00:00Z`;
  const needs = approvals.length > 0;
  const submit = () =>
    confirm({
      title: needs ? `Demander l’accord de ${simulation.creditor} ?` : `Proposer cet échéancier à ${simulation.debtor} ?`,
      body: needs
        ? `Le plan dépasse ${threshold} mois : ${approvals.includes('COLLECTION_MANAGER') ? 'il part en validation chez le Responsable du recouvrement, puis' : 'il part'} chez le créancier, puis chez le débiteur.`
        : 'Le débiteur reçoit le plan par e-mail avec un lien pour le signer dans son espace.',
      confirmLabel: needs ? 'Envoyer la demande' : 'Envoyer au débiteur',
      details: [
        { k: 'Débiteur', v: simulation.debtor },
        { k: 'Créancier', v: simulation.creditor },
        { k: 'Montant', v: formatCents(simulation.balance) },
        { k: 'Mensualités', v: `${months} × ${formatCents(amounts[0] ?? 0)}` },
        { k: 'Mode de paiement', v: METHOD[method] },
      ],
      onConfirm: async () => {
        await change('/payment-plans', { body: { caseId: simulation.caseId, months, method, expected: simulation.balance } });
        toast({
          message: needs ? `Demande d’accord envoyée à ${simulation.creditor}.` : `Échéancier proposé à ${simulation.debtor}, en attente de signature.`,
        });
        onDone();
      },
    });
  return (
    <Carte title="Simuler un échéancier">
      <div className={layout.stack}>
        <div className={layout.text}>
          <span className={layout.muted}>
            {simulation.debtor} · {simulation.creditor} · solde à étaler
          </span>
          <strong className={layout.num}>{formatCents(simulation.balance)}</strong>
        </div>
        <div className={layout.text}>
          <span className={layout.muted} id="nb-mensualites">
            Nombre de mensualités
          </span>
          <div className={layout.inline} role="group" aria-labelledby="nb-mensualites">
            <Bouton
              variant="secondary"
              size="lg"
              icon="minus"
              iconOnly
              label="Une mensualité de moins"
              disabled={months <= 2}
              onPress={() => setMonths(months - 1)}
            />
            <strong aria-live="polite">{months}</strong>
            <Bouton
              variant="secondary"
              size="lg"
              icon="plus"
              iconOnly
              label="Une mensualité de plus"
              disabled={months >= 24}
              onPress={() => setMonths(months + 1)}
            />
          </div>
        </div>
        <dl className={layout.facts}>
          <div>
            <dt>Mensualité</dt>
            <dd>{formatCents(amounts[0] ?? 0)}</dd>
          </div>
          <div>
            <dt>Dernière échéance</dt>
            <dd>{formatDate(last)}</dd>
          </div>
        </dl>
        {needs && (
          <Alerte
            tone="warning"
            compact
            text={`Plus de ${threshold} mois : la convention de ${simulation.creditor} exige son accord. Une demande lui sera envoyée${approvals.includes('COLLECTION_MANAGER') ? ' après validation du Responsable du recouvrement' : ''}.`}
          />
        )}
        <Champ
          label="Mode de paiement"
          type="select"
          value={method}
          options={[
            { value: 'TRANSFER', label: 'Virement' },
            { value: 'CHEQUE', label: 'Chèque' },
          ]}
          onChange={(value) => setMethod(value as 'TRANSFER' | 'CHEQUE')}
        />
        <Bouton size="lg" full label={needs ? 'Demander l’accord du créancier' : 'Proposer au débiteur'} onPress={submit} />
      </div>
    </Carte>
  );
}
