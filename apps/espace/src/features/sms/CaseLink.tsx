import { searchHit, type SmsThread } from '@legarec/contracts';
import { Bouton, Champ, useConfirm, useToast } from '@legarec/ui';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from '../../app/api';
import { useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';

/** An answer from an unknown number is linked to a case by hand. */
export function CaseLink({ thread, onLinked }: { thread: SmsThread; onLinked: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [search] = useDebouncedValue(query.trim(), 200);
  const { data = [] } = useQuery({
    queryKey: ['link', search],
    queryFn: () => api(z.array(searchHit), '/search', { method: 'POST', body: { query: search } }),
    enabled: search.length > 1,
  });
  const debtors = data.filter((hit) => hit.kind === 'DEBTOR');
  const link = (hit: z.infer<typeof searchHit>) =>
    confirm({
      title: `Rattacher ce numéro à ${hit.title} ?`,
      body: 'Le numéro est ajouté aux coordonnées du débiteur (à vérifier) et la conversation rejoint l’historique du dossier.',
      confirmLabel: 'Rattacher',
      details: [
        { k: 'Numéro', v: thread.phone },
        { k: 'Dossier', v: `${hit.title} · ${hit.sub}` },
      ],
      onConfirm: async () => {
        await change(`/sms/${thread.id}/link`, { body: { caseId: hit.id.replace('d:', '') } });
        toast({ message: `Conversation rattachée à ${hit.title}.` });
        onLinked();
      },
    });
  return (
    <div className={layout.stack} style={{ padding: 'var(--sp-4) var(--sp-5)', borderTop: '1px solid var(--border)' }}>
      <Champ
        label="Rattacher à un dossier"
        type="search"
        value={query}
        placeholder="Débiteur, SIRET, référence…"
        help="Numéro inconnu : vérifiez l’identité avant de rattacher."
        onChange={setQuery}
      />
      {debtors.map((hit) => (
        <div key={hit.id} className={layout.between}>
          <span className={layout.text}>
            <strong>{hit.title}</strong>
            <span className={layout.hint}>{hit.sub}</span>
          </span>
          <Bouton variant="secondary" size="sm" label="Rattacher" ariaLabel={`Rattacher à ${hit.title}`} onPress={() => link(hit)} />
        </div>
      ))}
    </div>
  );
}
