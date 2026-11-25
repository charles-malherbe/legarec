import { issuedPassword, mailboxesData, newMailbox, redirectionTarget, type Mailbox } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Champ, EtatListe, Progression, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import type { z } from 'zod';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import css from './Settings.module.css';

const SHARED = 'recouvrement@legarec.fr';
const DEFAULT_SIZE = 5000;
type Data = z.infer<typeof mailboxesData>;
const CONNECTION = {
  OK: ['Connectée', 'success'],
  PASSWORD_NEEDED: ['Mot de passe à mettre à jour', 'warning'],
  ERROR: ['Connexion impossible', 'danger'],
} as const;
const size = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toLocaleString('fr-FR')} Go` : `${mb} Mo`);

/** OVH MX Plan mailboxes. Every password is drawn by the API and shown once, never kept in a cache. */
export function MailboxesCard({ canEdit }: { canEdit: boolean }) {
  const { data, error, refetch } = useApi(mailboxesData, '/mailboxes');
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ address: string; password: string } | null>(null);
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  const current = data.items.find((item) => item.id === openId);
  const create = (request: Data['requests'][number]) =>
    confirm({
      title: `Créer la boîte ${request.local}@legarec.fr ?`,
      body: 'La boîte est créée chez OVH avec un mot de passe généré par l’API, affiché une seule fois.',
      details: [
        { k: 'Collaborateur', v: request.holder },
        { k: 'Demandée par', v: request.requestedBy },
        { k: 'Taille', v: size(DEFAULT_SIZE) },
      ],
      confirmLabel: 'Créer la boîte',
      onConfirm: async () => {
        setIssued({
          address: `${request.local}@legarec.fr`,
          ...(await change('/mailboxes', {
            body: { local: request.local, holderId: null, sizeMb: DEFAULT_SIZE, requestId: request.id },
            schema: issuedPassword,
          })),
        });
      },
    });
  const refuse = (request: Data['requests'][number]) =>
    confirm({
      tone: 'danger',
      title: 'Refuser cette demande de boîte ?',
      body: 'Le compte du collaborateur n’est pas touché.',
      details: [
        { k: 'Collaborateur', v: request.holder },
        { k: 'Adresse', v: `${request.local}@legarec.fr` },
      ],
      confirmLabel: 'Refuser la demande',
      onConfirm: async () => {
        await change(`/mailboxes/requests/${request.id}`, { method: 'DELETE' });
        toast({ message: 'Demande refusée.' });
      },
    });
  return (
    <>
      {issued && (
        <Alerte
          tone="warning"
          title={`Mot de passe de ${issued.address}`}
          text="Il n’est affiché qu’une seule fois : transmettez-le au collaborateur, qui le met à jour dans sa messagerie."
        >
          <div className={layout.stack}>
            <code className={css.password} data-testid="issued-password">
              {issued.password}
            </code>
            <div className={layout.inline}>
              <Bouton
                variant="secondary"
                size="sm"
                icon="copy"
                label="Copier le mot de passe"
                onPress={() => void navigator.clipboard.writeText(issued.password).then(() => toast({ message: 'Mot de passe copié.' }))}
              />
              <Bouton size="sm" label="Masquer définitivement" onPress={() => setIssued(null)} />
            </div>
          </div>
        </Alerte>
      )}
      {data.requests.length > 0 && (
        <Carte title="Demandes de boîte" description="Créées à l’invitation d’un collaborateur." padding="none">
          <ul className={layout.list}>
            {data.requests.map((request) => (
              <li key={request.id}>
                <span className={`${layout.text} ${layout.grow}`}>
                  <span className={layout.strong}>{request.local}@legarec.fr</span>
                  <span className={layout.hint}>
                    {request.holder} · demandée par {request.requestedBy}
                  </span>
                </span>
                {canEdit && (
                  <>
                    <Bouton size="sm" label="Créer la boîte" ariaLabel={`Créer la boîte ${request.local}@legarec.fr`} onPress={() => create(request)} />
                    <Bouton variant="ghost" size="sm" label="Refuser" ariaLabel={`Refuser : ${request.local}@legarec.fr`} onPress={() => refuse(request)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <Carte
        title="Boîtes e-mail"
        description="Boîtes OVH MX Plan du domaine legarec.fr. Toute action est inscrite à l’historique."
        actionLabel={canEdit ? 'Créer une boîte' : undefined}
        actionIcon="plus"
        onAction={() => setCreating(true)}
        padding="none"
      >
        {creating && <CreateForm data={data} onClose={() => setCreating(false)} onIssued={setIssued} />}
        <Tableau
          caption="Boîtes e-mail"
          hideCaption
          bordered={false}
          rows={data.items}
          rowId={(row) => row.id}
          activeRowId={current?.id}
          columns={[
            {
              key: 'address',
              label: 'Adresse',
              render: (row) => (
                <span className={layout.text}>
                  <span className={layout.strong}>{row.address}</span>
                  <span className={layout.hint}>{row.kind === 'SHARED' ? 'Boîte partagée · réception seule' : (row.holder ?? 'Adresse de fonction')}</span>
                </span>
              ),
            },
            {
              key: 'space',
              label: 'Espace utilisé',
              render: (row) => <Progression value={(row.usedMb / row.sizeMb) * 100} tone="info" label={`${size(row.usedMb)} sur ${size(row.sizeMb)}`} />,
            },
            { key: 'state', label: 'SMTP / IMAP', render: (row) => <Badge label={CONNECTION[row.connection][0]} tone={CONNECTION[row.connection][1]} /> },
            {
              key: 'manage',
              label: 'Actions',
              render: (row) => (
                <Bouton
                  variant="secondary"
                  size="xs"
                  label="Gérer"
                  ariaLabel={`Gérer : ${row.address}`}
                  expanded={row.id === openId}
                  onPress={() => setOpenId(row.id === openId ? null : row.id)}
                />
              ),
            },
          ]}
        />
      </Carte>
      {current && <Manage key={current.id} item={current} canEdit={canEdit} onIssued={setIssued} />}
      {data.history.length > 0 && (
        <Carte title="Historique des boîtes">
          <ul className={layout.list}>
            {data.history.map((item) => (
              <li key={item.id}>
                <span className={layout.text}>
                  <span className={layout.strong}>{item.what}</span>
                  <span className={layout.hint}>
                    {item.when} · {item.who}
                    {item.onBehalfOf && `, pour le compte de ${item.onBehalfOf}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Carte>
      )}
    </>
  );
}

type OnIssued = (value: { address: string; password: string }) => void;

function CreateForm({
  data,
  onClose,
  onIssued,
}: {
  data: { sizes: number[]; holders: { id: string; name: string }[] };
  onClose: () => void;
  onIssued: OnIssued;
}) {
  const change = useChange();
  const confirm = useConfirm();
  const [local, setLocal] = useState('');
  const [holderId, setHolderId] = useState('');
  const [sizeMb, setSizeMb] = useState(String(data.sizes.includes(DEFAULT_SIZE) ? DEFAULT_SIZE : (data.sizes[0] ?? DEFAULT_SIZE)));
  const [error, setError] = useState('');
  const submit = () => {
    const parsed = newMailbox.safeParse({ local: local.trim(), holderId: holderId || null, sizeMb: Number(sizeMb) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? '');
    setError('');
    const address = `${parsed.data.local}@legarec.fr`;
    confirm({
      title: `Créer la boîte ${address} ?`,
      body: 'La boîte est créée chez OVH avec un mot de passe généré par l’API, affiché une seule fois.',
      details: [
        { k: 'Adresse', v: address },
        { k: 'Rattachée à', v: data.holders.find((item) => item.id === holderId)?.name ?? 'Adresse de fonction' },
        { k: 'Taille', v: size(parsed.data.sizeMb) },
      ],
      confirmLabel: 'Créer la boîte',
      onConfirm: async () => {
        try {
          onIssued({ address, ...(await change('/mailboxes', { body: parsed.data, schema: issuedPassword })) });
          onClose();
        } catch (failure) {
          if (!(failure instanceof ApiError) || failure.status !== 409) throw failure;
          setError('Cette adresse existe déjà.');
        }
      },
    });
  };
  return (
    <form
      className={`${layout.form} ${css.pad}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Champ label="Adresse" value={local} suffix="@legarec.fr" placeholder="initiales" error={error} autocomplete="off" onChange={setLocal} />
      <Champ
        label="Collaborateur"
        type="select"
        value={holderId}
        options={[{ value: '', label: 'Adresse de fonction' }, ...data.holders.map((item) => ({ value: item.id, label: item.name }))]}
        onChange={setHolderId}
      />
      <Champ
        label="Taille"
        type="select"
        value={sizeMb}
        options={data.sizes.map((value) => ({ value: String(value), label: size(value) }))}
        onChange={setSizeMb}
      />
      <div className={layout.end}>
        <Bouton variant="secondary" size="sm" label="Annuler" onPress={onClose} />
        <Bouton type="submit" size="sm" label="Créer la boîte" />
      </div>
    </form>
  );
}

function Manage({ item, canEdit, onIssued }: { item: Mailbox; canEdit: boolean; onIssued: OnIssued }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [toError, setToError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [reply, setReply] = useState(item.autoReply?.text ?? '');
  const [until, setUntil] = useState(item.autoReply?.until ?? '');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const recap = [
    { k: 'Boîte', v: item.address },
    { k: 'Rattachée à', v: item.holder ?? 'Adresse de fonction' },
  ];
  const changePassword = (after?: () => void) =>
    confirm({
      title: `Changer le mot de passe de ${item.address} ?`,
      body: 'Le nouveau mot de passe est généré par l’API, enregistré chiffré pour l’envoi des messages et affiché une seule fois. L’ancien cesse de fonctionner.',
      details: recap,
      confirmLabel: 'Changer le mot de passe',
      onConfirm: async () => {
        onIssued({ address: item.address, ...(await change(`/mailboxes/${item.id}/password`, { schema: issuedPassword })) });
        after?.();
      },
    });
  const redirect = (target: string, id: string | null, after?: () => void) => {
    const parsed = redirectionTarget.safeParse(target.trim());
    if (!parsed.success) return setToError(parsed.error.issues[0]?.message ?? '');
    setToError('');
    confirm({
      title: id ? 'Modifier cette redirection ?' : 'Créer cette redirection ?',
      body: 'Les messages reçus sont transmis à l’adresse de destination.',
      details: [...recap, { k: 'Destination', v: parsed.data }],
      confirmLabel: id ? 'Modifier la redirection' : 'Créer la redirection',
      onConfirm: async () => {
        await change(`/mailboxes/${item.id}/redirections${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: { to: parsed.data } });
        setTo('');
        setEditing(null);
        toast({ message: 'Redirection enregistrée.' });
        after?.();
      },
    });
  };
  const dropRedirection = (id: string, target: string) =>
    confirm({
      tone: 'danger',
      title: 'Supprimer cette redirection ?',
      body: 'Les prochains messages ne seront plus transmis.',
      details: [...recap, { k: 'Destination', v: target }],
      confirmLabel: 'Supprimer la redirection',
      onConfirm: async () => {
        await change(`/mailboxes/${item.id}/redirections/${id}`, { method: 'DELETE' });
        toast({ message: 'Redirection supprimée.' });
      },
    });
  const saveReply = (text: string, end: string, after?: () => void) =>
    confirm({
      title: 'Enregistrer cette réponse automatique ?',
      body: 'Elle est envoyée à chaque personne qui écrit à cette boîte.',
      details: [...recap, { k: 'Jusqu’au', v: end || 'Sans date de fin' }],
      confirmLabel: 'Enregistrer la réponse',
      onConfirm: async () => {
        await change(`/mailboxes/${item.id}/auto-reply`, { method: 'PUT', body: { text, until: end || null } });
        toast({ message: 'Réponse automatique enregistrée.' });
        after?.();
      },
    });
  const dropReply = () =>
    confirm({
      tone: 'danger',
      title: 'Supprimer la réponse automatique ?',
      body: 'Les personnes qui écrivent à cette boîte ne recevront plus de réponse automatique.',
      details: recap,
      confirmLabel: 'Supprimer la réponse',
      onConfirm: async () => {
        await change(`/mailboxes/${item.id}/auto-reply`, { method: 'DELETE' });
        setReply('');
        setUntil('');
        toast({ message: 'Réponse automatique supprimée.' });
      },
    });
  const departureText = 'Bonjour, je ne fais plus partie du cabinet. Votre message est transmis à recouvrement@legarec.fr. Legarec, 01 87 88 02 98.';
  const mark = (step: string) => () => setDone((current) => ({ ...current, [step]: true }));
  const steps = [
    { id: 'password', label: 'Changer le mot de passe', run: () => changePassword(mark('password')) },
    { id: 'reply', label: 'Activer la réponse automatique de départ', run: () => saveReply(departureText, '', mark('reply')) },
    { id: 'redirect', label: `Rediriger vers ${SHARED}`, run: () => redirect(SHARED, null, mark('redirect')) },
  ];
  return (
    <Carte title={item.address} description={item.holder ?? (item.protected ? 'Boîte partagée' : 'Adresse de fonction')}>
      <div className={layout.stack}>
        {item.protected && (
          <Alerte
            tone="info"
            icon="lock"
            text="Boîte protégée, en réception seule : ni changement de mot de passe, ni réponse automatique depuis l’application."
          />
        )}
        {!canEdit && <Alerte tone="neutral" icon="lock" text="Lecture seule." />}
        <h3 className={layout.ficheTitle}>Redirections</h3>
        {item.redirections.length === 0 && <p className={layout.muted}>Aucune redirection.</p>}
        <ul className={layout.list}>
          {item.redirections.map((entry) => (
            <li key={entry.id}>
              <span className={`${layout.strong} ${layout.grow}`}>{entry.to}</span>
              {canEdit && (
                <span className={layout.inline}>
                  <Bouton
                    variant="secondary"
                    size="xs"
                    label="Modifier"
                    ariaLabel={`Modifier : ${entry.to}`}
                    onPress={() => {
                      setEditing(entry.id);
                      setTo(entry.to);
                    }}
                  />
                  <Bouton
                    variant="danger-outline"
                    size="xs"
                    label="Supprimer"
                    ariaLabel={`Supprimer : ${entry.to}`}
                    onPress={() => dropRedirection(entry.id, entry.to)}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className={layout.form}
            onSubmit={(event) => {
              event.preventDefault();
              redirect(to, editing);
            }}
          >
            <Champ label={editing ? 'Nouvelle destination' : 'Rediriger vers'} type="email" value={to} error={toError} onChange={setTo} />
            <Bouton type="submit" variant="secondary" size="sm" label={editing ? 'Modifier la redirection' : 'Créer la redirection'} />
          </form>
        )}
        {!item.protected && (
          <>
            <h3 className={layout.ficheTitle}>Réponse automatique</h3>
            <Champ label="Texte de la réponse" type="textarea" value={reply} disabled={!canEdit} onChange={setReply} />
            <Champ label="Jusqu’au" type="date" optional value={until} disabled={!canEdit} onChange={setUntil} />
            {canEdit && (
              <div className={layout.inline}>
                <Bouton
                  variant="secondary"
                  size="sm"
                  label="Enregistrer la réponse automatique"
                  disabled={!reply.trim()}
                  onPress={() => saveReply(reply, until)}
                />
                {item.autoReply && <Bouton variant="danger-outline" size="sm" label="Supprimer la réponse automatique" onPress={dropReply} />}
              </div>
            )}
          </>
        )}
        {canEdit && !item.protected && (
          <>
            <h3 className={layout.ficheTitle}>Mot de passe</h3>
            <div>
              <Bouton variant="secondary" size="sm" icon="key" label="Changer le mot de passe" onPress={() => changePassword()} />
            </div>
            <h3 className={layout.ficheTitle}>Départ du collaborateur</h3>
            <p className={layout.muted}>Trois étapes, chacune confirmée. Le compte se désactive ensuite depuis Équipe.</p>
            <ol className={layout.list}>
              {steps.map((step, index) => (
                <li key={step.id}>
                  <span className={`${layout.strong} ${layout.grow}`}>
                    {index + 1}. {step.label}
                  </span>
                  {done[step.id] ? (
                    <Badge label="Fait" tone="success" />
                  ) : (
                    <Bouton
                      variant="secondary"
                      size="xs"
                      label="Lancer l’étape"
                      ariaLabel={`Lancer l’étape : ${step.label}`}
                      disabled={steps.slice(0, index).some((entry) => !done[entry.id])}
                      onPress={step.run}
                    />
                  )}
                </li>
              ))}
            </ol>
            <p className={layout.hint}>La suppression d’une boîte se fait dans l’espace client OVH.</p>
          </>
        )}
      </div>
    </Carte>
  );
}
