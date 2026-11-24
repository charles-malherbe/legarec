import { membersData, role as roleSchema, ROLE_LABELS, UNIQUE_ROLES, type Member, type Role } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Champ, EtatListe, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';

const STATUS = { ACTIVE: ['Actif', 'success'], INVITED: ['Invitation envoyée', 'info'], DISABLED: ['Désactivé', 'neutral'] } as const;
const STAFF: Role[] = ['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR', 'DEVELOPER'];

/** Accounts of the firm. Unique roles are refused by the API when someone already holds them. */
export function MembersCard() {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, error, refetch } = useApi(membersData, '/members');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [extension, setExtension] = useState('');
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  const manager = data.members.find((item) => item.role === 'COLLECTION_MANAGER' && item.status === 'ACTIVE');
  const disable = (item: Member) =>
    confirm({
      tone: 'danger',
      title: `Désactiver le compte de ${item.firstName} ${item.lastName} ?`,
      body: 'Le compte est désactivé (jamais supprimé). Ses dossiers sont réattribués par le Responsable, le mot de passe de sa boîte OVH est retiré et l’historique est conservé.',
      confirmLabel: 'Désactiver',
      reasonLabel: 'Motif',
      details: [
        { k: 'Collaborateur', v: `${item.firstName} ${item.lastName}` },
        { k: 'Rôle', v: ROLE_LABELS[item.role] },
        { k: 'Dossiers à réattribuer', v: `${item.cases}${manager ? ` → ${manager.firstName} ${manager.lastName}` : ''}` },
      ],
      onConfirm: async (reason) => {
        await change(`/members/${item.id}/disable`, { body: { reason } });
        toast({ message: 'Compte désactivé, dossiers remis au Responsable.' });
      },
    });
  const cancelInvite = (item: Member) =>
    confirm({
      tone: 'danger',
      title: 'Annuler cette invitation ?',
      body: 'Le lien envoyé ne fonctionnera plus.',
      confirmLabel: 'Annuler l’invitation',
      details: [{ k: 'Adresse', v: item.email }],
      onConfirm: async () => {
        await change(`/members/${item.id}`, { method: 'DELETE' });
        toast({ message: 'Invitation annulée.' });
      },
    });
  const saveExtension = async () => {
    if (!editing) return;
    const before = editing.extension;
    await change(`/members/${editing.id}/extension`, { method: 'PUT', body: { extension: extension.trim() || null } });
    toast({ message: 'Poste 3CX enregistré.', undo: () => void change(`/members/${editing.id}/extension`, { method: 'PUT', body: { extension: before } }) });
    setEditing(null);
  };
  return (
    <Carte
      title="Collaborateurs"
      description="Rôles uniques : Directeur, Responsable du recouvrement, Développeur"
      padding="none"
      actionLabel={data.canInvite ? (inviting ? 'Fermer' : '+ Inviter') : undefined}
      onAction={() => setInviting(!inviting)}
    >
      {inviting && <InviteForm onDone={() => setInviting(false)} />}
      <Tableau
        caption="Collaborateurs"
        hideCaption
        tight
        bordered={false}
        rows={data.members}
        rowId={(row) => row.id}
        columns={[
          { key: 'name', label: 'Collaborateur', value: (row) => ({ text: `${row.firstName} ${row.lastName}`, sub: row.email, strong: true }) },
          { key: 'role', label: 'Rôle', value: (row) => ({ text: ROLE_LABELS[row.role], sub: UNIQUE_ROLES.includes(row.role) ? 'rôle unique' : undefined }) },
          {
            key: 'extension',
            label: 'Poste 3CX',
            render: (row) =>
              editing?.id === row.id ? (
                <span className={layout.inline}>
                  <Champ
                    label={`Poste de ${row.firstName}`}
                    hideLabel
                    value={extension}
                    inputMode="numeric"
                    maxLength={5}
                    onChange={setExtension}
                    layout={{ width: 80 }}
                  />
                  <Bouton size="sm" label="Enregistrer" onPress={() => void saveExtension()} />
                </span>
              ) : (
                <span className={layout.inline}>
                  {row.extension ?? 'Standard seul'}
                  {data.canEditExtension && row.status === 'ACTIVE' && (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Modifier"
                      ariaLabel={`Modifier le poste de ${row.firstName} ${row.lastName}`}
                      onPress={() => {
                        setEditing(row);
                        setExtension(row.extension ?? '');
                      }}
                    />
                  )}
                </span>
              ),
          },
          {
            key: '2fa',
            label: 'Double authentification',
            render: (row) => (
              <Badge
                label={row.twoFactor ? 'Activée' : row.role === 'DEVELOPER' ? 'Obligatoire' : 'Non activée'}
                tone={row.twoFactor ? 'success' : row.role === 'DEVELOPER' ? 'danger' : 'neutral'}
              />
            ),
          },
          { key: 'status', label: 'État', render: (row) => <Badge label={STATUS[row.status][0]} tone={STATUS[row.status][1]} /> },
          {
            key: 'actions',
            label: 'Actions',
            render: (row) =>
              data.canDisable && row.status === 'ACTIVE' && row.role !== 'DIRECTOR' ? (
                <Bouton
                  variant="danger-outline"
                  size="sm"
                  label="Désactiver"
                  ariaLabel={`Désactiver ${row.firstName} ${row.lastName}`}
                  onPress={() => disable(row)}
                />
              ) : data.canInvite && row.status === 'INVITED' ? (
                <Bouton
                  variant="secondary"
                  size="sm"
                  label="Annuler"
                  ariaLabel={`Annuler l’invitation de ${row.firstName} ${row.lastName}`}
                  onPress={() => cancelInvite(row)}
                />
              ) : (
                <span className={layout.hint}>{row.lastSeen}</span>
              ),
          },
        ]}
      />
    </Carte>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('CLAIMS_OFFICER');
  const [taken, setTaken] = useState<string | null>(null);
  const valid = firstName.trim() && lastName.trim() && /^[^\s@]+@legarec\.fr$/i.test(email.trim());
  const submit = () =>
    confirm({
      title: 'Envoyer cette invitation ?',
      body: 'La personne reçoit un lien valable 72 heures pour choisir son mot de passe.',
      confirmLabel: 'Envoyer l’invitation',
      details: [
        { k: 'Nom', v: `${firstName} ${lastName}` },
        { k: 'Adresse', v: email },
        { k: 'Rôle', v: ROLE_LABELS[role] },
      ],
      onConfirm: async () => {
        setTaken(null);
        try {
          await change('/members', { body: { firstName, lastName, email, role } });
          toast({ message: 'Invitation envoyée.' });
          onDone();
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) setTaken((error.body as { holder?: string }).holder ?? 'une autre personne');
          throw error;
        }
      },
    });
  return (
    <div className={layout.stack} style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
      <div className={layout.form}>
        <Champ label="Prénom" required value={firstName} onChange={setFirstName} />
        <Champ label="Nom" required value={lastName} onChange={setLastName} />
        <Champ
          label="Adresse professionnelle"
          type="email"
          required
          value={email}
          placeholder="initiales@legarec.fr"
          help="Adresse @legarec.fr. Initiales en double : ajoutez un chiffre."
          onChange={setEmail}
        />
        <Champ
          label="Rôle"
          type="select"
          value={role}
          options={STAFF.map((value) => ({ value, label: ROLE_LABELS[value] }))}
          onChange={(value) => setRole(roleSchema.parse(value))}
        />
      </div>
      {taken && <Alerte tone="danger" text={`Le rôle ${ROLE_LABELS[role]} est unique et déjà attribué à ${taken}. Retirez-le d’abord à son titulaire.`} />}
      <div className={layout.end}>
        <Bouton variant="secondary" label="Annuler" onPress={onDone} />
        <Bouton label="Envoyer l’invitation" disabled={!valid} onPress={submit} />
      </div>
    </div>
  );
}
