import { accessCodeResponse } from '@legarec/contracts';
import { Bouton, Carte, EtatListe, useConfirm, useToast } from '@legarec/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

/**
 * The code is shown in clear to those who may act on the case (decision of 24/11/2026).
 * It is read on its own and leaves the cache with the card: no other answer ever holds it.
 */
export function AccessCodeCard({ caseId }: { caseId: string }) {
  const client = useQueryClient();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const key = [`/cases/${caseId}/access-code`];
  const { data, error, refetch } = useQuery({ queryKey: key, queryFn: () => api(accessCodeResponse, `/cases/${caseId}/access-code`), gcTime: 0 });
  const regenerate = () =>
    confirm({
      tone: 'danger',
      title: 'Régénérer le code d’accès ?',
      body: 'L’ancien code ne fonctionnera plus. Le nouveau code est imprimé sur les prochains courriers ; il figure aussi dans les relances par e-mail, et n’est donné par téléphone que sur demande.',
      confirmLabel: 'Régénérer le code',
      details: [{ k: 'Effet', v: 'Ancien code inutilisable, accès débloqué' }],
      onConfirm: async () => {
        try {
          await change(`/cases/${caseId}/access-code/regenerate`, { body: { version: data?.version } });
        } catch (failure) {
          if (!(failure instanceof ApiError) || failure.status !== 409) throw failure;
          await client.invalidateQueries({ queryKey: key });
          return toast({ message: 'Le code vient de changer : vérifiez celui qui s’affiche.', tone: 'danger' });
        }
        await client.invalidateQueries({ queryKey: key });
        toast({ message: 'Code d’accès régénéré.' });
      },
    });
  return (
    <Carte title="Espace débiteur">
      {!data ? (
        <EtatListe kind={error ? 'error' : 'loading'} compact onAction={() => void refetch()} />
      ) : (
        <div className={layout.stack}>
          <div className={layout.between}>
            <span className={layout.muted}>Code d’accès</span>
            <strong className={layout.num} aria-live="polite" aria-label={data.code ? `Code ${data.code.split('').join(' ')}` : 'Code illisible'} role="status">
              {data.code ?? (data.closed ? 'Illisible' : 'Illisible : régénérez-le')}
            </strong>
          </div>
          {data.closed ? (
            <p className={layout.muted}>Dossier clos : le code ne peut plus être régénéré d’ici.</p>
          ) : (
            <div>
              <Bouton variant="danger-outline" size="sm" label="Régénérer" ariaLabel="Régénérer le code d’accès" onPress={regenerate} />
            </div>
          )}
        </div>
      )}
    </Carte>
  );
}
