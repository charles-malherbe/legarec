import { MANDATORY_BLOCKS, MERGE_FIELDS } from '@legarec/contracts';
import { Carte, EtatListe, PageHeader, Tableau, Toolbar } from '@legarec/ui';
import { useState } from 'react';
import layout from '@legarec/ui/layout.module.css';
import { matches } from '../../shared/listState';

export function MergeFieldsPage() {
  const [query, setQuery] = useState('');
  const rows = MERGE_FIELDS.filter((item) => matches(query, item.code, item.label, item.group));
  const groups = [...new Set(rows.map((item) => item.group))];
  return (
    <>
      <PageHeader title="Champs de fusion" description="À écrire entre deux accolades dans les fichiers des modèles, par exemple {{debiteur.raison_sociale}}" />
      <Toolbar label="Recherche" placeholder="Champ, description…" query={query} onQuery={setQuery} />
      {groups.length === 0 && (
        <div className={layout.card}>
          <EtatListe kind="noresult" onAction={() => setQuery('')} />
        </div>
      )}
      {groups.map((group) => (
        <Carte key={group} title={group} padding="none">
          <Tableau
            caption={group}
            hideCaption
            bordered={false}
            rows={rows.filter((item) => item.group === group)}
            rowId={(row) => row.code}
            columns={[
              { key: 'code', label: 'Champ', render: (row) => <code>{`{{${row.code}}}`}</code> },
              { key: 'label', label: 'Description', render: (row) => row.label },
              { key: 'example', label: 'Exemple', render: (row) => row.example },
              { key: 'scope', label: 'Utilisable dans', render: (row) => row.scope },
            ]}
          />
        </Carte>
      ))}
      <Carte title="Blocs imposés" padding="none">
        <Tableau
          caption="Blocs imposés"
          hideCaption
          bordered={false}
          rows={[...MANDATORY_BLOCKS]}
          rowId={(row) => row.code}
          columns={[
            { key: 'code', label: 'Bloc', render: (row) => <code>{`{{> ${row.code}}}`}</code> },
            { key: 'usedIn', label: 'Obligatoire dans', render: (row) => row.usedIn },
            { key: 'content', label: 'Contenu', render: (row) => row.content },
          ]}
        />
      </Carte>
    </>
  );
}
