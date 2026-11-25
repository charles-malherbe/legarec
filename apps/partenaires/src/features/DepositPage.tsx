import { formatCents, importDone, importReport, newClaim, parseCents, uploadedFile, type ImportReport } from '@legarec/contracts';
import { saveFile, upload } from '@legarec/platform';
import { Alerte, Badge, Bouton, Champ, DepotFichiers, Onglets, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import css from '../app/Portal.module.css';
import { useChange, usePartner } from '../app/data';

const TEMPLATE = 'debiteur;siret;email;telephone;adresse;numero_facture;date_emission;date_echeance;montant_ttc\r\n';

export function DepositPage() {
  const [mode, setMode] = useState<'one' | 'batch'>('one');
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Déposer des créances</h1>
          <p>Joignez les factures : elles sont transmises au gestionnaire et visibles par le débiteur dans son espace de paiement.</p>
        </div>
      </div>
      <Onglets
        label="Mode de dépôt"
        items={[
          { label: 'Une créance', selected: mode === 'one', pick: () => setMode('one') },
          { label: 'En lot (CSV ou Excel)', selected: mode === 'batch', pick: () => setMode('batch') },
        ]}
        layout={{ alignSelf: 'flex-start' }}
      />
      {mode === 'one' ? <OneClaim /> : <Batch />}
    </>
  );
}

const EMPTY = { debtor: '', siret: '', email: '', phone: '', address: '' };
const INVOICE = { number: '', issuedOn: '', dueOn: '', amount: '' };

function OneClaim() {
  const user = usePartner();
  const change = useChange();
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY);
  const [invoices, setInvoices] = useState([INVOICE]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setDone(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const submit = () => {
    const parsed = newClaim.safeParse({ ...form, invoices: invoices.map((item) => ({ ...item, amount: parseCents(item.amount) })) });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message])));
    setErrors({});
    const total = parsed.data.invoices.reduce((sum, item) => sum + item.amount, 0);
    confirm({
      title: 'Confier cette créance à Legarec ?',
      body: 'Le dossier est ouvert aussitôt et les relances démarrent selon les conditions de votre convention. Vous suivez l’avancement dans cet espace.',
      details: [
        { k: 'Débiteur', v: parsed.data.debtor },
        { k: parsed.data.invoices.length > 1 ? 'Factures' : 'Facture', v: parsed.data.invoices.map((item) => item.number).join(', ') },
        { k: 'Montant TTC', v: formatCents(total, { decimals: 'always' }) },
        { k: 'Pièces jointes', v: String(files.length) },
      ],
      confirmLabel: 'Confier la créance',
      onConfirm: async () => {
        const attachments: string[] = [];
        for (const file of files) attachments.push((await upload(uploadedFile, '/portal/attachments', file)).id);
        await change('/portal/claims', { body: { ...parsed.data, attachments } });
        setForm(EMPTY);
        setInvoices([INVOICE]);
        setFiles([]);
        setDone(true);
      },
    });
  };
  const field = (key: keyof typeof EMPTY, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
    <Champ label={label} value={form[key]} error={errors[key]} onChange={set(key)} {...more} />
  );
  return (
    <form
      aria-label="Nouvelle créance"
      className={css.panel}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className={css.form}>
        <legend>Débiteur</legend>
        {field('debtor', 'Nom ou raison sociale', { placeholder: 'Ex. : Menuiserie Arnal', required: true })}
        {field('siret', 'SIRET du débiteur (si professionnel)', { placeholder: '14 chiffres, ex. 512 334 871 00088', inputMode: 'numeric' })}
        {field('email', 'E-mail', { type: 'email' })}
        {field('phone', 'Téléphone', { type: 'tel' })}
        {field('address', 'Adresse', { required: true })}
      </fieldset>
      {invoices.map((invoice, index) => {
        const cell = (key: keyof typeof INVOICE, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
          <Champ
            label={index === 0 ? label : `${label}, facture ${index + 1}`}
            required
            value={invoice[key]}
            error={errors[`invoices.${index}.${key}`]}
            onChange={(value) => {
              setDone(false);
              setInvoices((current) => current.map((item, position) => (position === index ? { ...item, [key]: value } : item)));
            }}
            {...more}
          />
        );
        return (
          <fieldset key={index} className={css.form}>
            <legend>{index === 0 ? 'Facture' : `Facture ${index + 1}`}</legend>
            {cell('number', 'N° de facture')}
            {cell('issuedOn', "Date d'émission", { type: 'date' })}
            {cell('dueOn', 'Échéance', { type: 'date' })}
            {cell('amount', 'Montant TTC (€)', { inputMode: 'decimal' })}
            {index > 0 && (
              <Bouton
                variant="ghost"
                size="sm"
                label="Retirer cette facture"
                ariaLabel={`Retirer cette facture : facture ${index + 1}`}
                onPress={() => setInvoices((current) => current.filter((_item, position) => position !== index))}
              />
            )}
          </fieldset>
        );
      })}
      <DepotFichiers
        label="Déposez la facture (PDF) et ses justificatifs"
        hint="Bon de commande, bon de livraison, relances déjà envoyées…"
        accept=".pdf,.png,.jpg,.jpeg"
        multiple
        files={files}
        onChange={setFiles}
      />
      {done && <Alerte tone="success" text={`Créance déposée. Statut « Nouveau » : ${user.officer} la prendra en charge sous 24 h ouvrées.`} />}
      <div className={css.end}>
        <Bouton variant="secondary" label="Ajouter une autre facture" onPress={() => setInvoices((current) => [...current, INVOICE])} />
        <Bouton type="submit" label="Déposer la créance" />
      </div>
    </form>
  );
}

function Batch() {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; pending: number } | null>(null);
  const analyse = async (next: File[]) => {
    setFiles(next);
    setReport(null);
    setResult(null);
    setFailed(false);
    const file = next[0];
    if (!file) return;
    setBusy(true);
    try {
      setReport(await upload(importReport, '/portal/imports', file));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    report &&
    confirm({
      title: `Confier ${report.valid} créances à Legarec ?`,
      body: `Les ${report.valid} dossiers sont ouverts aussitôt et les relances démarrent selon les conditions de votre convention. Vous suivez l’avancement dans cet espace.${report.errors.length > 0 ? ` Les ${report.errors.length} lignes en erreur ne sont pas importées.` : ''}`,
      details: [
        { k: 'Lignes du fichier', v: String(report.lines) },
        { k: 'Lignes valides', v: `${report.valid} · ${formatCents(report.total)}` },
        { k: 'Lignes en erreur', v: String(report.errors.length) },
      ],
      confirmLabel: `Confier les ${report.valid} créances`,
      onConfirm: async () => {
        setResult(await change(`/portal/imports/${report.id}/confirm`, { schema: importDone }));
        setReport(null);
        setFiles([]);
        toast({ message: 'Import terminé.' });
      },
    });
  return (
    <section aria-label="Import en lot" className={css.panel}>
      <DepotFichiers
        label="Déposez votre fichier CSV ou Excel"
        hint="Une ligne par facture · Les PDF des factures peuvent être joints dans un fichier .zip"
        accept=".csv,.xlsx,.zip"
        files={files}
        onChange={(next) => void analyse(next)}
      />
      <div>
        <Bouton
          variant="link"
          size="sm"
          icon="download"
          label="Télécharger le modèle"
          onPress={() => saveFile(new Blob(['﻿', TEMPLATE], { type: 'text/csv;charset=utf-8' }), 'modele-depot-creances.csv')}
        />
      </div>
      {busy && (
        <p role="status" className={css.hint}>
          Analyse du fichier en cours…
        </p>
      )}
      {failed && <Alerte tone="danger" text="Le fichier n’a pas pu être analysé. Rien n’a été créé : vérifiez son format et réessayez." />}
      {report && (
        <div role="status" className={css.thread}>
          <div className={css.inline}>
            <strong>{report.lines} lignes analysées</strong>
            <Badge label={`${report.valid} prêtes à importer · ${formatCents(report.total)}`} tone="success" />
            {report.errors.length > 0 && <Badge label={`${report.errors.length} à corriger`} tone="warning" />}
          </div>
          <ul className={css.errors}>
            {report.errors.map((item) => (
              <li key={item.line}>
                <strong>Ligne {item.line}</strong>
                {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <Alerte
          tone="success"
          text={`${result.created} créances importées avec le statut « Nouveau ».${result.pending > 0 ? ` Les ${result.pending} lignes à corriger n’ont pas été créées : déposez-les dans un nouveau fichier.` : ''}`}
        />
      )}
      <div className={css.end}>
        <Bouton
          label={report ? `Importer les ${report.valid} créances` : 'Importer les créances'}
          disabled={!report || report.valid === 0}
          onPress={() => submit()}
        />
      </div>
    </section>
  );
}
