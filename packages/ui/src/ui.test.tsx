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
  PortailContext,
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
  it('keeps a part to come reachable: greyed, described, and saying why instead of acting', async () => {
    const press = vi.fn();
    const { container } = renderUi(
      <main>
        <Bouton label="Exporter" soon onPress={press} />
        <Bouton label="Envoyer" variant="secondary" disabled soon="l’envoi n’est pas encore relié à l’espace." onPress={press} />
        <Bouton label="Appeler" href="/appels" soon="la téléphonie n’est pas encore reliée à l’espace." />
        <Tuile title="Boîtes e-mail" href="/boites" soon />
      </main>,
    );
    const exporter = screen.getByRole('button', { name: 'Exporter' });
    expect(exporter).toHaveAccessibleDescription('Bientôt disponible.');
    expect(exporter).toHaveAttribute('title', 'Bientôt disponible.');
    // Never disabled: it is reached with the keyboard, and pressed.
    const send = screen.getByRole('button', { name: 'Envoyer' });
    expect(send).toBeEnabled();
    send.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Bientôt disponible : l’envoi n’est pas encore relié à l’espace.', { selector: '[role="status"] span' })).toBeVisible();
    expect(press).not.toHaveBeenCalled();
    // A link still leads to its page.
    const call = screen.getByRole('link', { name: 'Appeler' });
    expect(call).toHaveAttribute('href', '/appels');
    expect(call).toHaveAccessibleDescription('Bientôt disponible : la téléphonie n’est pas encore reliée à l’espace.');
    expect(screen.getByRole('link', { name: /Boîtes e-mail/ })).toHaveTextContent('Bientôt');
    expect(await axeViolations(container)).toEqual([]);
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

describe('Champ, password', () => {
  it('says that Caps Lock is on while typing a password, and announces it', async () => {
    renderUi(<Champ label="Mot de passe" type="password" value="" onChange={noop} />);
    const input = screen.getByLabelText('Mot de passe');
    const status = document.getElementById(`${input.id}-caps`);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    // One keyboard for the whole test: Caps Lock stays on between two calls, as on a real one.
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{CapsLock}a');
    expect(status).toHaveTextContent('Majuscules activées');
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-caps`);
    await user.keyboard('{CapsLock}b');
    expect(status).toBeEmptyDOMElement();
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('keeps the warning off the other fields', () => {
    renderUi(<Champ label="Nom" value="" onChange={noop} />);
    expect(document.getElementById(`${screen.getByLabelText('Nom').id}-caps`)).toBeNull();
  });
});

describe('PageConnexion', () => {
  it('shows the firm as on every portal, the emblem of the kit next to its name in text, never the logo file', async () => {
    const { container } = renderUi(
      <PageConnexion>
        <h1>Connexion</h1>
      </PageConnexion>,
    );
    const intro = screen.getByRole('region', { name: 'Présentation' });
    expect(within(intro).getByText('Legarec')).toBeVisible();
    expect(within(intro).getByText('Cabinet de recouvrement')).toBeVisible();
    expect(within(intro).queryByRole('img')).toBeNull();
    expect(container.querySelector('img[src*="logo"]')).toBeNull();
    // One title for the page, the one of the form: the line on the portal is not a heading.
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Connexion']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('leads to help that opens without an account: the sign-in help of the staff, the help of the creditors', () => {
    const { unmount } = renderUi(
      <PageConnexion>
        <h1>Connexion</h1>
      </PageConnexion>,
    );
    expect(screen.getByRole('link', { name: 'Aide à la connexion' })).toHaveAttribute('href', '/aide-connexion');
    unmount();
    renderUi(
      <PortailContext.Provider value="partenaires">
        <PageConnexion>
          <h1>Connexion</h1>
        </PageConnexion>
      </PortailContext.Provider>,
    );
    expect(screen.getByRole('link', { name: 'Centre d’aide' })).toHaveAttribute('href', '/aide');
  });

  it('does not link the help page to itself', () => {
    renderUi(
      <PageConnexion help={false}>
        <h1>Aide à la connexion</h1>
      </PageConnexion>,
    );
    expect(screen.queryByText(/Besoin d.aide/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Aide à la connexion' })).toBeNull();
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
