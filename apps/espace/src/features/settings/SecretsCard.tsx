import { newSecret, renewedSecret, secretsData, SERVICE_SECRETS, type SecretItem, type ServiceSecret } from '@legarec/contracts';
import { Badge, Bouton, Carte, Champ, EtatListe, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import css from './Settings.module.css';

const STATUS = {
  VALID: ['Valide', 'success'],
  EXPIRING: ['Expire sous 15 j', 'warning'],
  REVOKE_PENDING: ['Révocation à valider', 'danger'],
  REVOKED: ['Révoqué', 'neutral'],
} as const;
const EMPTY = { name: '', value: '', rotation: '90' };

/** Write-only: a value typed here is sent once to the API and never comes back. */
export function SecretsCard({ canEdit }: { canEdit: boolean }) {
  const { data, error, refetch } = useApi(secretsData, '/secrets');
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [renewing, setRenewing] = useState<{ item: SecretItem; value: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  const active = data.items.filter((item) => item.status !== 'REVOKED').length;
  const expiring = data.items.filter((item) => item.status === 'EXPIRING').length;
  const director = user.role === 'DIRECTOR';
  const keep = async (item: SecretItem) => {
    await change(`/secrets/${item.id}/keep`);
    toast({ message: `Révocation de ${item.name} refusée.` });
  };
  const revoke = (item: SecretItem) =>
    confirm({
      tone: 'danger',
      title: `Révoquer ${item.name} ?`,
      body: `${director ? '' : 'La révocation attend l’accord du Directeur. '}Le service ${item.service} cessera immédiatement de fonctionner jusqu’à l’ajout d’une nouvelle clé. Cette action est irréversible.`,
      details: [
        { k: 'Secret', v: item.name },
        { k: 'Service', v: item.service },
        { k: 'Environnement', v: item.environment },
      ],
      confirmLabel: director ? 'Révoquer définitivement' : 'Demander la révocation',
      onConfirm: async () => {
        await change(`/secrets/${item.id}/revoke`);
        toast({ message: director ? `${item.name} révoqué.` : 'Révocation soumise au Directeur.' });
      },
    });
  const renew = () => {
    if (!renewing) return;
    const { item, value } = renewing;
    const parsed = renewedSecret.required().safeParse({ value });
    if (!parsed.success) return setErrors({ renewed: parsed.error.issues[0]?.message ?? '' });
    setErrors({});
    confirm({
      title: `Renouveler ${item.name} ?`,
      body: `La valeur créée chez ${item.service} remplace l’ancienne dès maintenant. Elle est chiffrée et ne pourra plus être affichée.`,
      details: [
        { k: 'Secret', v: item.name },
        { k: 'Service', v: item.service },
        { k: 'Environnement', v: item.environment },
      ],
      confirmLabel: 'Renouveler la clé',
      onConfirm: async () => {
        await change(`/secrets/${item.id}/rotate`, { body: parsed.data });
        setRenewing(null);
        toast({ message: `${item.name} renouvelé.` });
      },
    });
  };
  /** Drawn by the application: nothing is typed, and nothing is lost. */
  const renewInternal = (item: SecretItem) =>
    confirm({
      title: `Renouveler ${item.name} ?`,
      body: 'L’application tire une nouvelle clé et chiffre de nouveau les données avec elle. Rien ne change pour les utilisateurs.',
      details: [
        { k: 'Clé interne', v: item.name },
        { k: 'Usage', v: item.service },
      ],
      confirmLabel: 'Renouveler la clé',
      onConfirm: async () => {
        try {
          await change(`/secrets/${item.id}/rotate`, { body: {} });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          return toast({ message: 'Le chiffrement avec la clé précédente n’est pas terminé : réessayez dans quelques minutes.', tone: 'danger' });
        }
        toast({ message: `${item.name} renouvelé.` });
      },
    });
  const submit = () => {
    if (!form) return;
    const parsed = newSecret.safeParse(form);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
    setErrors({});
    confirm({
      title: 'Enregistrer ce secret dans le coffre ?',
      body: 'La valeur est chiffrée et ne pourra plus être affichée.',
      details: [
        { k: 'Secret', v: parsed.data.name },
        { k: 'Service', v: SERVICE_SECRETS[parsed.data.name] },
      ],
      confirmLabel: 'Enregistrer dans le coffre',
      onConfirm: async () => {
        await change('/secrets', { body: parsed.data });
        setForm(null);
        toast({ message: 'Secret enregistré dans le coffre.' });
      },
    });
  };
  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((current) => (current ? { ...current, [key]: value } : current));
  return (
    <>
      <p role="note" className={layout.notice}>
        Les secrets sont chiffrés dans un coffre dédié, jamais dans le code ni dans les e-mails. Une valeur enregistrée ne peut plus être affichée : elle se
        renouvelle ou se révoque, avec une trace dans le journal d’audit.
      </p>
      <Carte
        title="Secrets enregistrés"
        description={`${active} secrets actifs · ${expiring} à renouveler bientôt`}
        actionLabel={canEdit ? 'Ajouter un secret' : undefined}
        actionIcon="plus"
        onAction={() => setForm(EMPTY)}
        padding="none"
      >
        {form && (
          <form
            className={`${layout.form} ${css.pad}`}
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Champ
              label="Nom"
              type="select"
              value={form.name}
              error={errors.name}
              options={[
                { value: '', label: 'Choisir' },
                ...Object.keys(SERVICE_SECRETS)
                  .filter((name) => !data.items.some((item) => item.name === name && item.status !== 'REVOKED'))
                  .map((name) => ({ value: name, label: name })),
              ]}
              onChange={set('name')}
            />
            <Champ label="Service" value={SERVICE_SECRETS[form.name as ServiceSecret] ?? ''} readOnly />
            <Champ label="Valeur" type="password" autocomplete="new-password" value={form.value} error={errors.value} onChange={set('value')} />
            <Champ
              label="Rotation"
              type="select"
              value={form.rotation}
              options={[
                { value: '90', label: 'Tous les 90 jours' },
                { value: '30', label: 'Tous les 30 jours' },
                { value: 'MANUAL', label: 'Manuelle' },
              ]}
              onChange={set('rotation')}
            />
            <div className={layout.end}>
              <Bouton variant="secondary" size="sm" label="Annuler" onPress={() => setForm(null)} />
              <Bouton type="submit" size="sm" label="Enregistrer dans le coffre" />
            </div>
          </form>
        )}
        {renewing && (
          <form
            className={`${layout.form} ${css.pad}`}
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              renew();
            }}
          >
            <Champ
              label={`Nouvelle valeur de ${renewing.item.name}`}
              type="password"
              autocomplete="new-password"
              help={`Créez la nouvelle clé chez ${renewing.item.service}, puis collez-la ici.`}
              value={renewing.value}
              error={errors.renewed}
              onChange={(value) => setRenewing({ ...renewing, value })}
            />
            <div className={layout.end}>
              <Bouton variant="secondary" size="sm" label="Annuler" onPress={() => setRenewing(null)} />
              <Bouton type="submit" size="sm" label="Renouveler" />
            </div>
          </form>
        )}
        <Tableau
          caption="Secrets enregistrés"
          hideCaption
          bordered={false}
          rows={data.items}
          rowId={(row) => row.id}
          columns={[
            {
              key: 'name',
              label: 'Secret',
              render: (row) => (
                <span className={layout.text}>
                  <span className={layout.strong}>{row.name}</span>
                  <span className={layout.hint}>
                    {row.service} · {row.environment} · utilisé {row.used}
                  </span>
                </span>
              ),
            },
            { key: 'value', label: 'Valeur', render: (row) => (row.status === 'REVOKED' ? '—' : 'Enregistrée, non affichable') },
            { key: 'rotated', label: 'Dernière rotation', render: (row) => row.rotated },
            { key: 'status', label: 'État', render: (row) => <Badge label={STATUS[row.status][0]} tone={STATUS[row.status][1]} /> },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) =>
                canEdit && row.internal ? (
                  <Bouton variant="secondary" size="xs" label="Renouveler" ariaLabel={`Renouveler : ${row.name}`} onPress={() => renewInternal(row)} />
                ) : canEdit && row.status !== 'REVOKED' ? (
                  <span className={layout.inline}>
                    <Bouton
                      variant="secondary"
                      size="xs"
                      label="Renouveler"
                      disabled={row.status === 'REVOKE_PENDING'}
                      ariaLabel={`Renouveler : ${row.name}`}
                      onPress={() => {
                        setErrors({});
                        setRenewing({ item: row, value: '' });
                      }}
                    />
                    <Bouton
                      variant="danger-outline"
                      size="xs"
                      label="Révoquer"
                      ariaLabel={`Révoquer : ${row.name}`}
                      disabled={row.status === 'REVOKE_PENDING' && !director}
                      onPress={() => revoke(row)}
                    />
                    {row.status === 'REVOKE_PENDING' && director && (
                      <Bouton variant="ghost" size="xs" label="Refuser" ariaLabel={`Refuser la révocation : ${row.name}`} onPress={() => void keep(row)} />
                    )}
                  </span>
                ) : null,
            },
          ]}
        />
      </Carte>
    </>
  );
}
