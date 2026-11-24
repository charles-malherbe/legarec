import { L111_8, templateDetail, templatesData, type TemplateDetail } from '@legarec/contracts';
import { saveFile } from '@legarec/platform';
import { Alerte, Badge, Bouton, Carte, Case, Champ, EtatListe, Icone, Interrupteur, PageHeader, useConfirm, useToast } from '@legarec/ui';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import css from './Templates.module.css';

/** The preview loads nothing from outside, whatever the file contains. */
const PREVIEW_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
const STATUS = {
  PUBLISHED: (version: number) => ({ label: `Version ${version} publiée`, tone: 'success' as const }),
  IMPORTED: (version: number) => ({ label: `Version ${version + 1} importée, à soumettre`, tone: 'warning' as const }),
  RESTORED: () => ({ label: 'Ancienne version restaurée, à soumettre', tone: 'warning' as const }),
  WAITING: () => ({ label: 'En attente de validation', tone: 'info' as const }),
};
const LEGAL = {
  collection: [
    'Legarec, cabinet de recouvrement amiable, Paris · SIREN [SIREN] · agissant pour le compte de {creancier.nom}, {creancier.adresse}.',
    'Somme réclamée : principal {creance.principal}, intérêts {creance.interets}, indemnités forfaitaires {creance.indemnites} (art. L. 441-10 du Code de commerce). Fondement : factures {creance.factures} restées impayées.',
    `Article L111-8 du Code des procédures civiles d’exécution : ${L111_8}`,
  ],
  billing: [
    'Paiement à 30 jours à réception. Escompte pour paiement anticipé : néant. Catégorie de l’opération : prestation de services.',
    'En cas de retard : pénalités au taux de [TAUX DES PÉNALITÉS] et indemnité forfaitaire de 40 € pour frais de recouvrement (art. L. 441-10 du Code de commerce).',
    'Legarec · SIREN [SIREN] · TVA intracommunautaire [N° TVA] · [CAPITAL ET RCS]',
  ],
  contract: [
    'Legarec · SIREN [SIREN] · RCS Paris · représentée par la direction',
    'Données personnelles : Legarec agit en sous-traitant de {client.nom} pour les données des dossiers (art. 28 du RGPD), et en responsable du traitement pour sa comptabilité, sa sécurité, son personnel et sa téléphonie.',
  ],
  sms: ['STOP : répondez STOP'],
};
const MANDATORY = {
  collection: [
    'Identité et adresse du cabinet, et mention qu’il agit pour le compte du créancier',
    'Nom ou dénomination sociale du créancier et son adresse',
    'Fondement et montant de la somme due, en distinguant principal, intérêts et accessoires',
    'Indication d’avoir à payer et modalités de paiement',
    'Reproduction de l’article L. 111-8 du CPCE, dans la rédaction validée par le cabinet',
  ],
  billing: [
    'Numéro unique et date d’émission',
    'Identité, SIREN et numéro de TVA du cabinet et du client',
    'Désignation, montants HT, taux et montant de TVA, total TTC',
    'Date d’échéance et conditions d’escompte',
    'Taux des pénalités de retard et indemnité forfaitaire de 40 €',
  ],
  contract: [
    'Identité, SIREN et représentant légal des deux parties',
    'Signature électronique des deux parties',
    'Clause de protection des données (art. 28 du RGPD)',
  ],
  sms: [
    'Nom du cabinet et du créancier',
    'Mention « STOP : répondez STOP » pour ne plus recevoir de SMS',
    'Pas d’envoi le dimanche, les jours fériés ni hors des plages prévues',
  ],
};
const family = (item: TemplateDetail) =>
  item.kind === 'SMS' ? 'sms' : item.kind === 'CONTRACT' ? 'contract' : item.category === 'COLLECTION' ? 'collection' : ('billing' as const);

export function TemplatePage() {
  const { id = '' } = useParams();
  const { data, error, refetch } = useApi(templateDetail, `/templates/${encodeURIComponent(id)}`);
  if (!data)
    return (
      <>
        <PageHeader title="Modèle" />
        <div className={layout.card}>
          {error instanceof ApiError && error.status === 404 ? (
            <EtatListe kind="empty" title="Modèle introuvable" text="Ce modèle n’existe pas ou n’est plus utilisé." />
          ) : (
            <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
          )}
        </div>
      </>
    );
  return <Template key={data.id} item={data} />;
}

function Template({ item }: { item: TemplateDetail }) {
  const list = useApi(templatesData, '/templates');
  const navigate = useNavigate();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [sampleId, setSampleId] = useState(item.samples[0]?.id ?? '');
  const [highlight, setHighlight] = useState(true);
  const [over, setOver] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [fileError, setFileError] = useState('');
  const [lastImport, setLastImport] = useState<{ fileName: string; source: string } | null>(null);
  const sample = item.samples.find((entry) => entry.id === sampleId) ?? item.samples[0];
  const values = sample?.values ?? {};
  const kind = family(item);
  const path = `/templates/${item.id}`;
  const extension = item.kind === 'SMS' ? 'txt' : 'html';
  const used = [...new Set([...`${item.subject ?? ''} ${item.body}`.matchAll(/\{([^{}\s]+)\}/g)].map((match) => match[1] ?? ''))];
  const warnings = item.pending?.checks.filter((check) => check.level === 'WARNING') ?? [];
  const errors = item.pending?.checks.filter((check) => check.level === 'ERROR') ?? [];
  const status = STATUS[item.status](item.version);
  const download = () => saveFile(new Blob([item.source], { type: item.kind === 'SMS' ? 'text/plain' : 'text/html' }), item.fileName);
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError('');
    setAcknowledged(false);
    if (file.size > 500_000 || !file.name.toLowerCase().endsWith(`.${extension}`)) {
      setFileError(`Choisissez un fichier .${extension} de 500 Ko maximum.`);
      return;
    }
    try {
      const body = { fileName: file.name, source: await file.text() };
      await change(`${path}/import`, { body });
      setLastImport(body);
    } catch {
      setFileError('Le fichier n’a pas pu être contrôlé. Réessayez.');
    }
  };
  const cancelImport = async () => {
    const restored = item.status === 'RESTORED';
    const kept = lastImport;
    try {
      await change(`${path}/import`, { method: 'DELETE' });
    } catch {
      setFileError('L’import n’a pas été annulé. Réessayez.');
      return;
    }
    toast({
      message: restored ? 'Restauration annulée.' : 'Import annulé.',
      undo: restored
        ? () => void change(`${path}/restore`, { body: {} })
        : kept
          ? () => void change(`${path}/import`, { body: kept })
          : () => void change(`${path}/import/undo`),
    });
  };
  const submit = () =>
    confirm({
      title: `Soumettre « ${item.name} » pour validation ?`,
      body: `Le Directeur reçoit une notification, ainsi que le Responsable par délégation. Tant que la nouvelle version n’est pas validée, la version ${item.version} reste utilisée par les scénarios et les envois.`,
      details: [
        { k: 'Modèle', v: `${item.name} (${item.channel})` },
        { k: 'Nouvelle version', v: `v${item.version + 1}` },
        { k: 'Validation', v: item.validator },
        { k: 'Utilisé par', v: item.usedBy },
        ...warnings.map((check) => ({ k: 'Alerte acceptée', v: `${check.label} : ${check.detail}` })),
      ],
      confirmLabel: 'Soumettre',
      onConfirm: async () => {
        await change(`${path}/submit`, { body: { acknowledged } });
        toast({ message: 'Nouvelle version soumise pour validation.' });
      },
    });
  const review = (approved: boolean) =>
    confirm({
      tone: approved ? 'primary' : 'danger',
      title: approved ? `Publier la version ${item.version + 1} ?` : 'Refuser cette version ?',
      body: approved ? 'Elle est utilisée dès maintenant par les scénarios et les envois.' : `La version ${item.version} reste en service.`,
      details: [
        { k: 'Modèle', v: `${item.name} (${item.channel})` },
        { k: 'Utilisé par', v: item.usedBy },
      ],
      reasonLabel: approved ? undefined : 'Motif du refus',
      confirmLabel: approved ? 'Valider et publier' : 'Refuser',
      onConfirm: async (reason) => {
        await change(`${path}/review`, { body: { approved, reason } });
        toast({ message: approved ? 'Nouvelle version publiée.' : 'Version refusée.' });
      },
    });
  const test = () =>
    confirm({
      title: 'Envoyer un test ?',
      body: 'Le message part avec les données de démonstration, à vous seulement.',
      details: [{ k: 'Modèle', v: item.name }],
      confirmLabel: 'Envoyer le test',
      onConfirm: async () => {
        await change(`${path}/test`);
        toast({ message: 'Test envoyé à votre adresse.' });
      },
    });
  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.channel} · ${item.category === 'COLLECTION' ? 'Recouvrement' : 'Facturation'} · utilisé ${item.uses.toLocaleString('fr-FR')} fois ce mois · ${item.usedBy}`}
        status={status}
        actions={[
          { label: 'Liste des champs de fusion', href: '/parametres/champs-de-fusion' },
          { label: `Télécharger le fichier ${extension.toUpperCase()}`, primary: true, onPress: download },
        ]}
      />
      {item.status === 'WAITING' && (
        <Alerte
          tone="info"
          title="En attente de validation"
          text={`${item.validator} : notification envoyée. La version ${item.version} reste utilisée jusqu’à la validation.`}
        >
          {item.canValidate && (
            <div className={layout.inline}>
              <Bouton size="sm" label="Valider et publier" onPress={() => review(true)} />
              <Bouton size="sm" variant="danger-outline" label="Refuser" onPress={() => review(false)} />
            </div>
          )}
        </Alerte>
      )}
      <div className={css.columns}>
        <div className={layout.stack}>
          <Carte title="Modèle">
            <div className={layout.stack}>
              <div className={layout.form}>
                <Champ
                  label="Modèle à modifier"
                  type="select"
                  value={item.id}
                  options={(list.data?.items ?? [item]).map((entry) => ({ value: entry.id, label: entry.name }))}
                  onChange={(value) => void navigate(`/parametres/modeles/${value}`)}
                />
                <Champ label="Nom affiché dans l’application" value={item.name} readOnly />
              </div>
              <div className={layout.chips}>
                {[
                  ['Type', item.channel],
                  ['Catégorie', item.category === 'COLLECTION' ? 'Recouvrement' : 'Facturation'],
                  ['Version en service', `v${item.version} du ${item.date}`],
                  ['Validation', item.validator],
                ].map(([label, value]) => (
                  <Badge key={label} label={`${label} : ${value}`} tone="neutral" />
                ))}
              </div>
            </div>
          </Carte>
          <Carte
            title={`Fichier ${extension.toUpperCase()} du modèle`}
            description="Téléchargez le fichier, modifiez-le dans votre éditeur, puis importez la nouvelle version. Les champs de fusion s’écrivent {{debiteur.raison_sociale}}."
          >
            <div className={layout.stack}>
              <div className={css.file}>
                <Badge label={extension.toUpperCase()} tone="marine" />
                <span className={`${layout.text} ${layout.grow}`}>
                  <span className={layout.strong}>{item.fileName}</span>
                  <span className={layout.hint}>
                    v{item.version} · {item.fileSize} · importé le {item.date} par {item.author}
                  </span>
                </span>
                <Bouton variant="secondary" size="sm" icon="download" label="Télécharger" onPress={download} />
              </div>
              {item.canImport && !item.pending && item.status !== 'WAITING' && (
                <div
                  className={css.drop}
                  data-over={over || undefined}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOver(false);
                    void importFile(event.dataTransfer.files[0]);
                  }}
                >
                  <span>Déposez le fichier .{extension} modifié ici</span>
                  <span className={layout.hint}>ou</span>
                  <Bouton size="sm" icon="upload" label="Choisir un fichier" onPress={() => input.current?.click()} />
                  <span className={layout.hint}>{extension.toUpperCase()} en UTF-8, 500 Ko maximum, sans script ni ressource externe</span>
                </div>
              )}
              <input
                ref={input}
                type="file"
                accept={`.${extension}`}
                hidden
                aria-label="Fichier du modèle"
                onChange={(event) => {
                  void importFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              {fileError && <Alerte tone="danger" text={fileError} />}
              {item.pending && (
                <div className={layout.stack} role="status">
                  <div className={layout.between}>
                    <span className={layout.strong}>
                      {errors.length > 0
                        ? `Import refusé : ${errors.length} erreur${errors.length > 1 ? 's' : ''} à corriger`
                        : warnings.length > 0
                          ? 'Fichier conforme, alertes à valider'
                          : 'Fichier conforme, prêt à être soumis'}
                    </span>
                    <span className={layout.hint}>{item.pending.fileName}</span>
                  </div>
                  <ul className={css.checks}>
                    {item.pending.checks.map((check) => (
                      <li key={check.label + check.detail}>
                        <Icone
                          icon={check.level === 'OK' ? 'check' : check.level === 'WARNING' ? 'alert' : 'x'}
                          size={16}
                          color={`var(--${{ OK: 'success', WARNING: 'warning', ERROR: 'danger' }[check.level]}-fg)`}
                        />
                        <span className={layout.text}>
                          <span>
                            {check.level === 'WARNING' && 'Alerte : '}
                            {check.level === 'ERROR' && 'Erreur : '}
                            {check.label}
                          </span>
                          {check.detail && <span className={layout.hint}>{check.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {warnings.length > 0 && errors.length === 0 && item.status !== 'WAITING' && (
                    <Case label="J’ai vérifié ces alertes et je les accepte" checked={acknowledged} onToggle={setAcknowledged} />
                  )}
                </div>
              )}
              {item.canImport && (item.pending || item.status === 'RESTORED') && item.status !== 'WAITING' && (
                <div className={layout.inline}>
                  {errors.length === 0 ? (
                    <Bouton size="sm" label="Soumettre pour validation" disabled={warnings.length > 0 && !acknowledged} onPress={submit} />
                  ) : (
                    <Bouton size="sm" icon="upload" label="Importer un fichier corrigé" onPress={() => input.current?.click()} />
                  )}
                  <Bouton variant="secondary" size="sm" label="Annuler l’import" onPress={() => void cancelImport()} />
                </div>
              )}
              <div className={layout.between}>
                <span className={layout.hint}>Champs utilisés dans ce modèle ({used.length})</span>
                <Bouton variant="link" size="sm" label="Liste complète des champs de fusion" href="/parametres/champs-de-fusion" />
              </div>
              <div className={layout.chips}>
                {used.map((code) => (
                  <span key={code} className={css.code} title={values[code]}>{`{{${code}}}`}</span>
                ))}
              </div>
            </div>
          </Carte>
          <Carte
            title="Mentions imposées"
            description={`${kind === 'sms' ? 'Ajoutées à chaque SMS ; elles comptent dans la longueur du message.' : kind === 'collection' ? 'Ajoutées automatiquement en bas de chaque courrier envoyé pour le compte d’un créancier. Modifiables uniquement par le Directeur.' : 'Ajoutées automatiquement à chaque facture et devis. Modifiables uniquement par le Directeur.'} Bloc à placer dans le fichier : {{> ${item.block}}}`}
            footer="Textes à faire valider par votre juriste avant mise en production."
          >
            <ul className={layout.body}>
              {MANDATORY[kind].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </Carte>
          <Carte title="Historique des versions" padding="none">
            <ol className={layout.list}>
              {item.versions.map((version) => (
                <li key={version.number}>
                  <span className={layout.strong}>v{version.number}</span>
                  <span className={`${layout.text} ${layout.grow}`}>
                    <span>{version.what}</span>
                    <span className={layout.hint}>{version.who}</span>
                  </span>
                  <Badge label={version.state === 'PUBLISHED' ? 'Publiée' : 'Archivée'} tone={version.state === 'PUBLISHED' ? 'success' : 'neutral'} />
                  {version.state === 'ARCHIVED' && item.canImport && item.status === 'PUBLISHED' && (
                    <Bouton
                      variant="ghost"
                      size="sm"
                      label="Restaurer"
                      ariaLabel={`Restaurer : v${version.number}`}
                      onPress={() =>
                        void change(`${path}/restore`, { body: { version: version.number } }).then(() =>
                          toast({
                            message: `Version ${version.number} copiée dans un nouveau brouillon.`,
                            undo: () => void change(`${path}/import`, { method: 'DELETE' }),
                          }),
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ol>
          </Carte>
        </div>
        <section aria-labelledby="apercu-titre" className={layout.stack}>
          <div className={layout.between}>
            <h2 id="apercu-titre" className={css.previewTitle}>
              Aperçu
            </h2>
            <span className={layout.inline}>
              <Champ
                label="Dossier utilisé pour l’aperçu"
                hideLabel
                type="select"
                value={sampleId}
                options={item.samples.map((entry) => ({ value: entry.id, label: entry.label }))}
                onChange={setSampleId}
              />
              <Interrupteur checked={highlight} label="Repérer les champs" labelPosition="end" size="sm" onToggle={setHighlight} />
            </span>
          </div>
          <div className={css.paper}>
            {item.pending?.accepted ? (
              // Sandboxed without any permission: no script, form or navigation from an imported file.
              <iframe title="Aperçu du fichier importé" sandbox="" className={css.frame} srcDoc={`${PREVIEW_POLICY}${item.pending.previewHtml}`} />
            ) : (
              <Preview item={item} values={values} highlight={highlight} kind={kind} />
            )}
          </div>
          <div className={layout.inline}>
            <Bouton variant="secondary" size="sm" label="Télécharger l’aperçu (PDF)" disabled title="Disponible avec l’API de génération" />
            {(item.kind === 'SMS' || item.kind === 'EMAIL') && item.canImport && (
              <Bouton variant="secondary" size="sm" label="M’envoyer un test" onPress={test} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Preview({ item, values, highlight, kind }: { item: TemplateDetail; values: Record<string, string>; highlight: boolean; kind: keyof typeof LEGAL }) {
  const fill = (text: string) =>
    text.split(/(\{[^{}\s]+\})/).map((part, index) => {
      const code = /^\{([^{}\s]+)\}$/.exec(part)?.[1];
      if (!code) return part;
      return (
        <span key={index} className={highlight ? css.field : undefined} title={part}>
          {values[code] ?? part}
        </span>
      );
    });
  const paragraphs = item.body.split(/\n\s*\n/).map((text, index) => <p key={index}>{fill(text)}</p>);
  const legal = (
    <div className={css.legal}>
      <span>Mentions obligatoires, ajoutées automatiquement</span>
      {LEGAL[kind].map((text) => (
        <span key={text}>{fill(text)}</span>
      ))}
    </div>
  );
  if (item.kind === 'SMS')
    return (
      <article aria-label="Aperçu du SMS" className={css.sms}>
        {paragraphs}
        <span>{LEGAL.sms[0]}</span>
      </article>
    );
  if (item.kind === 'EMAIL')
    return (
      <article aria-label="Aperçu de l’e-mail" className={css.doc}>
        <div className={layout.text}>
          <span>
            <b>De :</b> LEGAREC &lt;ne-pas-repondre@mail.legarec.fr&gt;
          </span>
          <span>
            <b>À :</b> {fill('{debiteur.contact}, {debiteur.raison_sociale}')}
          </span>
          <span>
            <b>Objet :</b> {fill(item.subject ?? '')}
          </span>
        </div>
        {paragraphs}
        {legal}
      </article>
    );
  const billing = item.kind === 'INVOICE';
  return (
    <article aria-label="Aperçu du document" className={css.doc}>
      <div className={css.row}>
        <div className={layout.text}>
          <b className={css.brand}>Legarec</b>
          <span>Cabinet de recouvrement amiable</span>
          <span>{billing ? 'Paris · SIREN [SIREN] · TVA [N° TVA]' : 'Paris · 01 87 88 02 98'}</span>
          {!billing && <span>administratif@legarec.fr</span>}
        </div>
        {item.registered && <span className={css.registered}>Lettre recommandée avec AR</span>}
        {billing && (
          <div className={layout.text}>
            <b>{item.quote ? 'Devis' : 'Facture'}</b>
            <span>
              {item.quote ? 'DE-2026-0043' : values['document.numero']} · {values['date.jour']}
            </span>
          </div>
        )}
      </div>
      <div className={css.address}>
        {fill(
          item.category === 'COLLECTION'
            ? '{debiteur.raison_sociale}\n{debiteur.contact}\n{debiteur.adresse}'
            : '{client.nom}\n{client.contact}\n{client.adresse}',
        )}
      </div>
      {!billing && <span className={css.right}>Paris, le {values['date.jour']}</span>}
      {item.subject && (
        <p>
          <b>{billing ? '' : 'Objet : '}</b>
          {fill(item.subject)}
        </p>
      )}
      {billing && (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Montant HT</th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((line) => (
                <tr key={line.label}>
                  <td>
                    <span className={layout.text}>
                      <span>{line.label}</span>
                      <small>{line.detail}</small>
                    </span>
                  </td>
                  <td>{fill(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {item.totals.map((value, index) => (
            <div key={index} className={css.row}>
              <span>{['Total HT', 'TVA 20 %', 'Total TTC'][index]}</span>
              <b>{value}</b>
            </div>
          ))}
        </>
      )}
      {paragraphs}
      {!billing && (
        <p>
          {fill(
            item.kind === 'CONTRACT'
              ? 'Fait à Paris, le {date.jour}, en signature électronique.'
              : item.category === 'COLLECTION'
                ? '{dossier.gestionnaire}\nGestionnaire de votre dossier · 01 87 88 02 98'
                : 'Le service administratif de Legarec',
          )}
        </p>
      )}
      {legal}
    </article>
  );
}
