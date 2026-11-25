import { GDPR_LABELS, gdprRequestKind, type CaseDetail } from '@legarec/contracts';
import { Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

export function GdprCard({ data }: { data: CaseDetail }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [kind, setKind] = useState<(typeof gdprRequestKind.options)[number]>('ACCESS');
  const submit = () =>
    confirm({
      title: 'Enregistrer cette demande RGPD ?',
      body: 'La demande est inscrite au registre, avec un délai de réponse d’un mois.',
      confirmLabel: 'Enregistrer la demande',
      details: [
        { k: 'Débiteur', v: data.name },
        { k: 'Demande', v: GDPR_LABELS[kind] },
      ],
      reasonLabel: 'Comment la demande a-t-elle été reçue ?',
      onConfirm: async (reason) => {
        await change('/gdpr/requests', { body: { caseId: data.id, kind, origin: reason } });
        toast({ message: 'Demande ajoutée au registre des données personnelles.' });
      },
    });
  return (
    <Carte title="Données personnelles">
      <div className={layout.stack}>
        <Champ
          label="Demande RGPD"
          type="select"
          value={kind}
          options={gdprRequestKind.options.map((value) => ({ value, label: GDPR_LABELS[value] }))}
          onChange={(value) => setKind(gdprRequestKind.parse(value))}
        />
        <Bouton variant="secondary" size="sm" label="Enregistrer une demande RGPD" onPress={submit} />
      </div>
    </Carte>
  );
}
