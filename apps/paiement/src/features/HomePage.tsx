import { formatCents, formatDate } from '@legarec/contracts';
import { toTelHref } from '@legarec/platform';
import { Badge, Bouton, Progression } from '@legarec/ui';
import css from '../app/Debtor.module.css';
import { useDebtor } from '../app/data';
import { useCase } from '../app/Space';

const euros = (value: number) => formatCents(value, { decimals: 'always' });

export function HomePage() {
  const item = useCase();
  const debtor = useDebtor();
  const total = item.principal + item.interest + item.indemnity;
  return (
    <div className={css.columns}>
      <div className={css.stack}>
        <section aria-labelledby="solde-titre" className={css.panel}>
          <div className={css.balance}>
            <div>
              <h2 id="solde-titre">Solde restant à régler</h2>
              <strong>{euros(item.balance)}</strong>
            </div>
            <Badge label={item.statusLabel} tone={item.statusTone} />
          </div>
          <Progression value={(item.paid / Math.max(1, total)) * 100} tone="success" label="Part du montant total réglée" />
          <dl className={css.lines}>
            <div>
              <dt>
                Principal ({item.invoices.length} facture{item.invoices.length > 1 ? 's' : ''})
              </dt>
              <dd>{euros(item.principal)}</dd>
            </div>
            {item.interest > 0 && (
              <div>
                <dt>Intérêts de retard</dt>
                <dd>{euros(item.interest)}</dd>
              </div>
            )}
            {item.indemnity > 0 && (
              <div>
                <dt>Indemnité forfaitaire ({item.invoices.length} × 40 €)</dt>
                <dd>{euros(item.indemnity)}</dd>
              </div>
            )}
            <div>
              <dt>Déjà payé</dt>
              <dd>− {euros(item.paid)}</dd>
            </div>
            <div data-total>
              <dt>Solde</dt>
              <dd>{euros(item.balance)}</dd>
            </div>
          </dl>
          <div className={css.inline}>
            <Bouton label="Voir les moyens de paiement" href="/espace/payer" />
            <Bouton variant="secondary" label="Faire une demande" href="/espace/demandes" />
          </div>
        </section>
        <section aria-labelledby="msg-titre" className={css.panel}>
          <div className={css.balance}>
            <h2 id="msg-titre">Dernier message du cabinet</h2>
            {item.unread > 0 && <Badge label={`${item.unread} non lu${item.unread > 1 ? 's' : ''}`} tone="info" />}
          </div>
          {item.lastMessage ? (
            <>
              <p>{item.lastMessage.text}</p>
              <span className={css.hint}>
                {item.lastMessage.who} · {item.lastMessage.when}
              </span>
            </>
          ) : (
            <p>Aucun message pour le moment.</p>
          )}
          <div>
            <Bouton variant="secondary" size="sm" label="Ouvrir les messages" href="/espace/messages" />
          </div>
        </section>
        {debtor.cases.length > 1 && (
          <section aria-labelledby="dossiers-titre" className={css.panel}>
            <h2 id="dossiers-titre">Vos dossiers</h2>
            <ul className={css.list}>
              {debtor.cases.map((entry) => (
                <li key={entry.id}>
                  <span className={css.text}>
                    {entry.reference}
                    <small>{entry.creditor}</small>
                  </span>
                  <span className={css.inline}>
                    {euros(entry.balance)}
                    <Badge label={entry.statusLabel} tone={entry.statusTone} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className={css.stack}>
        <section aria-labelledby="next-titre" className={css.panel}>
          <h2 id="next-titre">Prochaine échéance</h2>
          {item.next ? (
            <>
              <strong>{euros(item.next.amount)}</strong>
              <span className={css.hint}>à régler avant le {formatDate(item.next.date)}</span>
            </>
          ) : (
            <p>Aucune échéance prévue.</p>
          )}
        </section>
        <section aria-labelledby="fact-titre" className={css.panel}>
          <h2 id="fact-titre">Factures concernées</h2>
          <ul className={css.list}>
            {item.invoices.map((invoice) => (
              <li key={invoice.id}>
                <span className={css.text}>
                  {invoice.number}
                  <small>
                    Échue le {formatDate(invoice.dueOn)} · {formatCents(invoice.amount)}
                  </small>
                </span>
                <Bouton
                  variant="link"
                  size="sm"
                  label="Télécharger"
                  ariaLabel={`Télécharger la facture ${invoice.number}`}
                  disabled
                  title="Disponible avec l’API"
                />
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="aide-titre" className={css.panel}>
          <h2 id="aide-titre">Votre interlocuteur</h2>
          <span>{item.officer}</span>
          <a href={toTelHref('01 87 88 02 98')}>01 87 88 02 98</a>
          <span className={css.hint}>Du lundi au vendredi, 9 h – 19 h</span>
        </section>
      </aside>
    </div>
  );
}
