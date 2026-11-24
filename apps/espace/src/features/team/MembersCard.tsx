import { membersData, role as roleSchema, ROLE_LABELS, UNIQUE_ROLES, type Member, type Role } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Champ, EtatListe, Onglets, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import { matches } from '../../shared/listState';
import { MemberDetail } from './MemberDetail';
import layout from '@legarec/ui/layout.module.css';

const STATUS = { ACTIVE: ['Actif', 'success'], INVITED: ['Invitation envoyée', 'info'], DISABLED: ['Désactivé', 'neutral'] } as const;
const KINDS = [
  ['team', 'Équipe', (item: Member) => item.role !== 'CREDITOR' && item.status !== 'INVITED'],
  ['creditors', 'Créanciers', (item: Member) => item.role === 'CREDITOR' && item.status !== 'INVITED'],
  ['pending', 'Invitations', (item: Member) => item.status === 'INVITED'],
] as const;
const STAFF: Role[] = ['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR', 'DEVELOPER'];

/** Accounts of the firm. Unique roles are refused by the API when someone already holds them. */
export function MembersCard() {
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, error, refetch } = useApi(membersData, '/members');
  const [inviting, setInviting] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('team');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
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
  const kinds = KINDS.filter(([id]) => id !== 'creditors' || user.role !== 'DEVELOPER');
  const test = KINDS.find(([id]) => id === kind)?.[2] ?? (() => true);
  const rows = data.members.filter((item) => test(item) && matches(query, item.firstName, item.lastName, item.email));
  const open = data.members.find((item) => item.id === openId);
  return (
    <>
      <Carte
        title="Collaborateurs"
        description="Rôles uniques : Directeur, Responsable du recouvrement, Développeur"
        padding="none"
        actionLabel={data.canInvite ? (inviting ? 'Fermer' : '+ Inviter') : undefined}
        onAction={() => setInviting(!inviting)}
      >
        {inviting && <InviteForm creditors={data.creditors} onDone={() => setInviting(false)} />}
        <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
          <Onglets
            label="Type de compte"
            items={kinds.map(([id, label, match]) => ({ label, count: data.members.filter(match).length, selected: id === kind, pick: () => setKind(id) }))}
          />
          <Champ type="search" label="Rechercher un compte" hideLabel placeholder="Nom ou e-mail" value={query} onChange={setQuery} />
        </div>
        <Tableau
          caption="Collaborateurs"
          hideCaption
          tight
          bordered={false}
          rows={rows}
          rowId={(row) => row.id}
          activeRowId={open?.id}
          state={rows.length === 0 ? { kind: 'noresult', title: 'Aucun compte ne correspond', text: 'Modifiez la recherche ou le type de compte.' } : undefined}
          columns={[
            { key: 'name', label: 'Collaborateur', value: (row) => ({ text: `${row.firstName} ${row.lastName}`, sub: row.email, strong: true }) },
            {
              key: 'role',
              label: 'Rôle',
              value: (row) => ({ text: ROLE_LABELS[row.role], sub: row.creditor ?? (UNIQUE_ROLES.includes(row.role) ? 'rôle unique' : undefined) }),
            },
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
              key: 'open',
              label: 'Détail',
              render: (row) => (
                <Bouton
                  variant="secondary"
                  size="sm"
                  label="Gérer"
                  ariaLabel={`Gérer : ${row.firstName} ${row.lastName}`}
                  expanded={row.id === openId}
                  onPress={() => setOpenId(row.id === openId ? null : row.id)}
                />
              ),
            },
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
      {open && <MemberDetail key={`${open.id}-${open.role}`} item={open} canManage={data.canDisable} canSupport={data.canSupport} />}
    </>
  );
}

function InviteForm({ creditors, onDone }: { creditors: { id: string; name: string }[]; onDone: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('CLAIMS_OFFICER');
  const [creditorId, setCreditorId] = useState('');
  const partner = role === 'CREDITOR';
  const [taken, setTaken] = useState<string | null>(null);
  const valid =
    firstName.trim() &&
    lastName.trim() &&
    (partner ? creditorId && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim()) : /^[^\s@]+@legarec\.fr$/i.test(email.trim()));
  const submit = () =>
    confirm({
      title: 'Envoyer cette invitation ?',
      body: 'La personne reçoit un lien valable 72 heures pour choisir son mot de passe.',
      confirmLabel: 'Envoyer l’invitation',
      details: [
        { k: 'Nom', v: `${firstName} ${lastName}` },
        { k: 'Adresse', v: email },
        { k: 'Rôle', v: ROLE_LABELS[role] },
        ...(partner ? [{ k: 'Créancier', v: creditors.find((item) => item.id === creditorId)?.name ?? '' }] : []),
      ],
      onConfirm: async () => {
        setTaken(null);
        try {
          await change('/members', { body: { firstName, lastName, email, role, creditorId: partner ? creditorId : undefined } });
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
          label={partner ? 'Adresse e-mail' : 'Adresse professionnelle'}
          type="email"
          required
          value={email}
          placeholder={partner ? 'nom@entreprise.fr' : 'initiales@legarec.fr'}
          help={partner ? 'Adresse de l’interlocuteur chez le créancier.' : 'Adresse @legarec.fr. Initiales en double : ajoutez un chiffre.'}
          onChange={setEmail}
        />
        <Champ
          label="Rôle"
          type="select"
          value={role}
          options={[...STAFF, 'CREDITOR' as const].map((value) => ({ value, label: ROLE_LABELS[value] }))}
          onChange={(value) => setRole(roleSchema.parse(value))}
        />
        {partner && (
          <Champ
            label="Créancier"
            type="select"
            value={creditorId}
            options={[{ value: '', label: 'Choisir…' }, ...creditors.map((item) => ({ value: item.id, label: item.name }))]}
            onChange={setCreditorId}
          />
        )}
      </div>
      {taken && <Alerte tone="danger" text={`Le rôle ${ROLE_LABELS[role]} est unique et déjà attribué à ${taken}. Retirez-le d’abord à son titulaire.`} />}
      <div className={layout.end}>
        <Bouton variant="secondary" label="Annuler" onPress={onDone} />
        <Bouton label="Envoyer l’invitation" disabled={!valid} onPress={submit} />
      </div>
    </div>
  );
}
