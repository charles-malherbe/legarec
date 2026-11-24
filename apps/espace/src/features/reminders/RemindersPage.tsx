import { agenda as agendaSchema, REMINDER_LABELS, reminderType, type Reminder, type ReminderType } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, EtatListe, PageHeader, Toolbar, useConfirm, useToast, type Tone } from '@legarec/ui';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import frLocale from '@fullcalendar/react/locales/fr';
import classicTheme from '@fullcalendar/react/themes/classic';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/palette.css';
import '@fullcalendar/react/themes/classic/theme.css';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { matches } from '../../shared/listState';
import { PlanReminder } from './PlanReminder';
import css from './Reminders.module.css';

const TONE: Record<ReminderType, Tone> = { EMAIL: 'info', SMS: 'teal', CALL: 'marine', LETTER: 'warning', INSTALLMENT: 'success', COURT_DEADLINE: 'danger' };
const VIEWS = { month: ['Mois', 'dayGridMonth'], week: ['Semaine', 'dayGridWeek'], list: ['Liste', 'listMonth'] } as const;
const OFFICERS = [
  { value: 'all', label: 'Tous les gestionnaires' },
  { value: 'cl', label: 'Camille Laurent' },
  { value: 'hb', label: 'Hugo Benali' },
  { value: 'sm', label: 'Sarah Morel' },
  { value: 'tg', label: 'Thomas Giraud' },
];
const fr = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options }).format(new Date(`${iso}T00:00:00Z`));
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shift = (iso: string, months: number) => {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekOf = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`);
  const start = addDays(iso, -((date.getUTCDay() + 6) % 7));
  return [start, addDays(start, 6)] as const;
};
const statusOf = (item: Reminder, today: string) =>
  item.done ? (item.type === 'INSTALLMENT' ? 'Payée' : 'Fait') : item.automatic ? 'Envoi automatique' : item.date < today ? 'En retard' : 'À faire';
const ctaOf = (item: Reminder) =>
  ({ CALL: 'Appeler', INSTALLMENT: 'Pointer', COURT_DEADLINE: 'Ouvrir', EMAIL: 'Envoyer', SMS: 'Envoyer', LETTER: 'Envoyer' })[item.type];

export function RemindersPage() {
  const { data, isPending, error, refetch } = useApi(agendaSchema, '/reminders');
  if (isPending)
    return (
      <>
        <PageHeader title="Relances" description=" " loading />
        <div className={layout.card}>
          <EtatListe kind="loading" count={8} />
        </div>
      </>
    );
  if (error || !data)
    return (
      <>
        <PageHeader title="Relances" />
        <div className={layout.card}>
          <EtatListe kind="error" title="Impossible de charger l’agenda" onAction={() => void refetch()} />
        </div>
      </>
    );
  return <Agenda today={data.today} items={data.items} weekly={data.weekly} />;
}

function Agenda({ today, items, weekly }: { today: string; items: Reminder[]; weekly: { emails: number; sms: number; letters: number } }) {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<keyof typeof VIEWS>('month');
  const [selected, setSelected] = useState(today);
  const [hidden, setHidden] = useState<ReminderType[]>([]);
  const [query, setQuery] = useState('');
  const [officer, setOfficer] = useState('all');
  const [planning, setPlanning] = useState(false);
  const month = selected.slice(0, 7);
  const inScope = useMemo(
    () =>
      items.filter(
        (item) =>
          (scope.id === 'all' || item.creditorId === scope.id) &&
          (officer === 'all' || item.officerId === officer) &&
          matches(query, item.debtor, item.creditor, item.title),
      ),
    [items, scope.id, officer, query],
  );
  const visible = inScope.filter((item) => !hidden.includes(item.type));
  const ofDay = visible.filter((item) => item.date === selected);
  const todays = items.filter((item) => item.date === today);
  const [from, to] = weekOf(today);
  const limits = visible.filter((item) => item.limit && !item.done);

  const postpone = async (item: Reminder) => {
    const next = addDays(item.date, 1);
    await change(`/reminders/${item.id}`, { method: 'PUT', body: { date: next } });
    toast({
      message: `Relance reportée au ${fr(next, { day: '2-digit', month: '2-digit', year: 'numeric' })}.`,
      undo: () => void change(`/reminders/${item.id}`, { method: 'PUT', body: { date: item.date } }),
    });
  };
  const send = (item: Reminder) =>
    confirm({
      title: `Envoyer cette relance à ${item.debtor} ?`,
      body: item.limit ?? 'L’envoi part immédiatement et est ajouté à l’historique du dossier.',
      tone: item.limit ? 'danger' : 'primary',
      confirmLabel: 'Envoyer',
      details: [
        { k: 'Débiteur', v: item.debtor },
        { k: 'Créancier', v: item.creditor },
        { k: 'Canal', v: REMINDER_LABELS[item.type] },
        { k: 'Objet', v: item.title },
      ],
      onConfirm: async () => {
        await change(`/reminders/${item.id}`, { method: 'PUT', body: { done: true } });
        toast({ message: 'Relance envoyée.' });
      },
    });
  const point = async (item: Reminder) => {
    await change(`/reminders/${item.id}`, { method: 'PUT', body: { done: true } });
    toast({ message: 'Échéance pointée.', undo: () => void change(`/reminders/${item.id}`, { method: 'PUT', body: { done: false } }) });
  };
  const action = (item: Reminder) =>
    item.type === 'CALL' ? (
      <Bouton size="sm" label="Appeler" ariaLabel={`Appeler ${item.debtor}`} href="/appels" />
    ) : item.type === 'COURT_DEADLINE' ? (
      <Bouton size="sm" label="Ouvrir" ariaLabel={`Ouvrir ${item.debtor}`} href="/contentieux" />
    ) : (
      <Bouton
        size="sm"
        label={ctaOf(item)}
        ariaLabel={`${ctaOf(item)} : ${item.debtor}`}
        onPress={() => (item.type === 'INSTALLMENT' ? void point(item) : send(item))}
      />
    );

  return (
    <>
      <PageHeader
        title="Relances"
        description="Relances automatiques, appels, courriers, échéances et délais judiciaires · tous créanciers"
        statsLabel="Aujourd'hui"
        stats={[
          { label: 'Aujourd’hui', value: capital(fr(today, { weekday: 'short', day: 'numeric', month: 'short' })), sub: 'semaine 47' },
          {
            label: 'À faire',
            value: String(todays.filter((item) => !item.done && !item.automatic).length),
            sub: 'appels et courriers manuels',
            tone: 'warning',
          },
          { label: 'Envois automatiques', value: String(todays.filter((item) => item.automatic).length), sub: 'e-mails et SMS du jour' },
          { label: 'Faits', value: String(todays.filter((item) => item.done).length), sub: 'depuis 8:00', tone: 'success' },
          { label: 'Cette semaine', value: String(items.filter((item) => item.date >= from && item.date <= to).length), sub: 'relances planifiées' },
        ]}
        actions={[
          { label: 'Synchroniser l’agenda', disabled: true },
          { label: 'Démarrer ma session d’appels', href: '/appels' },
          { label: '+ Planifier une relance', primary: true, kbd: 'N', expanded: planning, onPress: () => setPlanning(!planning) },
        ]}
      />
      {planning && (
        <PlanReminder
          key={selected}
          date={selected}
          onDone={(date) => {
            setPlanning(false);
            setSelected(date);
          }}
        />
      )}
      <Toolbar
        label="Naviguer dans l'agenda"
        placeholder="Débiteur, SIRET…"
        query={query}
        onQuery={setQuery}
        period={{
          label: capital(fr(`${month}-01`, { month: 'long', year: 'numeric' })),
          prev: () => setSelected(shift(selected, -1)),
          next: () => setSelected(shift(selected, 1)),
          today: () => setSelected(today),
          prevLabel: 'Mois précédent',
          nextLabel: 'Mois suivant',
        }}
        filters={[{ label: 'Gestionnaire', value: officer, options: OFFICERS, onChange: setOfficer }]}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (inScope[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
        views={(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((id) => ({ label: VIEWS[id][0], selected: view === id, pick: () => setView(id) }))}
      />
      <div role="group" aria-label="Types de relance affichés" className={layout.chips}>
        {reminderType.options.map((type) => {
          const on = !hidden.includes(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={on}
              className={layout.chip}
              onClick={() => setHidden(on ? [...hidden, type] : hidden.filter((item) => item !== type))}
            >
              <span aria-hidden className={css.swatch} data-tone={on ? TONE[type] : undefined} />
              {REMINDER_LABELS[type]} <span className={layout.hint}>{inScope.filter((item) => item.type === type && item.date.startsWith(month)).length}</span>
            </button>
          );
        })}
      </div>
      {limits.length > 0 && (
        <Alerte
          tone="warning"
          title={`${limits.length} relance${limits.length > 1 ? 's' : ''} hors des limites de contact`}
          text={limits.map((item) => `${item.debtor} : ${item.limit}`).join(' · ')}
          actionLabel="Voir les limites"
          actionHref="/parametres/relances"
        />
      )}
      <div className={layout.columns}>
        <div className={layout.wide}>
          <section aria-label="Calendrier" className={`${layout.card} ${css.calendar}`}>
            <FullCalendar
              key={`${view}-${view === 'week' ? selected : month}`}
              plugins={[dayGridPlugin, listPlugin, interactionPlugin, classicTheme]}
              locale={frLocale}
              firstDay={1}
              initialView={VIEWS[view][1]}
              initialDate={view === 'week' ? selected : `${month}-01`}
              now={today}
              timeZone="UTC"
              headerToolbar={false}
              height="auto"
              fixedWeekCount={false}
              showNonCurrentDates={false}
              eventColor="transparent"
              dayMaxEvents={3}
              events={visible.map((item) => ({ id: item.id, title: `${item.time ? `${item.time} ` : ''}${item.debtor}`, start: item.date, allDay: true }))}
              eventContent={(info) => {
                const item = visible.find((entry) => entry.id === info.event.id);
                return item ? (
                  <span className={css.event} data-tone={TONE[item.type]} data-done={item.done || undefined}>
                    {item.limit && !item.done && '⚠ '}
                    {info.event.title}
                    {view === 'list' && ` · ${item.title} · ${statusOf(item, today)}`}
                  </span>
                ) : null;
              }}
              dayCellClass={(info) => (info.date.toISOString().slice(0, 10) === selected ? (css.selected ?? '') : '')}
              dateClick={(info) => setSelected(info.dateStr.slice(0, 10))}
              eventClick={(info) => {
                const item = visible.find((entry) => entry.id === info.event.id);
                if (item) setSelected(item.date);
              }}
            />
          </section>
          <label className={layout.inline}>
            <span className={layout.muted}>Jour affiché à droite</span>
            <input
              type="date"
              value={selected}
              className={css.date}
              onChange={(event) => {
                if (event.currentTarget.value) setSelected(event.currentTarget.value);
              }}
            />
          </label>
        </div>
        <aside className={layout.aside} aria-label="Relances du jour">
          <Carte
            title={capital(fr(selected, { weekday: 'long', day: 'numeric', month: 'long' }))}
            badge={`${ofDay.length} relance${ofDay.length > 1 ? 's' : ''}`}
          >
            {ofDay.length === 0 ? (
              <p className={layout.body}>Aucune relance prévue ce jour-là.</p>
            ) : (
              <ul className={`${layout.list} ${layout.stack}`}>
                {ofDay.map((item) => (
                  <li key={item.id} className={css.item}>
                    <span className={layout.between}>
                      <Badge label={REMINDER_LABELS[item.type]} tone={TONE[item.type]} />
                      <span className={layout.hint}>
                        {item.time ?? '—'} · {item.automatic ? 'automatique' : 'manuel'}
                      </span>
                    </span>
                    <span className={layout.text}>
                      {item.caseId ? (
                        <Link to={`/debiteurs/${item.caseId}`} className={layout.strong}>
                          {item.debtor}
                        </Link>
                      ) : (
                        <strong className={layout.strong}>{item.debtor}</strong>
                      )}
                      <span className={layout.hint}>{item.creditor}</span>
                      <span className={layout.muted}>{item.title}</span>
                    </span>
                    {item.limit && !item.done && <span className={layout.danger}>{item.limit}</span>}
                    <span className={layout.between}>
                      <strong className={item.done ? layout.success : undefined}>{statusOf(item, today)}</strong>
                      {!item.done && item.canAct && (
                        <span className={layout.inline}>
                          <Bouton variant="secondary" size="sm" label="Reporter" ariaLabel={`Reporter : ${item.debtor}`} onPress={() => void postpone(item)} />
                          {action(item)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Carte>
          <Carte title="Envois automatiques cette semaine">
            <div className={layout.stack}>
              <dl className={layout.facts}>
                <div>
                  <dt>E-mails de relance</dt>
                  <dd>{weekly.emails}</dd>
                </div>
                <div>
                  <dt>SMS</dt>
                  <dd>{weekly.sms}</dd>
                </div>
                <div>
                  <dt>Courriers à imprimer</dt>
                  <dd>{weekly.letters}</dd>
                </div>
              </dl>
              <Link to="/parametres/scenarios" className={layout.link}>
                Modifier les scénarios de relance →
              </Link>
            </div>
          </Carte>
        </aside>
      </div>
    </>
  );
}
