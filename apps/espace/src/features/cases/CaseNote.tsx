import { caseNote } from '@legarec/contracts';
import { Bouton, Champ, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState } from 'react';
import { useChange } from '../../app/data';

/** « + Ajouter une note » of the history: kept from the creditor, noted in the audit without its text. */
export function CaseNote({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const change = useChange();
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    const parsed = caseNote.safeParse({ text });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    await change(`/cases/${caseId}/notes`, { body: parsed.data });
    toast({ message: 'Note ajoutée à l’historique.' });
    onClose();
  };
  return (
    <form
      className={layout.stack}
      aria-label="Ajouter une note"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Champ label="Note" type="textarea" required help="Visible de l’équipe seulement, jamais du créancier." value={text} error={error} onChange={setText} />
      <div className={layout.end}>
        <Bouton variant="secondary" label="Annuler" onPress={onClose} />
        <Bouton type="submit" label="Ajouter la note" />
      </div>
    </form>
  );
}
