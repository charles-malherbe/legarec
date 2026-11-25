import { newSecret, secretsData, type SecretItem } from '@legarec/contracts';
import { Badge, Bouton, Carte, Champ, EtatListe, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
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
const EMPTY = { name: '', service: '', value: '', rotation: '90' };

/** Write-only: a value typed here is sent once to the API and never comes back. */
export function SecretsCard({ canEdit }: { canEdit: boolean }) {
  const { data, error, refetch } = useApi(secretsData, '/secrets');
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
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
  const ask = (item: SecretItem, action: 'rotate' | 'revoke') =>
    confirm({
      tone: action === 'revoke' ? 'danger' : 'primary',
      title: action === 'revoke' ? `Révoquer ${item.name} ?` : `Renouveler ${item.name} ?`,
      body:
        action === 'revoke'
          ? `${director ? '' : 'La révocation attend l’accord du Directeur. '}Le service ${item.service} cessera immédiatement de fonctionner jusqu’à l’ajout d’une nouvelle clé. Cette action est irréversible.`
          : `Une nouvelle valeur est générée chez ${item.service} et déployée. L’ancienne reste valable 24 h pour éviter toute coupure.`,
      details: [
        { k: 'Secret', v: item.name },
        { k: 'Service', v: item.service },
        { k: 'Environnement', v: item.environment },
      ],
      confirmLabel: action === 'revoke' ? (director ? 'Révoquer définitivement' : 'Demander la révocation') : 'Renouveler la clé',
      onConfirm: async () => {
        await change(`/secrets/${item.id}/${action}`);
        toast({ message: action === 'revoke' ? (director ? `${item.name} révoqué.` : 'Révocation soumise au Directeur.') : `${item.name} renouvelé.` });
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
        { k: 'Service', v: parsed.data.service },
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
            <Champ label="Nom" placeholder="EX_NOM_DU_SECRET" value={form.name} error={errors.name} mono onChange={set('name')} />
            <Champ label="Service" placeholder="Ex. : Resend" value={form.service} error={errors.service} onChange={set('service')} />
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
                canEdit && row.status !== 'REVOKED' ? (
                  <span className={layout.inline}>
                    <Bouton variant="secondary" size="xs" label="Renouveler" ariaLabel={`Renouveler : ${row.name}`} onPress={() => ask(row, 'rotate')} />
                    <Bouton
                      variant="danger-outline"
                      size="xs"
                      label="Révoquer"
                      ariaLabel={`Révoquer : ${row.name}`}
                      disabled={row.status === 'REVOKE_PENDING' && !director}
                      onPress={() => ask(row, 'revoke')}
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
