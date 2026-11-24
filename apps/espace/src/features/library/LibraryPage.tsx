import {
  Alerte,
  Avatar,
  Badge,
  Bouton,
  Carte,
  Case,
  Champ,
  DepotFichiers,
  EtatListe,
  FilMessages,
  Icone,
  Indicateur,
  Interrupteur,
  Onglets,
  PageHeader,
  Pagination,
  PiedDePage,
  Progression,
  Reglage,
  Statut,
  SuggestionIA,
  Tableau,
  Toolbar,
  Tuile,
  useConfirm,
  useToast,
  type IconName,
  type Tone,
} from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState, type ReactNode } from 'react';

const TONES: Tone[] = ['neutral', 'marine', 'info', 'success', 'warning', 'danger', 'violet', 'teal', 'or'];
const ICONS: IconName[] = [
  'plus',
  'search',
  'phone',
  'mail',
  'sms',
  'calendar',
  'user',
  'euro',
  'file',
  'scale',
  'settings',
  'shield',
  'check',
  'alert',
  'info',
  'lock',
];
const VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'danger-outline', 'success', 'dark', 'link'] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Carte title={title}>
      <div className={layout.inline}>{children}</div>
    </Carte>
  );
}

/** Demonstration of packages/ui, only routed in development. */
export function LibraryPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState('one');
  const [text, setText] = useState('');
  const [on, setOn] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [page, setPage] = useState(1);
  const tabs = [
    { label: 'Premier', count: 3, selected: tab === 'one', pick: () => setTab('one') },
    { label: 'Second', selected: tab === 'two', pick: () => setTab('two') },
  ];
  return (
    <>
      <PageHeader
        title="Bibliothèque de composants"
        description="Composants de packages/ui, en développement seulement"
        status={{ label: 'À jour', tone: 'success' }}
        stats={[
          { label: 'Composants', value: '36' },
          { label: 'Erreurs axe', value: '0', tone: 'success' },
        ]}
        actions={[{ label: 'Action principale', primary: true, onPress: () => toast({ message: 'Action effectuée.', undo: () => undefined }) }]}
      />
      <Toolbar label="Exemple de barre d’outils" tabsLabel="Vues" tabs={tabs} placeholder="Rechercher…" query={text} onQuery={setText} />
      <Group title="Bouton">
        {VARIANTS.map((variant) => (
          <Bouton key={variant} variant={variant} label={variant} />
        ))}
        <Bouton label="Désactivé" disabled />
        <Bouton label="Chargement" loading />
      </Group>
      <Group title="Icone">
        {ICONS.map((icon) => (
          <Icone key={icon} icon={icon} size={20} />
        ))}
      </Group>
      <Group title="Badge et Statut">
        {TONES.map((tone) => (
          <Badge key={tone} label={tone} tone={tone} />
        ))}
        <Statut label="En service" tone="success" />
        <Statut label="À surveiller" tone="warning" />
      </Group>
      <Group title="Avatar">
        <Avatar title="Camille Laurent" presence="call" />
        <Avatar title="Hugo Benali" presence="dispo" tone="or" />
        <Avatar title="Sarah Morel" presence="off" tone="info" />
      </Group>
      <Carte title="Champ">
        <div className={layout.form}>
          <Champ label="Texte" value={text} help="Une aide reliée au champ" onChange={setText} />
          <Champ label="En erreur" value="" error="Ce champ est obligatoire." />
          <Champ
            label="Liste"
            type="select"
            value="a"
            options={[
              { value: 'a', label: 'Choix A' },
              { value: 'b', label: 'Choix B' },
            ]}
          />
        </div>
      </Carte>
      <Group title="Interrupteur et Case">
        <Interrupteur checked={on} label="Activer" labelPosition="end" onToggle={setOn} />
        <Interrupteur checked locked label="Toujours actif" labelPosition="end" />
        <Case label="Case à cocher" checked={on} onToggle={setOn} />
      </Group>
      <Carte title="Reglage" padding="none">
        <Reglage first label="Réglage" description="Description du réglage" checked={on} onToggle={setOn} />
        <Reglage kind="value" label="Valeur" value="01 87 88 02 98" status="Vérifié" statusTone="success" />
      </Carte>
      <Group title="Onglets et Pagination">
        <Onglets label="Exemple segmenté" items={tabs} />
        <Onglets label="Exemple souligné" variant="underline" items={tabs} />
        <Pagination page={page} size={25} total={248} onPage={setPage} onSize={() => undefined} />
      </Group>
      <div className={layout.grid}>
        <Tuile title="Tuile" description="Accès à une rubrique" icon="settings" status="À jour" href="/parametres" />
        <Indicateur label="Indicateur" value="54 %" sub="sur 30 jours" bar={54} />
      </div>
      <Carte title="Progression">
        <Progression value={62} label="Objectif" showValue />
      </Carte>
      <Alerte tone="info" title="Information" text="Un message d’information." />
      <Alerte tone="success" text="Un message de réussite." />
      <Alerte tone="warning" text="Un avertissement." />
      <Alerte tone="danger" title="Erreur" text="Un message d’erreur." />
      <Carte title="Tableau" padding="none">
        <Tableau
          caption="Exemple de tableau"
          hideCaption
          bordered={false}
          rows={[
            { id: '1', name: 'Bâtiplus SAS', amount: '48 200 €' },
            { id: '2', name: 'Atelier Mistral', amount: '3 480 €' },
          ]}
          rowId={(row) => row.id}
          columns={[
            { key: 'name', label: 'Débiteur', render: (row) => row.name },
            { key: 'amount', label: 'Montant', align: 'right', render: (row) => row.amount },
          ]}
        />
      </Carte>
      <Carte title="EtatListe">
        <EtatListe kind="empty" />
        <EtatListe kind="noresult" onAction={() => undefined} />
        <EtatListe kind="error" onAction={() => undefined} />
      </Carte>
      <Group title="Confirm et Toast">
        <Bouton
          variant="secondary"
          label="Ouvrir une confirmation"
          onPress={() =>
            confirm({
              title: 'Confirmer cet exemple ?',
              body: 'Rien n’est enregistré.',
              details: [{ k: 'Exemple', v: 'Oui' }],
              confirmLabel: 'Confirmer',
              onConfirm: () => undefined,
            })
          }
        />
        <Bouton variant="secondary" label="Afficher un toast" onPress={() => toast({ message: 'Exemple de message.', undo: () => undefined })} />
      </Group>
      <SuggestionIA
        title="Suggestion de l’IA"
        note="À vérifier avant de s’y fier."
        facts={[
          { k: 'Premier', v: 'élément' },
          { k: 'Second', v: 'élément' },
        ]}
      />
      <Carte title="DepotFichiers">
        <DepotFichiers label="Déposez un fichier" hint="PDF, 10 Mo max." accept=".pdf" files={files} onChange={setFiles} />
      </Carte>
      <Carte title="FilMessages">
        <FilMessages
          label="Exemple de fil"
          messages={[
            { id: '1', mine: false, who: 'Cabinet', when: '09:40', text: 'Bonjour' },
            { id: '2', mine: true, who: 'Vous', when: '10:02', text: 'Bonjour', receipt: 'Reçu' },
          ]}
        />
      </Carte>
      <PiedDePage />
    </>
  );
}
