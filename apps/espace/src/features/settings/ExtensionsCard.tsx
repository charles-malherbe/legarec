import { membersData, ROLE_LABELS, type Member } from '@legarec/contracts';
import { Bouton, Carte, Champ, EtatListe, Tableau, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

/**
 * Paramètres techniques › Téléphonie: the 3CX extension of each member of the team, chosen here (DECISIONS.md, 28/11/2026).
 * Same route as Équipe › Membres; the API decides who may change it.
 */
export function ExtensionsCard({ title, description }: { title: string; description: string }) {
  const change = useChange();
  const toast = useToast();
  const { data, error, refetch } = useApi(membersData, '/members');
  const [editing, setEditing] = useState<Member | null>(null);
  const [extension, setExtension] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  if (!data)
    return (
      <Carte title={title} description={description}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </Carte>
    );
  const rows = data.members.filter((item) => item.role !== 'CREDITOR' && item.status === 'ACTIVE');
  const save = async () => {
    if (!editing) return;
    const next = extension.trim();
    if (next && !/^\d{2,6}$/u.test(next)) {
      setProblem('De 2 à 6 chiffres, ou vide pour le standard seul.');
      return;
    }
    const before = editing.extension;
    await change(`/members/${editing.id}/extension`, { method: 'PUT', body: { extension: next || null } });
    toast({ message: 'Poste 3CX enregistré.', undo: () => void change(`/members/${editing.id}/extension`, { method: 'PUT', body: { extension: before } }) });
    setEditing(null);
    setProblem(undefined);
  };
  return (
    <Carte title={title} description={description} padding="none">
      <Tableau
        caption={title}
        hideCaption
        bordered={false}
        rows={rows}
        rowId={(row) => row.id}
        state={rows.length > 0 ? undefined : { kind: 'empty', title: 'Aucun collaborateur actif', text: 'Les comptes de l’équipe apparaissent ici.' }}
        columns={[
          { key: 'name', label: 'Utilisateur', value: (row) => ({ text: `${row.firstName} ${row.lastName}`, sub: ROLE_LABELS[row.role], strong: true }) },
          {
            key: 'extension',
            label: 'Poste 3CX',
            render: (row) =>
              editing?.id === row.id ? (
                <span className={layout.inline}>
                  <Champ
                    label={`Poste de ${row.firstName} ${row.lastName}`}
                    hideLabel
                    value={extension}
                    inputMode="numeric"
                    maxLength={6}
                    error={problem}
                    onChange={(next) => {
                      setExtension(next);
                      setProblem(undefined);
                    }}
                    layout={{ width: 96 }}
                  />
                  <Bouton size="sm" label="Enregistrer" ariaLabel={`Enregistrer le poste de ${row.firstName} ${row.lastName}`} onPress={() => void save()} />
                  <Bouton size="sm" variant="ghost" label="Annuler" onPress={() => setEditing(null)} />
                </span>
              ) : (
                <span className={layout.inline}>
                  {row.extension ?? 'Standard seul'}
                  {data.canEditExtension && (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Modifier"
                      ariaLabel={`Modifier le poste de ${row.firstName} ${row.lastName}`}
                      onPress={() => {
                        setEditing(row);
                        setExtension(row.extension ?? '');
                        setProblem(undefined);
                      }}
                    />
                  )}
                </span>
              ),
          },
        ]}
      />
    </Carte>
  );
}
