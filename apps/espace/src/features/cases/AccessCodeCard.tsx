import { accessCodeResponse } from '@legarec/contracts';
import { Bouton, Carte, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';

/** The code stays masked; each reveal is written to the case history by the API. */
export function AccessCodeCard({ caseId }: { caseId: string }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [code, setCode] = useState<string | null>(null);
  const reveal = async () => setCode((await change(`/cases/${caseId}/access-code/reveal`, { schema: accessCodeResponse })).code);
  const regenerate = () =>
    confirm({
      tone: 'danger',
      title: 'Régénérer le code d’accès ?',
      body: 'L’ancien code ne fonctionnera plus. Le nouveau code est imprimé sur les prochains courriers ; il n’est jamais envoyé par e-mail.',
      confirmLabel: 'Régénérer le code',
      details: [{ k: 'Effet', v: 'Ancien code inutilisable, accès débloqué' }],
      onConfirm: async () => {
        await change(`/cases/${caseId}/access-code/regenerate`);
        setCode(null);
        toast({ message: 'Code d’accès régénéré.' });
      },
    });
  return (
    <Carte title="Espace débiteur">
      <div className={layout.stack}>
        <div className={layout.between}>
          <span className={layout.muted}>Code d’accès</span>
          <strong className={layout.num} aria-live="polite" aria-label={code ? `Code ${code.split('').join(' ')}` : 'Code masqué'} role="status">
            {code ?? '••••'}
          </strong>
        </div>
        <div className={layout.inline}>
          {code ? (
            <Bouton variant="secondary" size="sm" label="Masquer" onPress={() => setCode(null)} />
          ) : (
            <Bouton variant="secondary" size="sm" icon="eye" label="Afficher" ariaLabel="Afficher le code d’accès" onPress={() => void reveal()} />
          )}
          <Bouton variant="danger-outline" size="sm" label="Régénérer" ariaLabel="Régénérer le code d’accès" onPress={regenerate} />
        </div>
        <span className={layout.hint}>Chaque affichage est noté dans l’historique.</span>
      </div>
    </Carte>
  );
}
