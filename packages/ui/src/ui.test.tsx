import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Alerte,
  Avatar,
  Badge,
  Bouton,
  Carte,
  Case,
  Champ,
  Embleme,
  EtatListe,
  Icone,
  Indicateur,
  Interrupteur,
  Onglets,
  PageConnexion,
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
} from './index';
import { axeViolations, renderUi } from './testing';

const noop = () => {};

it('has no axe violation across the library', async () => {
  const { container } = renderUi(
    <main>
      <PageHeader
        title="Débiteurs"
        description="Tous les dossiers"
        stats={[{ label: 'Encours', value: '48 200 €', sub: 'Détail', bar: 40 }]}
        actions={[{ label: 'Nouveau', primary: true, kbd: 'N', onPress: noop }]}
        status={{ label: 'Synchronisé', tone: 'success' }}
      />
      <Toolbar
        tabs={[{ label: 'Tous', count: 24, selected: true, pick: noop }]}
        filters={[{ label: 'Statut', value: 'Tous', options: ['Tous'], onChange: noop }]}
        views={[{ label: 'Liste', selected: true, pick: noop }]}
        period={{ label: 'Novembre 2026', prev: noop, next: noop, today: noop }}
        scope={{ name: 'Médiatel', onReset: noop }}
        note="Note"
      />
      <Badge label="Litige" tone="violet" dot icon="alert" /> <Statut label="Actif" tone="success" pulse /> <Avatar title="Camille Laurent" presence="dispo" />{' '}
      <Embleme /> <Icone icon="euro" label="Euro" />
      <Bouton label="Enregistrer" onPress={noop} /> <Bouton label="Chercher" icon="search" iconOnly onPress={noop} />{' '}
      <Bouton label="Voir" href="/x" variant="link" />
      <Champ label="Adresse" value="" error="Adresse invalide" onChange={noop} />{' '}
      <Champ label="Type" type="select" value="a" options={['a', 'b']} onChange={noop} />{' '}
      <Champ label="Note" type="textarea" value="" help="Aide" onChange={noop} />
      <Interrupteur label="Activer" checked onToggle={noop} /> <Interrupteur label="Imposé" checked locked />{' '}
      <Case label="Accepter" checked description="Texte" onToggle={noop} />
      <Reglage label="Relances" description="Texte" checked onToggle={noop} first /> <Reglage label="Nom" kind="text" value="x" onChange={noop} />
      <Onglets
        items={[
          { label: 'A', selected: true, pick: noop },
          { label: 'B', selected: false, pick: noop },
        ]}
        variant="underline"
        label="Sections"
      />
      <Carte title="Carte" footer="Pied">
        Contenu
      </Carte>{' '}
      <Tuile title="Comptes" description="Texte" status="Actif" href="/y" />
      <Alerte title="Titre" text="Texte" onDismiss={noop} /> <Progression value={40} showValue /> <Indicateur label="Total" value="4" />
      <EtatListe kind="loading" /> <EtatListe kind="error" onAction={noop} /> <Pagination total={248} page={2} size={25} onPage={noop} onSize={noop} />
      <Tableau
        caption="Débiteurs"
        columns={[{ key: 'n', label: 'Nom', value: (row: { id: string }) => row.id, sortValue: (row) => row.id }]}
        rows={[{ id: 'a' }]}
        rowId={(row) => row.id}
        selection={{ selected: [], onChange: noop }}
      />
      <SuggestionIA title="Synthèse" facts={[{ k: 'Montant', v: '1 €' }]} onApply={noop} onIgnore={noop} /> <PiedDePage />
    </main>,
  );
  expect(await axeViolations(container)).toEqual([]);
});

describe('Bouton', () => {
  it('does not fire while loading or disabled', async () => {
    const press = vi.fn();
    renderUi(
      <>
        <Bouton label="A" loading onPress={press} />
        <Bouton label="B" disabled onPress={press} />
      </>,
    );
    for (const button of screen.getAllByRole('button')) await userEvent.click(button);
    expect(press).not.toHaveBeenCalled();
  });
});

describe('Champ', () => {
  it('links label, help and error', () => {
    renderUi(<Champ label="E-mail" value="" help="Aide" error="Adresse invalide" onChange={noop} />);
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Adresse invalide');
  });
  it('draws its action inside the field, after it in the tab order', async () => {
    const show = vi.fn();
    renderUi(
      <Champ label="Mot de passe" type="password" value="" onChange={noop} action={<Bouton variant="ghost" size="sm" label="Afficher" onPress={show} />} />,
    );
    const input = screen.getByLabelText('Mot de passe');
    const button = screen.getByRole('button', { name: 'Afficher' });
    expect(input).toHaveAttribute('data-action');
    expect(input.closest('.row')).toContainElement(button);
    input.focus();
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(show).toHaveBeenCalledOnce();
  });
});

describe('PageConnexion', () => {
  it('shows the negative logo of the media kit, served with the page, never the name as a logo', async () => {
    const { container } = renderUi(
      <PageConnexion>
        <h2>Connexion</h2>
      </PageConnexion>,
    );
    const logo = screen.getByRole('img', { name: 'Legarec, cabinet de recouvrement' });
    expect(logo.getAttribute('src')).toMatch(/legarec-logo-horizontal-negatif.*\.png$/);
    expect(logo.getAttribute('src')).not.toMatch(/^https?:|media\.legarec\.fr/);
    expect(screen.queryByText('Legarec, cabinet de recouvrement')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Onglets', () => {
  it('moves with the arrow keys', async () => {
    const pick = vi.fn();
    renderUi(
      <Onglets
        items={[
          { label: 'A', selected: true, pick: noop },
          { label: 'B', selected: false, pick },
        ]}
      />,
    );
    screen.getByRole('tab', { name: 'A' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(pick).toHaveBeenCalledOnce();
  });
});

describe('Tableau', () => {
  const rows = [
    { id: 'b', n: 2 },
    { id: 'a', n: 1 },
  ];
  const columns = [{ key: 'id', label: 'Nom', value: (row: (typeof rows)[number]) => row.id, sortValue: (row: (typeof rows)[number]) => row.id }];
  it('sorts and selects rows', async () => {
    const onChange = vi.fn();
    renderUi(<Tableau columns={columns} rows={rows} rowId={(row) => row.id} selection={{ selected: [], onChange }} />);
    await userEvent.click(screen.getByRole('button', { name: /Nom/ }));
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[1]?.textContent),
    ).toEqual(['a', 'b']);
    await userEvent.click(screen.getByLabelText('Sélectionner b'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });
  it('shows the requested state instead of rows', () => {
    renderUi(<Tableau columns={columns} rows={rows} rowId={(row) => row.id} state={{ kind: 'error', onAction: noop }} />);
    expect(screen.getByText('Chargement impossible')).toBeVisible();
    expect(screen.queryByText('a')).toBeNull();
  });
});

function Asker({ run, ...request }: { run: () => Promise<unknown>; reasonLabel?: string; typeToConfirm?: { label: string; expected: string } }) {
  const ask = useConfirm();
  return (
    <Bouton
      label="Ouvrir"
      onPress={() => ask({ title: 'Envoyer ?', body: 'Texte', confirmLabel: 'Envoyer', details: [{ k: 'Montant', v: '1 €' }], onConfirm: run, ...request })}
    />
  );
}

describe('Confirm', () => {
  it('shows the summary, requires the reason and returns focus', async () => {
    const run = vi.fn(async () => undefined);
    renderUi(<Asker run={run} reasonLabel="Motif" />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('1 €')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Motif'), 'Accord reçu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Envoyer' }));
    expect(run).toHaveBeenCalledWith('Accord reçu', false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ouvrir' })).toHaveFocus());
  });
  it('requires the exact text for irreversible actions', async () => {
    renderUi(<Asker run={async () => undefined} typeToConfirm={{ label: 'Adresse', expected: 'xx@legarec.fr' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText('Adresse'), 'xx@legarec');
    expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Adresse'), '.fr');
    expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toBeEnabled();
  });
  it('stays open with an error when the action fails', async () => {
    renderUi(
      <Asker
        run={async () => {
          throw new Error('500');
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rien n’a été enregistré');
  });
  it('cancels with Escape', async () => {
    const run = vi.fn(async () => undefined);
    renderUi(<Asker run={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(run).not.toHaveBeenCalled();
  });
});

it('offers Annuler in toasts for reversible actions', async () => {
  const undo = vi.fn();
  const Show = () => {
    const toast = useToast();
    return <Bouton label="Archiver" onPress={() => toast({ message: 'Archivé', undo })} />;
  };
  renderUi(<Show />);
  await userEvent.click(screen.getByRole('button', { name: 'Archiver' }));
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(undo).toHaveBeenCalledOnce();
});

it('ignores shortcuts while typing', async () => {
  const pick = vi.fn();
  renderUi(<Toolbar tabs={[{ label: 'A', selected: false, pick }]} query="" onQuery={noop} />);
  await userEvent.type(screen.getByRole('searchbox'), '1');
  expect(pick).not.toHaveBeenCalled();
  (document.activeElement as HTMLElement).blur();
  await userEvent.keyboard('1');
  expect(pick).toHaveBeenCalledOnce();
});

it('only names the creditor in the footer when it is given', () => {
  renderUi(<PiedDePage />);
  expect(screen.queryByText(/pour le compte de/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/carte/i);
});
