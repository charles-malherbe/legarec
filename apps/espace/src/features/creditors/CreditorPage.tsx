import { creditorDetail, formatCents, formatDate, type CaseStatus, type InvoiceState } from '@legarec/contracts';
import { toTelHref } from '@legarec/platform';
import { Badge, Bouton, Carte, EtatListe, Icone, Onglets, Tableau, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../../app/data';
import { ready } from '../../app/features';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import { STATUS_TONE } from '../dashboard/DashboardPage';
import css from './Creditors.module.css';

const INVOICE: Record<InvoiceState, { label: string; tone: Tone }> = {
  UNPAID: { label: 'Impayée', tone: 'danger' },
  PARTIAL: { label: 'Partiel', tone: 'warning' },
  DISPUTED: { label: 'Contestée', tone: 'violet' },
  REMINDED: { label: 'En relance', tone: 'info' },
  PLAN: { label: 'Échéancier', tone: 'warning' },
};
const TABS = [
  ['portfolio', 'Portefeuille'],
  ['payouts', 'Reversements'],
  ['activity', 'Activité'],
  ['mandate', 'Convention et contacts'],
] as const;
const dotTone = (status: CaseStatus | null) => (status ? STATUS_TONE[status] : undefined);

export function CreditorPage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('portfolio');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data, isPending, error, refetch } = useApi(creditorDetail, `/creditors/${id}`);
  if (isPending)
    return (
      <div className={layout.card}>
        <EtatListe kind="loading" />
      </div>
    );
  if (error || !data)
    return (
      <div className={layout.card}>
        <EtatListe kind="error" onAction={() => void refetch()} />
      </div>
    );
  const canChange = user.role === 'DIRECTOR' || user.role === 'COLLECTION_MANAGER';
  const isOpen = (debtor: string, index: number) => open[debtor] ?? index === 0;
  const allOpen = data.portfolio.every((debtor, index) => isOpen(debtor.id, index));
  return (
    <>
      <section aria-label="Créancier" className={layout.card}>
        <div className={layout.fiche}>
          <span aria-hidden className={layout.initials} data-size="lg" data-dark>
            {data.initials}
          </span>
          <div className={`${layout.text} ${layout.grow}`}>
            <span className={layout.inline}>
              <h1 className={layout.ficheTitle}>{data.name}</h1>
              <Badge label={data.statusLabel} tone={data.status === 'ACTIVE' ? 'success' : 'warning'} />
            </span>
            <p className={layout.body}>
              {data.sector} · SIREN {data.siren} · Mandat signé le {formatDate(data.mandateSince)} · Gestionnaire : {data.ownerName}
            </p>
          </div>
          <div className={layout.inline}>
            <Bouton variant="secondary" label="Importer des factures (CSV)" soon />
            <Bouton variant="secondary" label="Rapport créancier" soon />
            {canChange && <Bouton label="+ Ajouter un débiteur" href={`/debiteurs/nouveau?creancier=${data.id}`} />}
          </div>
        </div>
        <dl className={layout.figures}>
          {(
            [
              ['Débiteurs', data.debtors],
              ['Factures impayées', data.invoices],
              ['Encours confié', formatCents(data.outstanding)],
              ['Recouvré en 2026', formatCents(data.recovered)],
              ['Taux de recouvrement', `${data.rate} %`],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className={layout.tabs}>
          <Onglets
            variant="underline"
            label="Sections du créancier"
            items={TABS.map(([key, label]) => ({ label, selected: key === tab, pick: () => setTab(key) }))}
          />
        </div>
      </section>
      <div className={layout.columns}>
        {tab !== 'mandate' && (
          <div className={layout.wide}>
            {tab === 'portfolio' && (
              <Carte
                title="Débiteurs et factures"
                description="Dépliez un débiteur pour voir ses factures impayées"
                padding="none"
                actionLabel={allOpen ? 'Tout replier' : 'Tout déplier'}
                onAction={() => setOpen(Object.fromEntries(data.portfolio.map((debtor) => [debtor.id, !allOpen])))}
                footer={
                  <>
                    {data.portfolio.length} débiteurs affichés sur {data.totalDebtors} ·{' '}
                    <Link to="/debiteurs" className={layout.link}>
                      Voir tous les débiteurs de ce créancier →
                    </Link>
                  </>
                }
              >
                <div className={css.scroll} tabIndex={0} role="region" aria-label="Débiteurs et factures">
                  <div className={css.inner}>
                    <div className={css.row} data-head>
                      <span>Débiteur</span>
                      <span>Factures</span>
                      <span className={css.right}>Montant dû</span>
                      <span className={css.right}>Retard max.</span>
                      <span>Statut</span>
                    </div>
                    {data.portfolio.map((debtor, index) => {
                      const expanded = isOpen(debtor.id, index);
                      return (
                        <div key={debtor.id} className={css.debtor}>
                          <div className={css.row}>
                            <button
                              type="button"
                              className={css.toggle}
                              aria-expanded={expanded}
                              aria-label={`Afficher les factures de ${debtor.name}`}
                              onClick={() => setOpen({ ...open, [debtor.id]: !expanded })}
                            >
                              <Icone icon={expanded ? 'chevron-down' : 'chevron-right'} size={16} />
                            </button>
                            <span className={layout.text}>
                              <Link to={`/debiteurs/${debtor.id}`} className={layout.strong}>
                                {debtor.name}
                              </Link>
                              <span className={layout.hint}>{debtor.reference}</span>
                            </span>
                            <span>
                              {debtor.invoices.length} facture{debtor.invoices.length > 1 ? 's' : ''}
                            </span>
                            <strong className={css.right}>{formatCents(debtor.amount)}</strong>
                            <span className={css.right}>{debtor.daysLate} j</span>
                            <span>
                              <Badge label={debtor.statusLabel} tone={STATUS_TONE[debtor.status]} />
                            </span>
                          </div>
                          {expanded && (
                            <div className={css.sub}>
                              <Tableau
                                caption={`Factures de ${debtor.name}`}
                                hideCaption
                                dense
                                rows={debtor.invoices}
                                rowId={(row) => row.number}
                                columns={[
                                  { key: 'number', label: 'N° facture', value: (row) => ({ text: row.number, strong: true }) },
                                  { key: 'ref', label: 'Réf. créancier', value: (row) => row.externalRef },
                                  { key: 'due', label: 'Échéance', value: (row) => formatDate(row.due) },
                                  { key: 'total', label: 'Montant TTC', align: 'right', value: (row) => formatCents(row.total) },
                                  { key: 'left', label: 'Reste dû', align: 'right', value: (row) => ({ text: formatCents(row.left), strong: true }) },
                                  {
                                    key: 'state',
                                    label: 'État',
                                    type: 'badge',
                                    value: (row) => ({ text: INVOICE[row.state].label, tone: INVOICE[row.state].tone }),
                                  },
                                ]}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Carte>
            )}
            {tab === 'payouts' && (
              <Carte
                title="Reversements"
                description="Commission de 8 % HT retenue · versement le 15 de chaque mois"
                badge={`Prochain : ${formatCents(data.nextPayout.net)}`}
                badgeTone="marine"
                padding="none"
              >
                <Tableau
                  caption="Reversements"
                  hideCaption
                  bordered={false}
                  rows={data.payouts}
                  rowId={(row) => row.id}
                  columns={[
                    { key: 'date', label: 'Date', value: (row) => ({ text: formatDate(row.date), sub: `${row.collections} encaissements` }) },
                    { key: 'gross', label: 'Encaissé', align: 'right', value: (row) => formatCents(row.gross) },
                    { key: 'fee', label: 'Commission', align: 'right', value: (row) => `− ${formatCents(row.fee)}` },
                    { key: 'net', label: 'Net reversé', align: 'right', value: (row) => ({ text: formatCents(row.net), strong: true }) },
                    {
                      key: 'pdf',
                      label: 'Relevé',
                      render: (row) => (
                        <Link to="/documents" className={layout.link} aria-label={`PDF du relevé du ${formatDate(row.date)}`}>
                          PDF
                        </Link>
                      ),
                    },
                  ]}
                />
              </Carte>
            )}
            {tab === 'activity' && (
              <Carte title="Activité sur le portefeuille" padding="none">
                <ul className={layout.list}>
                  {data.activity.map((item) => (
                    <li key={item.id}>
                      <span aria-hidden className={layout.dot} data-tone={dotTone(item.status)} />
                      <span className={layout.grow}>
                        <strong>{item.who}</strong> · {item.what}
                      </span>
                      <span className={layout.hint}>{item.when}</span>
                    </li>
                  ))}
                </ul>
              </Carte>
            )}
          </div>
        )}
        {(tab === 'portfolio' || tab === 'mandate') && (
          <aside className={layout.aside} aria-label="Mandat et contact">
            <Carte
              title="Convention de mandat"
              actionLabel={canChange ? 'Modifier' : undefined}
              actionHref={canChange ? `/creanciers/${data.id}/modifier` : undefined}
            >
              <dl className={layout.facts}>
                {data.mandateTerms.map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>{term.value}</dd>
                  </div>
                ))}
              </dl>
            </Carte>
            <Carte title="Reversements au créancier">
              <div className={layout.stack}>
                <div className={layout.text}>
                  <span className={layout.muted}>Prochain reversement · {formatDate(data.nextPayout.date)}</span>
                  <strong className={layout.num}>{formatCents(data.nextPayout.net)}</strong>
                  <span className={layout.hint}>
                    {formatCents(data.nextPayout.gross)} encaissés − {formatCents(data.nextPayout.fee)} d&apos;honoraires
                  </span>
                </div>
                <dl className={layout.facts}>
                  {data.payouts.slice(0, 3).map((item) => (
                    <div key={item.id}>
                      <dt>{formatDate(item.date)}</dt>
                      <dd>{formatCents(item.net)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Carte>
            <Carte title="Interlocuteur créancier">
              <div className={layout.stack}>
                <div className={layout.text}>
                  <strong>{data.contact.name}</strong>
                  <span className={layout.muted}>{data.contact.title}</span>
                </div>
                <a href={toTelHref(data.contact.phone)} className={layout.link}>
                  {data.contact.phone}
                </a>
                {/* An address is data: it stays plain text, readable, until the e-mails are ready. */}
                {ready('emails') ? (
                  <Link to="/e-mails" state={{ to: data.contact.email }} className={layout.link}>
                    {data.contact.email}
                  </Link>
                ) : (
                  <span>{data.contact.email}</span>
                )}
                <Badge
                  label={`Accès espace créancier : ${data.contact.portalEnabled ? 'activé' : 'non activé'}`}
                  tone={data.contact.portalEnabled ? 'success' : 'neutral'}
                  layout={{ alignSelf: 'flex-start' }}
                />
              </div>
            </Carte>
          </aside>
        )}
      </div>
    </>
  );
}
