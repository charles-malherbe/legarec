import { checkCoordinate, coordinateSource, formatPhone, SOURCE_LABELS, type CallTarget, type Coordinate } from '@legarec/contracts';
import { Badge, Bouton, Case, Champ, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useEffect, useState } from 'react';
import { useChange } from '../../app/data';
import layout from '../../shared/layout.module.css';
import css from './Calls.module.css';

const STATUS: Record<Coordinate['status'], [string, Tone]> = {
  VERIFIED: ['Vérifié', 'success'],
  INVALID: ['Invalide', 'danger'],
  UNVERIFIED: ['Non vérifié', 'neutral'],
  NEW: ['Nouveau · à vérifier', 'marine'],
  PENDING: ['Vérification envoyée', 'warning'],
};
const GROUPS = {
  PHONE: {
    label: 'Téléphones',
    add: '+ Ajouter un numéro',
    field: 'Numéro',
    type: 'tel',
    placeholder: '06 12 34 56 78',
    labels: ['Mobile', 'Standard', 'Ligne directe', 'Comptabilité'],
  },
  EMAIL: {
    label: 'E-mails',
    add: '+ Ajouter une adresse',
    field: 'Adresse e-mail',
    type: 'email',
    placeholder: 'nom@entreprise.fr',
    labels: ['Comptabilité', 'Direction', 'Contact', 'Autre'],
  },
} as const;
type Edit = { kind: Coordinate['kind']; item: Coordinate | null };
const show = (item: Pick<Coordinate, 'kind' | 'value'>) => (item.kind === 'PHONE' ? formatPhone(item.value) : item.value);

export function Coordinates({
  target,
  onEditing,
  onDial,
  openPhone,
}: {
  target: CallTarget;
  onEditing: (on: boolean) => void;
  onDial: (value: string) => void;
  openPhone: boolean;
}) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<(typeof coordinateSource.options)[number]>('CALL');
  const [primary, setPrimary] = useState(false);
  const [invalidate, setInvalidate] = useState(true);
  const [tried, setTried] = useState(false);
  const base = `/cases/${target.caseId}/coordinates`;
  useEffect(() => onEditing(!!edit), [edit, onEditing]);
  const start = (kind: Edit['kind'], item: Coordinate | null) => {
    setEdit({ kind, item });
    setValue(item ? show(item) : '');
    setLabel(item?.label ?? GROUPS[kind].labels[0]);
    setPrimary(item?.primary ?? false);
    setTried(false);
  };
  const patch = async (item: Coordinate, body: Partial<Coordinate>, message: string, undo?: Partial<Coordinate>) => {
    await change(`${base}/${item.id}`, { method: 'PUT', body });
    toast({ message, undo: undo ? () => void change(`${base}/${item.id}`, { method: 'PUT', body: undo }) : undefined });
  };
  const error = edit
    ? checkCoordinate(
        edit.kind,
        value,
        target.coordinates.filter((item) => item.kind === edit.kind),
        edit.item?.id ?? null,
      )
    : '';
  const submit = () => {
    if (!edit || error) {
      setTried(true);
      return;
    }
    const phone = edit.kind === 'PHONE';
    const shown = phone ? formatPhone(value) : value.trim();
    confirm({
      title: edit.item
        ? phone
          ? 'Remplacer ce numéro ?'
          : 'Remplacer cette adresse e-mail ?'
        : phone
          ? 'Ajouter ce numéro ?'
          : 'Ajouter cette adresse e-mail ?',
      body: `La modification est enregistrée dans le dossier, synchronisée avec la fiche contact 3CX et utilisée pour les prochains appels, SMS et relances de ${target.debtor}.`,
      confirmLabel: edit.item ? 'Remplacer' : 'Ajouter',
      details: [
        { k: 'Débiteur', v: `${target.debtor} · SIRET ${target.siret}` },
        { k: 'Ancienne valeur', v: edit.item ? `${show(edit.item)} → ${invalidate ? 'invalide' : 'conservée'}` : '—' },
        { k: 'Nouvelle valeur', v: `${shown} (${label})${primary ? ', principale' : ''}` },
        { k: 'Origine', v: SOURCE_LABELS[source] },
      ],
      onConfirm: async () => {
        await change(base, {
          body: {
            kind: edit.kind,
            label,
            value: phone ? shown.replace(/\s/g, '') : shown,
            primary,
            replaces: edit.item && invalidate ? edit.item.id : null,
            source,
          },
        });
        setEdit(null);
        toast({ message: 'Coordonnée enregistrée.' });
      },
    });
  };
  return (
    <section aria-labelledby="coord-titre" className={layout.stack}>
      <div className={layout.between}>
        <h3 id="coord-titre" className={css.h3}>
          3. Coordonnées du débiteur
        </h3>
        <span className={layout.hint}>Synchronisées avec 3CX</span>
      </div>
      {(['PHONE', 'EMAIL'] as const).map((kind) => (
        <div key={kind} className={layout.tightStack}>
          <div className={layout.between}>
            <strong className={layout.muted}>{GROUPS[kind].label}</strong>
            <Bouton variant="link" size="xs" label={GROUPS[kind].add} onPress={() => start(kind, null)} />
          </div>
          {target.coordinates
            .filter((item) => item.kind === kind)
            .map((item) => (
              <div key={item.id} className={css.coordinate}>
                <div className={layout.between}>
                  <span className={layout.text}>
                    <span className={item.status === 'INVALID' ? css.struck : undefined}>{show(item)}</span>
                    <span className={layout.hint}>
                      {item.label}
                      {item.note && ` · ${item.note}`}
                      {item.primary && ' · principal'}
                    </span>
                  </span>
                  <Badge label={STATUS[item.status][0]} tone={STATUS[item.status][1]} />
                </div>
                <div className={layout.inline}>
                  {kind === 'PHONE' && item.status !== 'INVALID' && (
                    <Bouton variant="link" size="xs" label="Appeler" ariaLabel={`Appeler ${show(item)}`} onPress={() => onDial(item.value)} />
                  )}
                  {kind === 'PHONE' && (item.status === 'NEW' || item.status === 'UNVERIFIED') && (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Confirmer (joint à ce numéro)"
                      onPress={() => void patch(item, { status: 'VERIFIED' }, 'Numéro vérifié.', { status: item.status })}
                    />
                  )}
                  {kind === 'EMAIL' && (item.status === 'NEW' || item.status === 'UNVERIFIED') && (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Envoyer un e-mail de vérification"
                      onPress={() =>
                        confirm({
                          title: 'Envoyer un e-mail de vérification ?',
                          body: 'Le débiteur reçoit un lien pour confirmer son adresse (Resend).',
                          confirmLabel: 'Envoyer',
                          details: [{ k: 'Adresse', v: item.value }],
                          onConfirm: () => patch(item, { status: 'PENDING' }, 'E-mail de vérification envoyé.'),
                        })
                      }
                    />
                  )}
                  {!item.primary && item.status !== 'INVALID' && (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Définir principal"
                      ariaLabel={`Définir principal : ${show(item)}`}
                      onPress={() => void patch(item, { primary: true }, 'Coordonnée principale modifiée.')}
                    />
                  )}
                  <Bouton variant="link" size="xs" label="Corriger" ariaLabel={`Corriger ${show(item)}`} onPress={() => start(kind, item)} />
                  {item.status === 'INVALID' ? (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Rétablir"
                      ariaLabel={`Rétablir ${show(item)}`}
                      onPress={() => void patch(item, { status: 'UNVERIFIED' }, 'Coordonnée rétablie.')}
                    />
                  ) : (
                    <Bouton
                      variant="link"
                      size="xs"
                      label="Marquer invalide"
                      ariaLabel={`Marquer invalide : ${show(item)}`}
                      onPress={() =>
                        void patch(item, { status: 'INVALID', primary: false }, 'Coordonnée marquée invalide.', { status: item.status, primary: item.primary })
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          {edit?.kind === kind && (
            <div className={css.box2}>
              <strong>{edit.item ? `Corriger ${show(edit.item)}` : kind === 'PHONE' ? 'Nouveau numéro' : 'Nouvelle adresse e-mail'}</strong>
              <div className={layout.form}>
                <Champ
                  label={GROUPS[kind].field}
                  type={GROUPS[kind].type}
                  value={value}
                  placeholder={GROUPS[kind].placeholder}
                  error={tried && error ? error : undefined}
                  help={
                    !error && value
                      ? kind === 'PHONE'
                        ? `Format reconnu : ${formatPhone(value)}`
                        : 'Une vérification sera proposée après l’enregistrement.'
                      : undefined
                  }
                  onChange={setValue}
                />
                <Champ label="Type" type="select" value={label} options={[...GROUPS[kind].labels]} onChange={setLabel} />
                <Champ
                  label="Origine"
                  type="select"
                  value={source}
                  options={coordinateSource.options.map((id) => ({ value: id, label: SOURCE_LABELS[id] }))}
                  onChange={(next) => setSource(coordinateSource.parse(next))}
                />
              </div>
              <Case label="En faire la coordonnée principale" checked={primary} onToggle={setPrimary} />
              {edit.item && <Case label="Marquer l'ancienne valeur comme invalide (gardée dans l'historique)" checked={invalidate} onToggle={setInvalidate} />}
              <div className={layout.end}>
                <Bouton variant="secondary" size="sm" label="Annuler" onPress={() => setEdit(null)} />
                <Bouton size="sm" label="Enregistrer" ariaLabel="Enregistrer la coordonnée" onPress={submit} />
              </div>
            </div>
          )}
        </div>
      ))}
      {openPhone && !edit && <Bouton variant="secondary" size="sm" label="Saisir le bon numéro" onPress={() => start('PHONE', null)} />}
      <details>
        <summary className={layout.muted}>Historique des coordonnées ({target.coordinateHistory.length})</summary>
        <ul className={layout.list}>
          {target.coordinateHistory.map((item) => (
            <li key={`${item.when}${item.text}`} style={{ paddingInline: 0 }}>
              <span className={layout.hint}>{item.when}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
