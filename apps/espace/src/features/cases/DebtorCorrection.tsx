import { DEBTOR_KIND_LABELS, debtorCorrection, type CaseDetail } from '@legarec/contracts';
import { Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState } from 'react';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';

type Kind = keyof typeof DEBTOR_KIND_LABELS;

/**
 * The name and the kind of the debtor, corrected by the Director or the manager (question 138). It changes in all the cases
 * of the debtor, for all the creditors: confirmed first. A debtor with a SIREN is never an individual.
 */
export function DebtorCorrection({ data, onClose }: { data: CaseDetail; onClose: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const known = data.correctable!;
  const [name, setName] = useState(known.name);
  const [kind, setKind] = useState<Kind>(known.kind);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const kinds = (Object.keys(DEBTOR_KIND_LABELS) as Kind[]).filter((option) => !known.hasSiren || option !== 'INDIVIDUAL');

  const submit = () => {
    const parsed = debtorCorrection.safeParse({ kind, name, seen: known.name });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    const body = parsed.data;
    confirm({
      title: 'Corriger le débiteur ?',
      body: 'Le nom et le type changent dans tous les dossiers de ce débiteur, chez tous les créanciers. La correction est notée dans le journal d’audit.',
      confirmLabel: 'Corriger le débiteur',
      details: [
        { k: 'Ancien nom', v: known.name },
        { k: 'Nouveau nom', v: body.name },
        { k: 'Type', v: DEBTOR_KIND_LABELS[body.kind] },
      ],
      onConfirm: async () => {
        try {
          await change(`/cases/${data.id}/debtor`, { method: 'PUT', body });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          return toast({ message: 'Le débiteur vient d’être modifié : vérifiez son nom avant de le corriger.', tone: 'danger' });
        }
        toast({ message: 'Débiteur corrigé.' });
        onClose();
      },
    });
  };
  return (
    <Carte title="Corriger le débiteur" description="Nom et type, pour tous ses dossiers" actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ label="Nom du débiteur" required value={name} error={errors.name} onChange={setName} />
          <Champ
            label="Type de débiteur"
            type="select"
            value={kind}
            error={errors.kind}
            options={kinds.map((option) => ({ value: option, label: DEBTOR_KIND_LABELS[option] }))}
            onChange={(value) => setKind(value as Kind)}
          />
        </div>
        <div className={layout.end}>
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton label="Corriger le débiteur" onPress={submit} />
        </div>
      </div>
    </Carte>
  );
}
