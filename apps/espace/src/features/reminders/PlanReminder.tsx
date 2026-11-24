import { newReminder, REMINDER_LABELS, reminderPlanned, reminderTargets } from '@legarec/contracts';
import { Bouton, Carte, Champ, EtatListe, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState } from 'react';
import { useApi, useChange } from '../../app/data';

const TYPES = ['CALL', 'EMAIL', 'SMS', 'LETTER'] as const;

/** Adds a manual reminder to the agenda; nothing is sent before its own confirmation. */
export function PlanReminder({ date: initialDate, onDone }: { date: string; onDone: (date: string) => void }) {
  const { data, error, refetch } = useApi(reminderTargets, '/reminders/targets');
  const change = useChange();
  const toast = useToast();
  const [form, setForm] = useState({ caseId: '', type: 'CALL' as (typeof TYPES)[number], date: initialDate, time: '', title: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!data)
    return (
      <Carte title="Planifier une relance">
        <EtatListe kind={error ? 'error' : 'loading'} compact onAction={() => void refetch()} />
      </Carte>
    );
  const submit = async () => {
    const parsed = newReminder.safeParse(form);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
    setErrors({});
    try {
      const { id, limit } = await change('/reminders', { body: parsed.data, schema: reminderPlanned });
      toast({
        message: limit ? `Relance planifiée. Attention : ${limit}.` : 'Relance planifiée.',
        undo: () => void change(`/reminders/${id}`, { method: 'DELETE' }),
      });
      onDone(form.date);
    } catch {
      setErrors({ title: 'La relance n’a pas été enregistrée. Réessayez.' });
    }
  };
  return (
    <Carte title="Planifier une relance" actionLabel="Fermer" onAction={() => onDone(initialDate)}>
      <form
        className={layout.stack}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={layout.form}>
          <Champ
            label="Débiteur"
            type="select"
            value={form.caseId}
            error={errors.caseId}
            options={[{ value: '', label: 'Choisir…' }, ...data.items.map((item) => ({ value: item.id, label: `${item.name} · ${item.creditor}` }))]}
            onChange={(caseId) => setForm({ ...form, caseId })}
          />
          <Champ
            label="Canal"
            type="select"
            value={form.type}
            options={TYPES.map((value) => ({ value, label: REMINDER_LABELS[value] }))}
            onChange={(value) => setForm({ ...form, type: TYPES.find((item) => item === value) ?? 'CALL' })}
          />
          <Champ label="Date" type="date" value={form.date} error={errors.date} onChange={(date) => setForm({ ...form, date })} />
          <Champ label="Heure" optional placeholder="10:00" value={form.time} onChange={(time) => setForm({ ...form, time })} />
        </div>
        <Champ label="Objet" value={form.title} error={errors.title} onChange={(title) => setForm({ ...form, title })} />
        <div className={layout.end}>
          <Bouton type="submit" label="Planifier" />
        </div>
      </form>
    </Carte>
  );
}
