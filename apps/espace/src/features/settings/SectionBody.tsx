import { isFirmIdentity, settingProblems, settingsSection, type SettingTable } from '@legarec/contracts';
import { ApiError, saveFile } from '@legarec/platform';
import { Badge, Bouton, Carte, Champ, EtatListe, Reglage, Statut, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useApi, useChange } from '../../app/data';
import { toCsv } from '../../shared/csv';
import layout from '@legarec/ui/layout.module.css';
import { MembersCard } from '../team/MembersCard';
import { TemplatesCard } from '../templates/TemplatesCard';
import { GdprRegistryCard } from './GdprRegistryCard';
import { MailboxesCard } from './MailboxesCard';
import { MediaKit } from './MediaKit';
import { SecretsCard } from './SecretsCard';
import css from './Settings.module.css';

export function SectionBody({ scope, id, label }: { scope: string; id: string; label: string }) {
  const path = `/settings/${scope}/${id}`;
  const { data, error, refetch } = useApi(settingsSection, path);
  const change = useChange();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const confirm = useConfirm();
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  const fields = data.blocks.flatMap((item) => item.fields);
  const before = Object.fromEntries(fields.filter((item) => item.id in draft).map((item) => [item.id, item.kind === 'switch' ? item.checked : item.value]));
  const dirty = Object.keys(draft).some((key) => draft[key] !== before[key]);
  const set = (key: string, value: string | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setProblems({});
  };
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== before[key]));
  const identity = Object.keys(changed).filter((key) => scope === 'firm' && isFirmIdentity(id, key));
  const askSave = () => {
    const found = settingProblems(data, changed);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if (identity.length === 0) return void save();
    confirm({
      tone: 'danger',
      title: 'Modifier les identifiants du cabinet ?',
      body: 'Ces valeurs sont affichées aux débiteurs et sur les factures. Vérifiez chaque caractère : un IBAN erroné détourne les paiements.',
      details: identity.map((key) => ({ k: fields.find((item) => item.id === key)?.label ?? key, v: String(draft[key]) })),
      confirmLabel: 'Enregistrer ces identifiants',
      onConfirm: save,
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      await change(`${path}?version=${data.version}`, { method: 'PUT', body: changed });
      setDraft({});
      toast({
        message: `« ${label} » enregistré.`,
        // Bank details are only changed through their own confirmation.
        undo: identity.length > 0 ? undefined : () => void change(path, { method: 'PUT', body: before }),
      });
    } catch (failure) {
      toast(
        failure instanceof ApiError && failure.status === 409
          ? { message: 'Cette section vient d’être modifiée par quelqu’un d’autre. Vérifiez les valeurs, puis réessayez.', tone: 'danger' }
          : { message: 'L’enregistrement n’a pas abouti. Vos modifications sont conservées à l’écran : réessayez.' },
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={layout.stack}>
      {fields.length > 0 && data.canEdit && !dirty && <Statut label="Tout est à jour" tone="success" />}
      {id === 'users' && <MembersCard />}
      {id === 'kit' && <MediaKit />}
      {id === 'modeles' && <TemplatesCard />}
      {id === 'secrets' && <SecretsCard canEdit={data.canEdit} />}
      {id === 'boites' && <MailboxesCard canEdit={data.canEdit} />}
      {data.blocks.map((item) => (
        <Carte key={item.id} title={item.title} description={item.description} padding="none">
          {item.fields.map((field, index) => (
            <Reglage
              key={field.id}
              first={index === 0}
              kind={field.kind}
              label={field.label}
              description={field.description}
              value={String(draft[field.id] ?? field.value)}
              checked={Boolean(draft[field.id] ?? field.checked)}
              options={field.options}
              locked={field.locked}
              disabled={!data.canEdit || (field.locked && field.kind === 'text')}
              status={field.status ?? undefined}
              statusTone={field.statusTone}
              error={problems[field.id]}
              onChange={(value) => set(field.id, value)}
              onToggle={(value) => set(field.id, value)}
            />
          ))}
        </Carte>
      ))}
      {id === 'rgpd' && <GdprRegistryCard />}
      {data.tables.map((item) => (id === 'audit' ? <AuditTable key={item.id} table={item} /> : <StaticTable key={item.id} table={item} />))}
      {data.notes.map((note) => (
        <p key={note} role="note" className={layout.notice}>
          {note}
        </p>
      ))}
      {dirty && (
        <div role="status" className={css.bar}>
          <span>Modifications non enregistrées dans « {label} »</span>
          <span className={layout.inline}>
            <Bouton
              label="Annuler"
              variant="dark"
              size="sm"
              disabled={saving}
              onPress={() => {
                setDraft({});
                setProblems({});
              }}
            />
            <Bouton label="Enregistrer" size="sm" loading={saving} onPress={askSave} />
          </span>
        </div>
      )}
    </div>
  );
}

const cellText = (cell: SettingTable['rows'][number][number]) => (typeof cell === 'string' ? cell : cell.text);

export function StaticTable({ table }: { table: SettingTable }) {
  return (
    <Carte title={table.title} description={table.description} padding="none">
      <Tableau
        caption={table.title}
        hideCaption
        bordered={false}
        rows={table.rows.map((cells, index) => ({ id: String(index), cells }))}
        rowId={(row) => row.id}
        columns={table.columns.map((label, index) => ({
          key: String(index),
          label,
          render: (row: { cells: SettingTable['rows'][number] }) => {
            const cell = row.cells[index] ?? '';
            return typeof cell === 'string' ? cell : <Badge label={cell.text} tone={cell.tone} />;
          },
        }))}
      />
    </Carte>
  );
}

function AuditTable({ table }: { table: SettingTable }) {
  const [who, setWho] = useState('');
  const [kind, setKind] = useState('');
  const people = [...new Set(table.rows.map((row) => cellText(row[1] ?? '')))];
  const KINDS: Record<string, RegExp> = { Connexions: /connexion/i, Validations: /validation/i, Exports: /export/i, Comptes: /compte/i };
  const rows = table.rows.filter((row) => (!who || cellText(row[1] ?? '') === who) && (!kind || KINDS[kind]?.test(cellText(row[3] ?? ''))));
  return (
    <div className={layout.stack}>
      <div className={layout.inline}>
        <Champ
          type="select"
          label="Filtrer par utilisateur"
          hideLabel
          value={who}
          options={[{ value: '', label: 'Tous les utilisateurs' }, ...people.map((value) => ({ value, label: value }))]}
          onChange={setWho}
        />
        <Champ
          type="select"
          label="Filtrer par type"
          hideLabel
          value={kind}
          options={[{ value: '', label: 'Toutes les actions' }, ...Object.keys(KINDS).map((value) => ({ value, label: value }))]}
          onChange={setKind}
        />
        <Bouton
          variant="secondary"
          size="sm"
          icon="download"
          label="Exporter (CSV)"
          onPress={() =>
            saveFile(
              new Blob(
                [
                  '﻿',
                  toCsv(
                    table.columns,
                    rows.map((row) => row.map(cellText)),
                  ),
                ],
                { type: 'text/csv;charset=utf-8' },
              ),
              'journal-audit.csv',
            )
          }
        />
      </div>
      {rows.length > 0 ? <StaticTable table={{ ...table, rows }} /> : <EtatListe kind="noresult" onAction={() => (setWho(''), setKind(''))} />}
    </div>
  );
}
