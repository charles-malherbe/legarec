import { ROLE_LABELS, role as roleSchema, type Member, type Role } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';

const MISSIONS: Record<Role, string> = {
  DEVELOPER: 'Administration technique de la plateforme.',
  DIRECTOR: 'Pilotage global et décisions stratégiques.',
  COLLECTION_MANAGER: 'Encadrement de l’équipe et validation des actions sensibles.',
  CLAIMS_OFFICER: 'Traitement des dossiers au quotidien.',
  CREDITOR: 'Accès en lecture à ses dossiers, dépôt de créances, messagerie avec le gestionnaire.',
};
const STAFF: Role[] = ['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR', 'DEVELOPER'];

/** Support and administration of one account. */
export function MemberDetail({ item, canManage, canSupport }: { item: Member; canManage: boolean; canSupport: boolean }) {
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [role, setRole] = useState(item.role);
  const [taken, setTaken] = useState('');
  const name = `${item.firstName} ${item.lastName}`;
  const recap = [
    { k: 'Compte', v: name },
    { k: 'Adresse', v: item.email },
  ];
  const act = (action: 'reset-link' | 'require-2fa' | 'enable', title: string, body: string, confirmLabel: string, message: string) =>
    confirm({
      title,
      body,
      details: recap,
      confirmLabel,
      onConfirm: async () => {
        setTaken('');
        try {
          await change(`/members/${item.id}/${action}`);
          toast({ message });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          setTaken((error.body as { holder?: string }).holder ?? 'une autre personne');
        }
      },
    });
  const saveRole = () =>
    confirm({
      title: `Changer le rôle de ${name} ?`,
      body: 'Les accès changent à sa prochaine action. Un rôle unique doit d’abord être retiré à son titulaire.',
      details: [...recap, { k: 'Rôle actuel', v: ROLE_LABELS[item.role] }, { k: 'Nouveau rôle', v: ROLE_LABELS[role] }],
      confirmLabel: 'Changer le rôle',
      onConfirm: async () => {
        setTaken('');
        try {
          await change(`/members/${item.id}/role`, { method: 'PUT', body: { role } });
          toast({ message: 'Rôle modifié.' });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          setTaken((error.body as { holder?: string }).holder ?? 'une autre personne');
        }
      },
    });
  const editableRole = canManage && item.role !== 'CREDITOR' && item.role !== 'DIRECTOR' && item.id !== user.userId && item.status === 'ACTIVE';
  const heading = useRef<HTMLDivElement>(null);
  // The detail opens below the list: bring the keyboard to it.
  useEffect(() => heading.current?.focus(), []);
  return (
    <div ref={heading} tabIndex={-1} role="region" aria-label={`Compte de ${name}`}>
      <Carte title={name} description={item.email}>
        <div className={layout.stack}>
          <div className={layout.inline}>
            <Badge label={ROLE_LABELS[item.role]} tone="marine" />
            {item.creditor && <Badge label={item.creditor} />}
          </div>
          <p className={layout.muted}>{MISSIONS[item.role]}</p>
          {editableRole && (
            <div className={layout.form}>
              <Champ
                label="Rôle"
                type="select"
                value={role}
                options={STAFF.map((value) => ({ value, label: ROLE_LABELS[value] }))}
                onChange={(value) => setRole(roleSchema.parse(value))}
              />
              <Bouton variant="secondary" label="Changer le rôle" disabled={role === item.role} onPress={saveRole} />
            </div>
          )}
          {taken && <Alerte tone="danger" text={`Ce rôle est unique et déjà attribué à ${taken}. Retirez-le d’abord à son titulaire.`} />}
          <dl className={layout.facts}>
            <div>
              <dt>Double authentification</dt>
              <dd>{item.twoFactor ? 'Activée' : item.twoFactorRequired ? 'Exigée, à activer' : 'Recommandée, non activée'}</dd>
            </div>
            <div>
              <dt>Dernière connexion</dt>
              <dd>{item.lastSeen}</dd>
            </div>
            <div>
              <dt>Sessions ouvertes</dt>
              <dd>{item.sessions}</dd>
            </div>
          </dl>
          {canSupport && item.status === 'ACTIVE' && !(item.role === 'DIRECTOR' && user.role === 'COLLECTION_MANAGER') && (
            <div className={layout.inline}>
              <Bouton
                variant="secondary"
                size="sm"
                label="Envoyer un lien de réinitialisation"
                onPress={() =>
                  act(
                    'reset-link',
                    `Envoyer un lien de réinitialisation à ${name} ?`,
                    'Le lien est valable 1 heure et à usage unique.',
                    'Envoyer le lien',
                    'Lien de réinitialisation envoyé.',
                  )
                }
              />
              {!item.twoFactorRequired && (item.role !== 'DIRECTOR' || user.role === 'DIRECTOR') && (
                <Bouton
                  variant="secondary"
                  size="sm"
                  label="Exiger la 2FA"
                  onPress={() =>
                    act(
                      'require-2fa',
                      `Exiger la double authentification de ${name} ?`,
                      'Elle sera demandée à sa prochaine connexion.',
                      'Exiger la 2FA',
                      'Double authentification exigée.',
                    )
                  }
                />
              )}
            </div>
          )}
          {canManage && item.status === 'DISABLED' && (
            <div>
              <Bouton
                variant="secondary"
                size="sm"
                label="Réactiver le compte"
                onPress={() =>
                  act('enable', `Réactiver le compte de ${name} ?`, 'Le compte retrouve son accès, sans ses anciens dossiers.', 'Réactiver', 'Compte réactivé.')
                }
              />
            </div>
          )}
          {(user.role === 'DIRECTOR' || user.role === 'DEVELOPER') && (
            <Link to="/parametres/techniques/audit" className={layout.link}>
              Voir le journal d’audit →
            </Link>
          )}
          {item.activity.length > 0 && (
            <div className={layout.tightStack}>
              <span className={layout.muted}>Activité récente</span>
              {item.activity.map((entry) => (
                <span key={entry.what + entry.when} className={layout.hint}>
                  {entry.what} · {entry.when}
                </span>
              ))}
            </div>
          )}
        </div>
      </Carte>
    </div>
  );
}
