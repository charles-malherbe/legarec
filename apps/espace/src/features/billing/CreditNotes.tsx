import {
  CREDIT_NOTE_FOLLOW_UP_LABELS,
  creditedVat,
  creditNotesData,
  formatCents,
  formatDate,
  formatLongDate,
  formatSiren,
  parseCents,
  type CorrectableInvoice,
  type CreditNoteDraft,
  type CreditNoteFollowUp,
  type CreditNoteRow,
  type CreditNoteScope,
  type CreditNotesData,
} from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Champ, EtatListe, Tableau, useConfirm, useToast, type Tone } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import { listState, matches } from '../../shared/listState';
import css from './Billing.module.css';

const PLACEHOLDER = /\[[A-ZÀ-ÖØ-Þ][^[\]]{2,}\]/gu;
const money = (value: number) => formatCents(value, { decimals: 'always' });
/** Typed amount, as the field shows it: « 208,80 ». */
const typed = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const sirenLine = (client: CorrectableInvoice['client']) =>
  client.siren ? `SIREN ${formatSiren(client.siren)}${client.vatNumber ? ` · TVA ${client.vatNumber}` : ''}` : 'SIREN à renseigner';
type Failure = { kind: 'firm'; missing: string[] } | { kind: 'changed' } | { kind: 'debtor' } | { kind: 'error' };
/** A field of the firm left empty, as Paramètres › Cabinet names it. */
const FIRM_LABELS: Record<string, string> = {
  name: 'Nom du cabinet',
  address: 'Adresse',
  phone: 'Téléphone',
  siren: 'SIREN',
  vat: 'N° TVA',
  rcs: 'Capital et RCS',
};

/** Badge of a credit note in the list « Avoirs »: what became of its amount. */
export function creditNoteStatus(item: CreditNoteRow): { label: string; tone: Tone } {
  if (item.followUp === 'DEDUCTED') return { label: 'Déduit de la facture', tone: 'success' };
  if (item.followUp === 'TRANSFER') return { label: 'Remboursement par virement', tone: 'neutral' };
  return item.remittedOn
    ? { label: `Au reversement du ${formatDate(item.remittedOn).slice(0, 5)}`, tone: 'marine' }
    : { label: 'Au prochain reversement', tone: 'warning' };
}

/** « + Créer depuis un modèle » › Avoir (docs/propositions, écran 4): corrects an invoice already issued. */
export function CreditNoteCreator({
  typePicker,
  invoiceNumber,
  draft,
  onClose,
  onIssued,
}: {
  typePicker: ReactNode;
  invoiceNumber?: string;
  draft?: CreditNoteDraft;
  onClose: () => void;
  onIssued: () => void;
}) {
  const { data, isPending, error, refetch } = useApi(creditNotesData, '/credit-notes');
  const [picked, setPicked] = useState<string | null>(null);
  const shell = (body: ReactNode) => (
    <Carte
      title="Créer depuis un modèle"
      description="Choisissez le type, le modèle et le client : l'aperçu se met à jour au fur et à mesure."
      actionLabel="Fermer"
      onAction={onClose}
    >
      <div className={css.creator}>
        <div className={layout.stack}>
          {typePicker}
          {body}
        </div>
      </div>
    </Carte>
  );
  if (!data) return shell(<EtatListe kind={error ? 'error' : isPending ? 'loading' : 'empty'} onAction={() => void refetch()} />);
  if (!data.invoices.length)
    return shell(
      <EtatListe kind="empty" title="Aucune facture à corriger" text="Seules les factures émises, pas encore annulées, peuvent recevoir un avoir." />,
    );
  // The invoice asked for (by its button, or by a draft): never another one in its place.
  const asked = draft
    ? data.invoices.find((item) => item.id === draft.invoiceId)
    : invoiceNumber
      ? data.invoices.find((item) => item.number === invoiceNumber)
      : data.invoices[0];
  const initial = picked ?? asked?.id;
  if (!initial)
    return shell(
      <>
        <Alerte
          tone="warning"
          title="Facture déjà annulée ou introuvable"
          text={`${draft?.invoice ?? invoiceNumber ?? 'Cette facture'} ne peut plus recevoir d’avoir. Choisissez une autre facture, ou fermez la création.`}
        />
        <Champ
          label="2. Facture à corriger"
          type="select"
          value=""
          options={[
            { value: '', label: 'Choisir une facture' },
            ...data.invoices.map((item) => ({ value: item.id, label: `${item.number} · ${item.client.name} · ${money(item.left)} TTC` })),
          ]}
          onChange={(value) => setPicked(value || null)}
        />
      </>,
    );
  return (
    <Form
      key={`${data.invoices.map((item) => `${item.id}:${item.left}`).join()}`}
      data={data}
      typePicker={typePicker}
      initialId={initial}
      draft={asked && !picked ? draft : undefined}
      onClose={onClose}
      onIssued={onIssued}
      onReload={() => void refetch()}
    />
  );
}

function Form({
  data,
  typePicker,
  initialId,
  draft,
  onClose,
  onIssued,
  onReload,
}: {
  data: CreditNotesData;
  typePicker: ReactNode;
  initialId: string;
  draft?: CreditNoteDraft;
  onClose: () => void;
  onIssued: () => void;
  onReload: () => void;
}) {
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const first = data.invoices.find((item) => item.id === initialId)!;
  const [invoiceId, setInvoiceId] = useState(first.id);
  const invoice = data.invoices.find((item) => item.id === invoiceId) ?? first;
  const settled = invoice.settledOn !== null;
  const [scope, setScope] = useState<CreditNoteScope>(draft?.scope ?? 'PARTIAL');
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries((draft?.lines ?? []).map((item) => [item.lineId, typed(item.net)])));
  const [reason, setReason] = useState(draft?.reason ?? '');
  const [chosen, setChosen] = useState<CreditNoteFollowUp | null>(draft?.followUp ?? null);
  // A draft belongs to its invoice: another invoice chosen, and it is a new draft.
  const [saved, setSaved] = useState(draft ? { id: draft.id, invoiceId: draft.invoiceId } : null);
  const draftId = saved?.invoiceId === invoice.id ? saved.id : null;
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const followUp: CreditNoteFollowUp = settled ? (chosen === 'TRANSFER' ? 'TRANSFER' : 'NEXT_REMITTANCE') : 'DEDUCTED';

  const lines = invoice.lines.map((line) => {
    const text = scope === 'TOTAL' ? typed(line.leftNet) : (amounts[line.id] ?? '0,00');
    const net = scope === 'TOTAL' ? line.leftNet : parseCents(text || '0');
    const problem =
      net === null || net < 0
        ? 'Saisissez un montant en euros, par exemple 208,80.'
        : net > line.leftNet
          ? `Au plus ${money(line.leftNet)} HT : ce qui reste facturé sur cette ligne.`
          : undefined;
    const credited = problem ? 0 : (net ?? 0);
    return { line, text, net: credited, vat: creditedVat(line, credited), problem };
  });
  const net = lines.reduce((sum, item) => sum + item.net, 0);
  const vat = lines.reduce((sum, item) => sum + item.vat, 0);
  const gross = net + vat;
  const errors = {
    reason: reason.trim() ? undefined : 'Indiquez le motif : il est imprimé sur l’avoir.',
    total: net > 0 ? undefined : 'Indiquez au moins un montant à créditer.',
  };
  const invalid = lines.some((item) => item.problem) || Object.values(errors).some(Boolean);
  const pick = (id: string) => {
    setInvoiceId(id);
    setAmounts({});
    setChosen(null);
    setFailure(null);
  };
  const body = () => ({
    invoiceId: invoice.id,
    scope,
    lines: scope === 'TOTAL' ? [] : lines.filter((item) => item.net > 0).map((item) => ({ lineId: item.line.id, net: item.net })),
    reason: reason.trim(),
  });
  const sequel =
    followUp === 'NEXT_REMITTANCE'
      ? data.nextRemittance
        ? `Ajouté au reversement du ${formatDate(data.nextRemittance)}`
        : 'Ajouté au prochain reversement'
      : followUp === 'TRANSFER'
        ? 'Remboursé par virement, à la main'
        : 'Déduit de la facture';
  const saveDraft = async () => {
    const sent = { ...body(), followUp: settled ? followUp : 'DEDUCTED' };
    if (draftId) await change(`/credit-notes/drafts/${draftId}`, { method: 'PUT', body: sent });
    else setSaved({ id: (await change('/credit-notes/drafts', { body: sent, schema: z.object({ id: z.string() }) })).id, invoiceId: invoice.id });
    toast({ message: 'Brouillon enregistré : modifiable et supprimable, le numéro n’est attribué qu’à l’émission.' });
  };
  const issue = () => {
    setShown(true);
    if (invalid) return;
    confirm({
      title: `Émettre l’avoir sur ${invoice.number} ?`,
      body: 'Le numéro est attribué à l’émission et l’avoir ne peut plus être modifié ensuite. La facture d’origine reste inchangée.',
      confirmLabel: 'Émettre l’avoir',
      details: [
        { k: 'Numéro', v: `${data.nextNumber} (numéro provisoire)` },
        { k: 'Facture corrigée', v: `${invoice.number} du ${formatDate(invoice.issuedOn)}` },
        { k: 'Client', v: `${invoice.client.legalName}${invoice.client.siren ? ` · SIREN ${formatSiren(invoice.client.siren)}` : ''}` },
        { k: 'Motif', v: reason.trim() },
        { k: 'Total HT', v: money(net) },
        { k: 'TVA 20 %', v: money(vat) },
        { k: 'Total TTC', v: money(gross) },
        { k: 'Suite', v: sequel },
        ...(user.role === 'DIRECTOR' ? [] : [{ k: 'Pour le compte de', v: `${user.directorName}, Directeur` }]),
      ],
      onConfirm: async () => {
        try {
          const made = await change('/credit-notes', {
            body: { ...body(), followUp, expectedLeft: invoice.left, draftId },
            schema: z.object({ id: z.string(), number: z.string() }),
          });
          toast({ message: `Avoir ${made.number} émis.` });
          onIssued();
        } catch (problem) {
          const code = problem instanceof ApiError ? (problem.body as { code?: string; missing?: string[] } | null) : null;
          setFailure(
            code?.code === 'FIRM_INCOMPLETE'
              ? { kind: 'firm', missing: code.missing ?? [] }
              : code?.code === 'CHANGED'
                ? { kind: 'changed' }
                : code?.code === 'DEBTOR_NAME'
                  ? { kind: 'debtor' }
                  : { kind: 'error' },
          );
        }
      },
    });
  };
  const missingFirm = Object.entries(data.firm).flatMap(([field, value]) => (value.trim() ? (value.match(PLACEHOLDER) ?? []) : [field]));
  const firmGaps = (failure?.kind === 'firm' && failure.missing.length ? failure.missing : missingFirm).map((item) => FIRM_LABELS[item] ?? item);
  const sentence = {
    NEXT_REMITTANCE: data.nextRemittance ? `Montant ajouté au reversement du ${formatDate(data.nextRemittance)}.` : 'Montant ajouté au prochain reversement.',
    TRANSFER: 'Montant remboursé par virement.',
    DEDUCTED: `Montant déduit de la facture ${invoice.number}.`,
  }[followUp];

  return (
    <Carte
      title="Créer depuis un modèle"
      description="Choisissez le type, le modèle et le client : l'aperçu se met à jour au fur et à mesure."
      actionLabel="Fermer"
      onAction={onClose}
    >
      <div className={css.creator}>
        <div className={layout.stack}>
          {typePicker}
          <Champ
            label="2. Facture à corriger"
            type="select"
            value={invoice.id}
            options={data.invoices.map((item) => ({ value: item.id, label: `${item.number} · ${item.client.name} · ${money(item.left)} TTC` }))}
            help={`Émise le ${formatDate(invoice.issuedOn)} · ${settled ? `déduite du reversement du ${formatDate(invoice.settledOn!)}` : 'non réglée'} · ${
              invoice.credited ? `${invoice.credited} avoir${invoice.credited > 1 ? 's' : ''} à ce jour` : 'aucun avoir à ce jour'
            }`}
            onChange={pick}
          />
          <fieldset className={css.fieldset}>
            <legend>3. Étendue</legend>
            <div className={css.pair}>
              {(
                [
                  ['PARTIAL', 'Avoir partiel', 'Corrige une ou plusieurs lignes'],
                  ['TOTAL', 'Avoir total', `Annule la facture : ${money(invoice.left)} TTC`],
                ] as const
              ).map(([id, label, hint]) => (
                <label key={id} className={css.choice} data-on={scope === id || undefined}>
                  <span className={layout.inline}>
                    <input type="radio" name="etendue" checked={scope === id} onChange={() => setScope(id)} />
                    <strong>{label}</strong>
                  </span>
                  <span className={layout.hint}>{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={css.fieldset}>
            <legend>4. Montants à créditer (HT)</legend>
            <div className={css.creditHead} aria-hidden="true">
              <span>Ligne de la facture</span>
              <span>Facturé</span>
              <span>À créditer (€)</span>
            </div>
            {lines.map((item) => (
              <div key={item.line.id} className={css.creditLine}>
                <span>{item.line.label}</span>
                <span className={layout.num}>{money(item.line.leftNet)}</span>
                <Champ
                  label={`À créditer, ${item.line.label}`}
                  hideLabel
                  inputMode="decimal"
                  value={item.text}
                  readOnly={scope === 'TOTAL'}
                  error={shown ? item.problem : undefined}
                  onChange={(value) => setAmounts({ ...amounts, [item.line.id]: value })}
                />
              </div>
            ))}
            {scope === 'TOTAL' && <span className={layout.hint}>Avoir total : toutes les lignes, non modifiables.</span>}
            {shown && errors.total && <span className={layout.danger}>{errors.total}</span>}
          </fieldset>
          <Champ
            label="5. Motif"
            type="textarea"
            required
            rows={2}
            value={reason}
            maxLength={1000}
            help="Imprimé sur l’avoir et conservé 10 ans avec lui ; référence du dossier, jamais le nom du débiteur."
            error={
              failure?.kind === 'debtor'
                ? 'Le motif contient le nom d’un débiteur : indiquez plutôt la référence du dossier.'
                : shown
                  ? errors.reason
                  : undefined
            }
            onChange={(value) => {
              setReason(value);
              if (failure?.kind === 'debtor') setFailure(null);
            }}
          />
          <fieldset className={css.fieldset}>
            <legend>6. Suite</legend>
            {settled ? (
              <div className={css.pair}>
                {(
                  [
                    ['NEXT_REMITTANCE', data.nextRemittance ? `Ajouté au lot du ${formatDate(data.nextRemittance)}` : 'Ajouté au prochain lot'],
                    ['TRANSFER', 'Remboursé à part, à la main'],
                  ] as const
                ).map(([id, hint]) => (
                  <label key={id} className={css.choice} data-on={followUp === id || undefined}>
                    <span className={layout.inline}>
                      <input type="radio" name="suite" checked={followUp === id} onChange={() => setChosen(id)} />
                      <strong>{CREDIT_NOTE_FOLLOW_UP_LABELS[id]}</strong>
                    </span>
                    <span className={layout.hint}>{hint}</span>
                  </label>
                ))}
              </div>
            ) : (
              <span className={layout.text}>
                <strong>Déduit de la facture</strong>
                <span className={layout.hint}>Facture non réglée : le reste à payer diminue d’autant.</span>
              </span>
            )}
          </fieldset>
          <dl className={layout.facts}>
            <div>
              <dt>Total HT</dt>
              <dd>{money(net)}</dd>
            </div>
            <div>
              <dt>TVA 20 %</dt>
              <dd>{money(vat)}</dd>
            </div>
            <div className={css.strongFact}>
              <dt>Total TTC de l’avoir</dt>
              <dd>{money(gross)}</dd>
            </div>
            <div>
              <dt>Reste facturé sur {invoice.number}</dt>
              <dd>{money(invoice.left - gross)}</dd>
            </div>
          </dl>
          {failure?.kind === 'firm' && (
            <Alerte
              tone="danger"
              title="Identité du cabinet incomplète"
              text={
                firmGaps.length
                  ? `${firmGaps.join(', ')} : à saisir dans Paramètres › Cabinet.`
                  : 'Une valeur de l’identité du cabinet manque : à compléter dans Paramètres › Cabinet.'
              }
              actionLabel="Ouvrir Paramètres"
              actionHref="/parametres/cabinet"
            />
          )}
          {failure?.kind === 'changed' && (
            <Alerte
              tone="warning"
              title="Un autre avoir vient d’être émis"
              text="La facture a changé depuis l’affichage. Vérifiez le reste facturé avant de continuer."
              actionLabel="Recharger"
              onAction={onReload}
            />
          )}
          {failure?.kind === 'error' && (
            <Alerte
              tone="danger"
              title="L’avoir n’a pas été émis."
              text="Aucun numéro n’a été attribué. Votre saisie est conservée : réessayez."
              actionLabel="Réessayer"
              onAction={issue}
            />
          )}
          <div className={layout.end}>
            <Bouton variant="secondary" label="Enregistrer le brouillon" onPress={() => void saveDraft().catch(() => setFailure({ kind: 'error' }))} />
            <Bouton label="Émettre l’avoir" onPress={issue} />
          </div>
        </div>
        <div className={css.paper}>
          <article aria-label="Aperçu de l’avoir" tabIndex={0} className={css.sheet}>
            <header className={css.docHead}>
              <span className={layout.text}>
                <strong className={css.firm}>{data.firm.name}</strong>
                <span>Cabinet de recouvrement de créances</span>
                <span>
                  {data.firm.address} · {data.firm.phone}
                </span>
                <span>
                  SIREN {data.firm.siren} · TVA {data.firm.vat}
                </span>
              </span>
              <span className={`${layout.text} ${css.right}`}>
                <strong className={css.kind}>Avoir</strong>
                <span>{data.nextNumber} (provisoire)</span>
                <span>Paris, le {formatLongDate(new Date())}</span>
              </span>
            </header>
            <div className={css.client}>
              <strong>{invoice.client.legalName}</strong>
              <span>{invoice.client.address}</span>
              <span>{sirenLine(invoice.client)}</span>
            </div>
            <strong>
              Objet : Avoir {scope === 'TOTAL' || gross === invoice.left ? 'total' : 'partiel'} sur la facture {invoice.number} du{' '}
              {formatDate(invoice.issuedOn)}
            </strong>
            <table className={css.table}>
              <thead>
                <tr>
                  <th scope="col">Désignation</th>
                  <th scope="col">Qté</th>
                  <th scope="col">PU HT</th>
                  <th scope="col">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((item) => item.net > 0)
                  .map((item) => (
                    <tr key={item.line.id}>
                      <td>{item.line.label}</td>
                      <td>1</td>
                      <td>{money(item.net)}</td>
                      <td>{money(item.net)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <dl className={`${layout.facts} ${css.totals}`}>
              <div>
                <dt>Total HT</dt>
                <dd>{money(net)}</dd>
              </div>
              <div>
                <dt>TVA 20 %</dt>
                <dd>{money(vat)}</dd>
              </div>
              <div>
                <dt>Total TTC</dt>
                <dd>{money(gross)}</dd>
              </div>
            </dl>
            {reason.trim() && <p className={css.paragraph}>Motif : {reason.trim()}</p>}
            <p className={css.paragraph}>{sentence}</p>
            <p className={css.legal}>
              Cet avoir corrige la facture {invoice.number} du {formatDate(invoice.issuedOn)} ; la TVA correspondante vient en diminution de la TVA déductible
              du client. Catégorie de l’opération : prestation de services. {data.firm.rcs}
            </p>
          </article>
        </div>
      </div>
    </Carte>
  );
}

export type CreditNoteListRow =
  | { kind: 'draft'; id: string; draft: CreditNoteDraft; client: string; status: string }
  | { kind: 'issued'; id: string; item: CreditNoteRow; client: string; status: string };
/** The drafts, then the credit notes issued: what the tab « Avoirs » lists, filters and counts. */
export const creditNoteRows = (data: CreditNotesData | undefined): CreditNoteListRow[] => [
  ...(data?.drafts ?? []).map((draft) => ({ kind: 'draft' as const, id: draft.id, draft, client: draft.client, status: 'Brouillon' })),
  ...(data?.items ?? []).map((item) => ({ kind: 'issued' as const, id: item.id, item, client: item.client.name, status: creditNoteStatus(item).label })),
];

/** Onglet « Avoirs ». The PDF and the sending to the creditor from one's mailbox come with the sendings (lot R, V3). */
export function CreditNotesList({
  query,
  client,
  status,
  onResume,
  onClear,
}: {
  query: string;
  client: string;
  status: string;
  onResume: (draft: CreditNoteDraft) => void;
  onClear: () => void;
}) {
  const { data, isPending, error, refetch } = useApi(creditNotesData, '/credit-notes');
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const rows = creditNoteRows(data).filter(
    (row) =>
      (client === 'all' || row.client === client) &&
      (status === 'all' || row.status === status) &&
      (row.kind === 'draft'
        ? matches(query, row.draft.invoice, row.client)
        : matches(query, row.item.number, row.client, row.item.invoice, row.item.client.siren ?? '')),
  );
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun avoir',
    emptyText: 'Un avoir se crée depuis une facture émise, avec le bouton « Avoir ».',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro d’avoir ou de facture.',
    onRetry: () => void refetch(),
    onClear,
  });
  const remove = (draft: CreditNoteDraft) =>
    confirm({
      tone: 'danger',
      title: 'Supprimer ce brouillon d’avoir ?',
      body: 'Le brouillon n’a pas de numéro : rien n’est émis ni envoyé.',
      confirmLabel: 'Supprimer le brouillon',
      details: [
        { k: 'Facture', v: draft.invoice },
        { k: 'Client', v: draft.client },
      ],
      onConfirm: async () => {
        await change(`/credit-notes/drafts/${draft.id}`, { method: 'DELETE' });
        toast({ message: 'Brouillon supprimé.' });
      },
    });
  return (
    <Carte title="Avoirs" description={`${rows.length} documents · le PDF et l’envoi au créancier depuis votre boîte arrivent avec les envois`} padding="none">
      <Tableau
        caption="Avoirs"
        hideCaption
        tight
        bordered={false}
        rows={rows}
        rowId={(row) => row.id}
        state={state}
        columns={[
          { key: 'number', label: 'Numéro', value: (row) => ({ text: row.kind === 'draft' ? 'Brouillon' : row.item.number, strong: true }) },
          {
            key: 'client',
            label: 'Client',
            value: (row) => ({
              text: row.client,
              sub: row.kind === 'issued' && row.item.client.siren ? `SIREN ${formatSiren(row.item.client.siren)}` : undefined,
            }),
          },
          {
            key: 'invoice',
            label: 'Facture corrigée',
            value: (row) =>
              row.kind === 'draft'
                ? row.draft.invoice
                : { text: row.item.invoice, sub: `statut : ${row.item.invoiceStatus === 'CANCELLED' ? 'Annulée par avoir' : 'Avoir partiel'}` },
          },
          {
            key: 'date',
            label: 'Date',
            sortValue: (row) => (row.kind === 'draft' ? row.draft.updatedAt : row.item.issuedOn),
            value: (row) => formatDate(row.kind === 'draft' ? row.draft.updatedAt.slice(0, 10) : row.item.issuedOn),
          },
          {
            key: 'amount',
            label: 'Montant TTC',
            align: 'right',
            value: (row) => ({ text: row.kind === 'draft' ? '—' : formatCents(row.item.gross, { decimals: 'always' }), strong: true }),
          },
          {
            key: 'status',
            label: 'Statut',
            render: (row) =>
              row.kind === 'draft' ? <Badge label="Brouillon" tone="neutral" /> : <Badge label={row.status} tone={creditNoteStatus(row.item).tone} />,
          },
          {
            key: 'actions',
            label: 'Actions',
            render: (row) =>
              row.kind === 'draft' ? (
                <span className={layout.inline}>
                  <Bouton
                    variant="secondary"
                    size="sm"
                    label="Reprendre"
                    ariaLabel={`Reprendre le brouillon sur ${row.draft.invoice}`}
                    onPress={() => onResume(row.draft)}
                  />
                  <Bouton
                    variant="secondary"
                    size="sm"
                    label="Supprimer"
                    ariaLabel={`Supprimer le brouillon sur ${row.draft.invoice}`}
                    onPress={() => remove(row.draft)}
                  />
                </span>
              ) : null,
          },
        ]}
      />
    </Carte>
  );
}
