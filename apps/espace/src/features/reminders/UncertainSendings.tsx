import { formatDate, uncertainSendings, type UncertainSendings as Items } from '@legarec/contracts';
import { Bouton, Carte, useConfirm, useToast } from '@legarec/ui';
import { Link } from 'react-router';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

type Item = Items['items'][number];
const stepOf = (item: Item) => (item.level === null ? 'Rappel d’échéance' : `Relance par e-mail, niveau ${item.level}`);

/**
 * E-mails remis à Resend sans réponse claire, dont Resend n'a rien dit depuis 48 heures : le Responsable du recouvrement,
 * ou le Directeur sur ses dossiers, note s'ils sont partis. Rien ne s'affiche quand il n'y en a pas.
 */
export function UncertainSendings() {
  const { data } = useApi(uncertainSendings, '/sendings/uncertain');
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  if (!data || data.items.length === 0) return null;
  const settle = (item: Item, sent: boolean) =>
    confirm({
      title: sent ? 'Noter cet envoi comme parti ?' : 'Noter cet envoi comme non parti ?',
      tone: sent ? 'primary' : 'danger',
      body: sent
        ? 'À faire si Resend montre le message comme envoyé. Il compte alors comme parti le jour de la demande, pour le plafond et la relance suivante.'
        : 'À faire si Resend n’a aucune trace du message. Il ne compte plus comme parti ; une nouvelle relance pourra être demandée.',
      confirmLabel: sent ? 'Noter comme parti' : 'Noter comme non parti',
      details: [
        { k: 'Débiteur', v: item.debtor },
        { k: 'Dossier', v: item.reference },
        { k: 'Envoi', v: stepOf(item) },
        { k: 'Demandé le', v: formatDate(item.askedAt.slice(0, 10)) },
      ],
      onConfirm: async () => {
        await change(`/sendings/${item.id}/settlement`, { method: 'PUT', body: { outcome: sent ? 'SENT' : 'NOT_SENT' } });
        toast({ message: sent ? `Envoi à ${item.debtor} noté comme parti.` : `Envoi à ${item.debtor} noté comme non parti.` });
      },
    });
  return (
    <Carte
      title={`${data.items.length} envoi${data.items.length > 1 ? 's' : ''} incertain${data.items.length > 1 ? 's' : ''}`}
      description="Remis à Resend sans réponse claire, et sans nouvelle de Resend depuis 48 heures. Vérifiez dans Resend, puis notez ce qui s’est passé."
    >
      <ul className={layout.stack}>
        {data.items.map((item) => (
          <li key={item.id} className={layout.inline}>
            <span className={layout.grow}>
              <Link to={`/debiteurs/${item.caseId}`}>{item.debtor}</Link> · {item.reference} · {stepOf(item)} · demandé le {formatDate(item.askedAt.slice(0, 10))}
            </span>
            <Bouton variant="secondary" size="sm" label="Partie" ariaLabel={`Noter comme parti : ${item.debtor}`} onPress={() => settle(item, true)} />
            <Bouton variant="secondary" size="sm" label="Non partie" ariaLabel={`Noter comme non parti : ${item.debtor}`} onPress={() => settle(item, false)} />
          </li>
        ))}
      </ul>
    </Carte>
  );
}
