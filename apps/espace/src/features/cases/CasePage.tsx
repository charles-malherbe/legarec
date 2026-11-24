import { caseDetail, formatCents, formatDate, type CaseDetail } from '@legarec/contracts';
import { startCall, toTelHref } from '@legarec/platform';
import { Alerte, Badge, Bouton, Carte, EtatListe, Onglets, Statut, SuggestionIA, Tableau, useToast } from '@legarec/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { STATUS_TONE } from '../dashboard/DashboardPage';
import { ApiError } from '../../app/api';
import { AccessDenied } from '../error/ErrorPage';
import { AccessCodeCard } from './AccessCodeCard';
import { CaseMessage } from './CaseMessage';
import { ExchangesCard } from './ExchangesCard';
import { GdprCard } from './GdprCard';
import { PaymentForm, PaymentsCard } from './Payments';
import { ReminderForm } from './ReminderForm';

type Tab = 'overview' | 'invoices' | 'history' | 'exchanges' | 'documents';

export function CasePage() {
  const { id = '' } = useParams();
  const { data, isPending, error, refetch } = useApi(caseDetail, `/cases/${id}`);
  if (isPending)
    return (
      <div className={layout.card}>
        <EtatListe kind="loading" />
      </div>
    );
  if (error instanceof ApiError && error.status === 403) return <AccessDenied />;
  if (error || !data)
    return (
      <div className={layout.card}>
        <EtatListe kind="error" onAction={() => void refetch()} />
      </div>
    );
  // A fresh view for each case: no revealed code nor draft may follow from one debtor to another.
  return <CaseView key={data.id} data={data} />;
}

function CaseView({ data }: { data: CaseDetail }) {
  const change = useChange();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [panel, setPanel] = useState<'reminder' | 'payment' | 'message' | null>(null);
  const [reported, setReported] = useState(false);
  const initials = data.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const tabs: [Tab, string, number?][] = [
    ['overview', 'Vue d’ensemble'],
    ['invoices', 'Factures', data.invoices.length],
    ['history', 'Historique', data.history.length],
    ['exchanges', 'Échanges', data.exchanges.length],
    ['documents', 'Documents', data.documents.length],
  ];
  const regenerate = async () => {
    await change(`/cases/${data.id}/ai-summary`);
    toast({ message: 'Synthèse régénérée.' });
  };
  const [to, setTo] = useState<string | null>(null);
  const writeEmail = (address: string | null) => {
    setTo(address);
    setTab('exchanges');
    setPanel('message');
  };
  const report = async () => {
    await change(`/cases/${data.id}/ai-summary/report`);
    setReported(true);
  };

  return (
    <>
      {!data.canAct && (
        <Alerte
          tone="info"
          title="Lecture seule"
          text={`Ce dossier est suivi par ${data.officer ?? 'un autre collaborateur'}. Vous pouvez le consulter ; votre consultation est notée dans l’historique.`}
        />
      )}
      <section aria-label="Débiteur" className={layout.card}>
        <div className={layout.fiche}>
          <span aria-hidden className={layout.initials} data-size="lg">
            {initials}
          </span>
          <div className={`${layout.text} ${layout.grow}`}>
            <span className={layout.inline}>
              <h1 className={layout.ficheTitle}>{data.name}</h1>
              <Badge label={data.daysLate === null ? data.statusLabel : `${data.statusLabel} · ${data.daysLate} j`} tone={STATUS_TONE[data.status]} />
            </span>
            <p className={layout.body}>
              Créancier :{' '}
              <Link to={`/creanciers/${data.creditorId}`} className={layout.strong}>
                {data.creditor}
              </Link>{' '}
              · {data.reference} · {data.identifier} · Réf. créancier {data.creditorRef} · Gestionnaire : {data.officer ?? 'à attribuer'}
            </p>
          </div>
          {data.canAct && (
            <div className={layout.inline}>
              <Bouton variant="secondary" label="Proposer un échéancier" href={`/echeanciers?dossier=${data.id}`} />
              <Bouton variant="secondary" label="Enregistrer un paiement" onPress={() => setPanel('payment')} expanded={panel === 'payment'} />
              <Bouton variant="secondary" label="Envoyer une relance" onPress={() => setPanel('reminder')} expanded={panel === 'reminder'} />
              <Bouton label="Appeler" icon="phone" title="Appeler le contact principal via 3CX" onPress={() => startCall(data.mainContact.phone)} />
            </div>
          )}
        </div>
        <div
          aria-label="Contacts du débiteur"
          role="group"
          className={layout.fiche}
          data-contacts
          style={{ paddingBlock: 'var(--sp-3)', borderTop: '1px solid var(--surface-3)', background: 'var(--surface-2)' }}
        >
          <span>
            <strong>{data.mainContact.name}</strong> <span className={layout.muted}>· {data.mainContact.title}, contact principal</span>
          </span>
          {data.contacts.map((contact) => (
            <span key={contact.id} className={layout.inline}>
              {data.canAct ? (
                contact.kind === 'PHONE' ? (
                  <a href={toTelHref(contact.value)} className={layout.link}>
                    {contact.value}
                  </a>
                ) : (
                  <Bouton variant="link" size="sm" label={contact.value} ariaLabel={`Écrire à ${contact.value}`} onPress={() => writeEmail(contact.value)} />
                )
              ) : (
                <span>{contact.value}</span>
              )}
              <Statut label={contact.verified ? 'Vérifié' : 'Non vérifié'} tone={contact.verified ? 'success' : 'warning'} />
            </span>
          ))}
          <span className={layout.muted}>Coordonnées synchronisées avec 3CX</span>
        </div>
        <dl className={layout.figures}>
          <div>
            <dt>Montant dû</dt>
            <dd>{formatCents(data.amount)}</dd>
          </div>
          <div>
            <dt>Principal · intérêts · frais</dt>
            <dd>
              {formatCents(data.principal)} · {formatCents(data.interest)} · {formatCents(data.fees)}
            </dd>
          </div>
          <div>
            <dt>Relances envoyées</dt>
            <dd>
              {data.remindersSent} sur {data.remindersTotal}
            </dd>
          </div>
          {data.risk && (
            <div>
              <dt>Score de risque</dt>
              <dd>
                <span className={layout.danger}>{data.risk.label}</span>
                <span className={layout.hint}> · {data.risk.reason}. Indicatif, aucune décision automatique</span>
              </dd>
            </div>
          )}
          <div>
            <dt>Prochaine action</dt>
            <dd>
              {data.nextAction} · {data.nextDate}
            </dd>
          </div>
        </dl>
        <div className={layout.tabs}>
          <Onglets
            variant="underline"
            label="Sections du dossier"
            items={tabs.map(([key, label, count]) => ({ label, count, selected: key === tab, pick: () => setTab(key) }))}
          />
        </div>
      </section>
      {data.contactLimit && data.canAct && <Alerte tone="warning" text={data.contactLimit} />}
      {panel === 'reminder' && <ReminderForm data={data} onClose={() => setPanel(null)} />}
      {panel === 'payment' && <PaymentForm data={data} onClose={() => setPanel(null)} />}
      <div className={layout.columns}>
        <div className={layout.wide}>
          {tab === 'overview' && data.aiSummary && (
            <SuggestionIA
              title="Synthèse du dossier"
              note="Rédigé par l’IA à partir de l’historique, des appels et des e-mails du dossier. À vérifier avant de s’y fier."
              facts={data.aiSummary.lines}
              headerExtra={
                <span className={layout.inline} style={{ marginLeft: 'auto' }}>
                  <span className={layout.hint}>
                    Mise à jour {data.aiSummary.updated} · d’après {data.aiSummary.events} événements (appels, e-mails, relances)
                  </span>
                  {data.canAct && (
                    <>
                      <Bouton variant="ghost" size="sm" icon="refresh" label="Régénérer" onPress={() => void regenerate()} />
                      <Bouton variant="ghost" size="sm" label="Signaler une erreur" onPress={() => void report()} />
                    </>
                  )}
                </span>
              }
            >
              {reported && (
                <span role="status" className={layout.muted}>
                  Merci : le signalement est enregistré dans le journal de l’IA et sera revu par le Responsable du recouvrement.
                </span>
              )}
            </SuggestionIA>
          )}
          {(tab === 'overview' || tab === 'invoices') && (
            <Carte title="Factures impayées" padding="none">
              <Tableau
                caption="Factures impayées"
                hideCaption
                bordered={false}
                rows={data.invoices}
                rowId={(row) => row.number}
                columns={[
                  { key: 'number', label: 'N° facture', value: (row) => ({ text: row.number, strong: true }) },
                  { key: 'issued', label: 'Émise le', value: (row) => formatDate(row.issued) },
                  { key: 'due', label: 'Échéance', value: (row) => formatDate(row.due) },
                  { key: 'amount', label: 'Montant TTC', align: 'right', value: (row) => ({ text: formatCents(row.amount), strong: true }) },
                  { key: 'late', label: 'Retard', align: 'right', render: (row) => <span className={layout.danger}>{row.daysLate} j</span> },
                ]}
              />
            </Carte>
          )}
          {tab === 'invoices' && <PaymentsCard data={data} />}
          {(tab === 'overview' || tab === 'history') && (
            <Carte title="Historique des actions">
              <ol className={layout.timeline}>
                {data.history.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden className={layout.dot} data-tone={item.tone} />
                    <span className={layout.text}>
                      <strong className={layout.strong}>{item.title}</strong>
                      <span className={layout.muted}>{item.detail}</span>
                      <span className={layout.hint}>
                        {item.date}
                        {item.actor && ` · ${item.actor}`}
                        {item.onBehalfOf && ` · pour le compte de ${item.onBehalfOf}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Carte>
          )}
          {tab === 'exchanges' && data.canAct && panel !== 'message' && (
            <div>
              <Bouton variant="secondary" icon="mail" label="Écrire un e-mail" onPress={() => writeEmail(null)} />
            </div>
          )}
          {tab === 'exchanges' && panel === 'message' && <CaseMessage key={to ?? 'main'} data={data} to={to} onClose={() => setPanel(null)} />}
          {tab === 'exchanges' && <ExchangesCard data={data} />}
          {tab === 'documents' && (
            <Carte title="Documents du dossier" padding="none" actionLabel={data.canAct ? '+ Nouveau courrier' : undefined} actionHref="/documents/rediger">
              <ul className={layout.list}>
                {data.documents.map((item) => (
                  <li key={item.id}>
                    <Badge label={item.kind} tone={item.kind === 'PDF' ? 'danger' : 'info'} />
                    <span className={`${layout.text} ${layout.grow}`}>
                      <strong className={layout.strong}>{item.name}</strong>
                      <span className={layout.muted}>{item.meta}</span>
                    </span>
                    <Link to="/documents" className={layout.link} aria-label={`Ouvrir ${item.name}`}>
                      Ouvrir
                    </Link>
                  </li>
                ))}
              </ul>
            </Carte>
          )}
        </div>
        <aside className={layout.aside} aria-label="Informations du dossier">
          <Carte title="Mandat" actionLabel="Voir le créancier" actionHref={`/creanciers/${data.creditorId}`}>
            <div className={layout.stack}>
              <div className={layout.text}>
                <strong>{data.creditor}</strong>
                <span className={layout.muted}>{data.mandate.sector}</span>
              </div>
              <dl className={layout.facts}>
                {data.mandate.terms.map((term) => (
                  <div key={term.label}>
                    <dt>{term.label}</dt>
                    <dd>{term.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Carte>
          {data.otherClaims.map((claim) => (
            <section key={claim.creditor} className={layout.notice}>
              <h2>Ce débiteur doit aussi à un autre créancier</h2>
              <span className={layout.between}>
                <span>
                  {claim.creditor} · {claim.invoices} facture{claim.invoices > 1 ? 's' : ''}
                </span>
                <strong className={layout.num}>{formatCents(claim.amount)}</strong>
              </span>
              <span className={layout.hint}>Les relances et les paiements restent séparés pour chaque créancier.</span>
            </section>
          ))}
          <Carte title="Contact principal">
            <div className={layout.stack}>
              <div className={layout.text}>
                <strong>{data.mainContact.name}</strong>
                <span className={layout.muted}>{data.mainContact.title}</span>
              </div>
              <dl className={layout.stacked}>
                <div>
                  <dt>Téléphone</dt>
                  <dd>{data.mainContact.phone}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>{data.mainContact.email}</dd>
                </div>
                <div>
                  <dt>Adresse</dt>
                  <dd>{data.mainContact.address}</dd>
                </div>
              </dl>
              {data.canAct && (
                <div className={layout.inline}>
                  <Bouton
                    variant="secondary"
                    label="Appeler"
                    ariaLabel={`Appeler ${data.mainContact.name}`}
                    onPress={() => startCall(data.mainContact.phone)}
                  />
                  <Bouton variant="secondary" label="E-mail" ariaLabel={`E-mail : ${data.mainContact.name}`} onPress={() => writeEmail(null)} />
                </div>
              )}
            </div>
          </Carte>
          <Carte title="Scénario de relance">
            <ol className={`${layout.list} ${layout.stack}`}>
              {data.scenario.map((step, index) => (
                <li key={step.label} style={{ padding: 0, border: 0 }}>
                  <span aria-hidden className={layout.step} data-state={step.state}>
                    {index + 1}
                  </span>
                  <span className={layout.text}>
                    <span>{step.label}</span>
                    <span className={layout.hint}>{step.when}</span>
                  </span>
                </li>
              ))}
            </ol>
            {data.firstLetter && (
              <p className={layout.hint}>
                Premier courrier : {data.firstLetter.reference} du {formatDate(data.firstLetter.date)}, rappelé dans chaque relance.
              </p>
            )}
          </Carte>
          {data.canAct && <AccessCodeCard caseId={data.id} />}
          {data.canAct && <GdprCard data={data} />}
        </aside>
      </div>
    </>
  );
}
