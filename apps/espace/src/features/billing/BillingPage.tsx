import {
  billingData,
  billingTotals,
  formatCents,
  formatDate,
  parseCents,
  vatNumber,
  type BillingData,
  type BillingLine,
  type BillingType,
} from '@legarec/contracts';
import { Badge, Bouton, Carte, Champ, EtatListe, PageHeader, Tableau, Toolbar, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useApi, useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';
import { listState, matches } from '../../shared/listState';
import css from './Billing.module.css';
import { CONTRACT_TERMS, TYPES } from './templates';

const TABS: [BillingType, string][] = [
  ['INVOICE', 'Factures'],
  ['QUOTE', 'Devis'],
  ['CONTRACT', 'Contrats'],
];

export function BillingPage() {
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(billingData, '/billing');
  const [creating, setCreating] = useState(true);
  const [tab, setTab] = useState<BillingType>('INVOICE');
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('all');
  const [seed, setSeed] = useState<{ key: number; type: BillingType }>({ key: 0, type: 'INVOICE' });
  const documents = data?.documents ?? [];
  const rows = documents.filter(
    (item) => item.type === tab && (client === 'all' || item.client === client) && matches(query, item.number, item.client, item.idLine, item.subject),
  );
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun document',
    emptyText: 'Créez une facture, un devis ou un contrat depuis un modèle.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  return (
    <>
      <PageHeader
        title="Facturation"
        loading={isPending}
        description="Factures, devis et contrats du cabinet envers ses créanciers et prospects · créés à partir de modèles"
        statsLabel="Facturation du cabinet"
        stats={data?.stats ?? []}
        actions={[
          { label: 'Modèles', href: '/parametres' },
          {
            label: creating ? 'Fermer la création' : '+ Créer depuis un modèle',
            primary: !creating,
            kbd: 'N',
            expanded: creating,
            onPress: () => setCreating(!creating),
          },
        ]}
      />
      {!data && (
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      )}
      {data && creating && <Creator key={`${seed.key}`} data={data} initialType={seed.type} onClose={() => setCreating(false)} />}
      <Toolbar
        label="Filtrer les documents"
        tabsLabel="Type de document"
        placeholder="N°, client, SIREN…"
        query={query}
        onQuery={setQuery}
        tabs={TABS.map(([id, label]) => ({ label, count: documents.filter((item) => item.type === id).length, selected: id === tab, pick: () => setTab(id) }))}
        filters={[
          {
            label: 'Client',
            value: client,
            options: [
              { value: 'all', label: 'Tous les clients' },
              ...[...new Set(documents.map((item) => item.client))].map((value) => ({ value, label: value })),
            ],
            onChange: setClient,
          },
        ]}
      />
      <Carte title={TABS.find(([id]) => id === tab)?.[1]} description={`${rows.length} documents`} padding="none">
        <Tableau
          caption="Documents"
          hideCaption
          tight
          bordered={false}
          rows={rows}
          rowId={(row) => row.id}
          state={state}
          columns={[
            { key: 'number', label: 'Numéro', value: (row) => ({ text: row.number, strong: true }) },
            { key: 'client', label: 'Client', value: (row) => ({ text: row.client, sub: row.idLine }) },
            { key: 'subject', label: 'Objet', value: (row) => row.subject },
            { key: 'date', label: 'Date', sortValue: (row) => row.date, value: (row) => formatDate(row.date) },
            {
              key: 'amount',
              label: tab === 'CONTRACT' ? 'Durée' : 'Montant TTC',
              align: 'right',
              value: (row) => ({ text: row.amount === null ? (row.duration ?? '—') : formatCents(row.amount, { decimals: 'always' }), strong: true }),
            },
            { key: 'status', label: 'Statut', render: (row) => <Badge label={row.status} tone={row.tone} /> },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <span className={layout.inline}>
                  <Bouton variant="secondary" size="sm" label="PDF" ariaLabel={`PDF ${row.number}`} href="/documents" />
                  <Bouton
                    variant="secondary"
                    size="sm"
                    label="Dupliquer"
                    ariaLabel={`Dupliquer ${row.number}`}
                    onPress={() => {
                      setSeed({ key: seed.key + 1, type: row.type });
                      setCreating(true);
                      toast({ message: `Copie de ${row.number} ouverte dans le créateur.` });
                    }}
                  />
                </span>
              ),
            },
          ]}
        />
      </Carte>
    </>
  );
}

function Creator({ data, initialType, onClose }: { data: BillingData; initialType: BillingType; onClose: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [type, setType] = useState(initialType);
  const [templateId, setTemplateId] = useState(TYPES[initialType].templates[0]!.id);
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '');
  const definition = TYPES[type];
  const template = definition.templates.find((item) => item.id === templateId) ?? definition.templates[0]!;
  const [lines, setLines] = useState<BillingLine[]>(template.lines);
  const [terms, setTerms] = useState(CONTRACT_TERMS);
  const client = data.clients.find((item) => item.id === clientId) ?? data.clients[0]!;
  const contract = type === 'CONTRACT';
  const parsed = lines.map((line) => ({ quantity: Number(line.quantity.replace(',', '.')) || 0, unitPrice: parseCents(line.unitPrice) ?? 0 }));
  const totals = billingTotals(parsed);
  const number = data.nextNumbers[type] ?? '';
  const term = (id: string) => terms.find((item) => item.id === id)?.value ?? '';
  const subject = contract
    ? `${template.label} entre Legarec et ${client.legal}`
    : `${template.label}${template.id === 'commission' ? ' · novembre 2026' : ''}`;
  const idLine = client.siren ? `SIREN ${client.siren} · TVA ${vatNumber(client.siren)}` : 'SIREN à renseigner (9 chiffres)';
  const money = (value: number) => formatCents(value, { decimals: 'always' });
  const choose = (next: BillingType) => {
    const first = TYPES[next].templates[0]!;
    setType(next);
    setTemplateId(first.id);
    setLines(first.lines);
  };
  const update = (index: number, patch: Partial<BillingLine>) => setLines(lines.map((line, position) => (position === index ? { ...line, ...patch } : line)));
  const save = async (draft: boolean) =>
    change('/billing', {
      body: {
        type,
        templateId: template.id,
        clientId,
        lines: contract ? [] : parsed.map((line, index) => ({ ...line, label: lines[index]?.label ?? '' })),
        terms: contract ? terms : [],
        draft,
      },
    });
  const issue = () =>
    confirm({
      title:
        type === 'INVOICE'
          ? `Émettre la facture ${number} ?`
          : type === 'QUOTE'
            ? `Envoyer le devis à ${client.name} ?`
            : 'Envoyer le contrat pour signature ?',
      body:
        type === 'INVOICE'
          ? 'Le numéro devient définitif et la facture ne peut plus être modifiée : toute correction passera par un avoir. Elle est envoyée par e-mail (Resend) et ajoutée à l’espace du créancier.'
          : type === 'QUOTE'
            ? 'Le devis est envoyé par e-mail avec un lien de signature électronique, valable 30 jours.'
            : 'Les deux signataires reçoivent un lien de signature électronique. Le contrat s’applique dès la seconde signature.',
      confirmLabel: definition.issue,
      details: contract
        ? [
            { k: 'Modèle', v: template.label },
            { k: 'Créancier', v: client.legal },
            { k: 'Signataires', v: `${client.signer} ; ${data.firm.signer}` },
            { k: 'Taux', v: term('rate') },
          ]
        : [
            { k: 'Client', v: client.siren ? `${client.legal} · SIREN ${client.siren}` : client.legal },
            { k: 'Objet', v: subject },
            { k: 'Total HT', v: money(totals.net) },
            { k: 'Total TTC', v: money(totals.gross) },
          ],
      onConfirm: async () => {
        await save(false);
        toast({ message: type === 'INVOICE' ? `Facture ${number} émise.` : 'Document envoyé.' });
        onClose();
      },
    });
  return (
    <Carte
      title="Créer depuis un modèle"
      description="Choisissez le type, le modèle et le client : l'aperçu se met à jour au fur et à mesure."
      actionLabel="Fermer"
      onAction={onClose}
    >
      <div className={css.creator}>
        <div className={layout.stack}>
          <fieldset className={css.fieldset}>
            <legend>1. Type de document</legend>
            <div className={css.types}>
              {TABS.map(([id]) => (
                <button key={id} type="button" className={css.choice} aria-pressed={type === id} onClick={() => choose(id)}>
                  <strong>{TYPES[id].label}</strong>
                  <span className={layout.hint}>{TYPES[id].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className={css.fieldset}>
            <legend>2. Modèle</legend>
            {definition.templates.map((item) => (
              <label key={item.id} className={css.choice} data-on={item.id === template.id || undefined}>
                <span className={layout.inline}>
                  <input
                    type="radio"
                    name="modele"
                    checked={item.id === template.id}
                    onChange={() => {
                      setTemplateId(item.id);
                      setLines(item.lines);
                    }}
                  />
                  <strong>{item.label}</strong>
                </span>
                <span className={layout.hint}>{item.hint}</span>
              </label>
            ))}
          </fieldset>
          <Champ
            label="3. Client"
            type="select"
            value={clientId}
            options={data.clients.map((item) => ({ value: item.id, label: item.name }))}
            help={idLine}
            onChange={setClientId}
          />
          {contract ? (
            <fieldset className={css.fieldset}>
              <legend>4. Conditions</legend>
              {terms.map((item) => (
                <Champ
                  key={item.id}
                  label={item.label}
                  value={item.value}
                  onChange={(value) => setTerms(terms.map((entry) => (entry.id === item.id ? { ...entry, value } : entry)))}
                />
              ))}
            </fieldset>
          ) : (
            <fieldset className={css.fieldset}>
              <legend>4. Lignes</legend>
              {lines.map((line, index) => (
                <div key={index} className={css.line}>
                  <Champ label={`Désignation, ligne ${index + 1}`} hideLabel value={line.label} onChange={(label) => update(index, { label })} />
                  <Champ
                    label={`Quantité, ligne ${index + 1}`}
                    hideLabel
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(quantity) => update(index, { quantity })}
                  />
                  <Champ
                    label={`Prix unitaire HT, ligne ${index + 1}`}
                    hideLabel
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(unitPrice) => update(index, { unitPrice })}
                  />
                  <Bouton
                    variant="secondary"
                    icon="x"
                    iconOnly
                    label={`Supprimer la ligne ${index + 1}`}
                    onPress={() => setLines(lines.filter((_, position) => position !== index))}
                  />
                </div>
              ))}
              <div className={layout.between}>
                <Bouton
                  variant="link"
                  size="sm"
                  label="+ Ajouter une ligne"
                  onPress={() => setLines([...lines, { label: 'Nouvelle ligne', quantity: '1', unitPrice: '0' }])}
                />
                <span className={layout.hint}>Quantité · prix unitaire HT · TVA 20 %</span>
              </div>
            </fieldset>
          )}
          <div className={layout.end}>
            <Bouton
              variant="secondary"
              label="Enregistrer le brouillon"
              onPress={() => void save(true).then(() => toast({ message: `${definition.label} enregistré en brouillon pour ${client.name}.` }))}
            />
            <Bouton label={definition.issue} disabled={!contract && (lines.length === 0 || totals.net <= 0)} onPress={issue} />
          </div>
        </div>
        <article aria-label="Aperçu du document" tabIndex={0} className={css.sheet}>
          <header className={layout.between}>
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
            <span className={layout.text}>
              <strong>{definition.label}</strong>
              <span>{number} (provisoire)</span>
              <span>Paris, le 21 novembre 2026</span>
            </span>
          </header>
          <div className={css.client}>
            <strong>{client.legal}</strong>
            <span>{client.address}</span>
            <span>{idLine}</span>
          </div>
          <strong>Objet : {subject}</strong>
          {contract ? (
            <ol className={css.articles}>
              {[
                [
                  'Objet',
                  'Le créancier confie à Legarec le recouvrement amiable de ses factures impayées, transmises par import ou depuis son espace en ligne.',
                ],
                ['Rémunération', `Commission de ${term('rate')} sur les sommes effectivement encaissées, et frais d’ouverture de ${term('fee')} par dossier.`],
                ['Reversements', 'Les sommes encaissées sont reversées chaque mois, déduction faite de la commission, avec un relevé détaillé.'],
                ['Échéanciers', `Legarec peut accorder un échéancier ${term('plan')} ; au-delà, l’accord écrit du créancier est requis.`],
                ['Durée', `À compter du ${term('start')}, pour ${term('term')}, résiliable avec un préavis de ${term('notice')}.`],
                ['Données personnelles', 'Traitement des données des débiteurs : [STATUT RGPD À VALIDER].'],
              ].map(([title, text]) => (
                <li key={title}>
                  <strong>{title}.</strong> {text}
                </li>
              ))}
            </ol>
          ) : (
            <>
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
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.label}</td>
                      <td>{line.quantity}</td>
                      <td>{money(parsed[index]?.unitPrice ?? 0)}</td>
                      <td>{money(Math.round((parsed[index]?.quantity ?? 0) * (parsed[index]?.unitPrice ?? 0)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className={layout.facts}>
                <div>
                  <dt>Total HT</dt>
                  <dd>{money(totals.net)}</dd>
                </div>
                <div>
                  <dt>TVA 20 %</dt>
                  <dd>{money(totals.vat)}</dd>
                </div>
                <div>
                  <dt>Total TTC</dt>
                  <dd>{money(totals.gross)}</dd>
                </div>
              </dl>
            </>
          )}
          {contract && (
            <div className={layout.between}>
              <span className={layout.text}>
                <strong>Pour le créancier</strong>
                <span>{client.signer}</span>
                <span>Signature électronique</span>
              </span>
              <span className={layout.text}>
                <strong>Pour Legarec</strong>
                <span>{data.firm.signer}</span>
                <span>Signature électronique</span>
              </span>
            </div>
          )}
          <p className={layout.hint}>{definition.legal}</p>
        </article>
      </div>
    </Carte>
  );
}
