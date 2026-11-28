import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Alerte,
  Avatar,
  Badge,
  Bouton,
  Carte,
  Case,
  Champ,
  DepotFichiers,
  EditeurTexte,
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
  Sidebar,
  SuggestionIA,
  Tableau,
  Toolbar,
  Tuile,
  useConfirm,
  useToast,
  type SidebarCreditor,
  type SidebarProps,
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

describe('Sidebar', () => {
  const NAMES = [
    'Matériaux Delta',
    'Énergies Rhône',
    'Médiatel',
    'TransAlp Leasing',
    'Crédit Horizon',
    'Bâtiplus',
    'Garage Valmont',
    'Nordis Logistique',
    'Atelier Mistral',
  ];
  const creditors = (count: number): SidebarCreditor[] => [
    { id: 'all', name: 'Tous les créanciers', initials: '∗', count: 248 },
    ...NAMES.slice(0, count).map((name, index) => ({
      id: `c${index}`,
      name,
      initials: name.slice(0, 2).toUpperCase(),
      siren: `40122897${index}`,
      count: index + 1,
    })),
  ];
  const Menu = (props: Partial<SidebarProps>) => {
    const [active, setActive] = useState(props.active ?? '/');
    return (
      <>
        <h1>Page</h1>
        <button type="button" onClick={() => setActive('/relances')}>
          Aller aux relances
        </button>
        <Sidebar
          groups={[
            { id: 'pil', label: 'Pilotage', items: [{ href: '/', label: 'Tableau de bord', icon: 'home' }] },
            {
              id: 'rec',
              label: 'Recouvrement',
              items: [
                { href: '/relances', label: 'Relances', icon: 'agenda' },
                { href: '/echeanciers', label: 'Échéanciers', icon: 'plan' },
              ],
            },
          ]}
          footer={[{ href: '/parametres', label: 'Paramètres', icon: 'settings' }]}
          creditors={creditors(3)}
          creditorId="all"
          creditorsHref="/creanciers"
          onCreditor={noop}
          {...props}
          active={active}
        />
      </>
    );
  };
  const nav = () => screen.getByRole('navigation', { name: 'Navigation principale' });

  it('opens the group of the current page, and gives what the person closes or reduces to be remembered', async () => {
    const onClosedGroups = vi.fn();
    const onCollapsed = vi.fn();
    renderUi(<Menu closedGroups={['rec']} onClosedGroups={onClosedGroups} onCollapsed={onCollapsed} />);
    expect(within(nav()).getByRole('button', { name: 'Recouvrement' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Relances' })).toBeNull();
    // Arriving on one of its pages opens it: the menu shows where one is.
    await userEvent.click(screen.getByRole('button', { name: 'Aller aux relances' }));
    expect(within(nav()).getByRole('link', { name: 'Relances' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav()).getByRole('button', { name: 'Pilotage' }));
    expect(onClosedGroups).toHaveBeenLastCalledWith(['pil']);
    await userEvent.click(within(nav()).getByRole('button', { name: 'Réduire le menu' }));
    expect(onCollapsed).toHaveBeenLastCalledWith(true);
    expect(nav()).toHaveAttribute('data-collapsed');
    expect(within(nav()).getByRole('link', { name: 'Relances' })).toBeVisible();
  });

  it('opens as remembered, the group of the current page open whatever was kept', () => {
    const { unmount } = renderUi(<Menu active="/relances" closedGroups={['rec', 'pil']} />);
    expect(within(nav()).getByRole('link', { name: 'Relances' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('button', { name: 'Pilotage' })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    renderUi(<Menu collapsed />);
    expect(nav()).toHaveAttribute('data-collapsed');
    expect(within(nav()).getByRole('button', { name: 'Agrandir le menu' })).toBeVisible();
  });

  it('lets the creditor be chosen with the keyboard, as in a select', async () => {
    const onCreditor = vi.fn();
    renderUi(<Menu creditorId="c1" onCreditor={onCreditor} />);
    const button = within(nav()).getByRole('button', { name: /changer de créancier/ });
    const option = (name: RegExp) => within(screen.getByRole('listbox', { name: 'Créanciers' })).getByRole('option', { name });
    button.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    // On the creditor shown, then the arrows, Home, End and the first letters.
    expect(option(/Énergies Rhône/)).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(option(/Médiatel/)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(option(/Tous les créanciers/)).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(option(/Médiatel/)).toHaveFocus();
    await userEvent.keyboard('m');
    expect(option(/Matériaux Delta/)).toHaveFocus();
    // Escape closes the list and gives the focus back.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onCreditor).toHaveBeenLastCalledWith('c0');
    expect(button).toHaveFocus();
    // A click elsewhere closes it too.
    await userEvent.click(button);
    expect(screen.getByRole('listbox')).toBeVisible();
    await userEvent.click(screen.getByRole('heading', { name: 'Page' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(await axeViolations(nav())).toEqual([]);
  });

  it('offers a search among many creditors, without the accents', async () => {
    const onCreditor = vi.fn();
    renderUi(<Menu creditors={creditors(9)} onCreditor={onCreditor} />);
    await userEvent.click(within(nav()).getByRole('button', { name: /changer de créancier/ }));
    const field = screen.getByRole('searchbox', { name: 'Rechercher un créancier' });
    expect(field).toHaveFocus();
    await userEvent.type(field, 'energie');
    const list = screen.getByRole('listbox', { name: 'Créanciers' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((item) => item.dataset.name),
    ).toEqual(['Énergies Rhône']);
    await userEvent.keyboard('{ArrowDown}');
    expect(within(list).getByRole('option', { name: /Énergies Rhône/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(field).toHaveFocus();
    await userEvent.clear(field);
    await userEvent.type(field, 'zzz');
    expect(screen.getByText('Aucun créancier ne correspond à « zzz ».')).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, 'valmont{Enter}');
    expect(onCreditor).toHaveBeenLastCalledWith('c6');
    expect(await axeViolations(nav())).toEqual([]);
  });

  it('keeps the focus in the mobile drawer, the page behind out of reach until it closes', async () => {
    renderUi(
      <div>
        <Menu />
        <main>
          <button type="button">Dans la page</button>
        </main>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    await waitFor(() => expect(nav()).toContainElement(document.activeElement as HTMLElement));
    expect(screen.getByText('Dans la page').closest('main')).toHaveAttribute('inert');
    for (let step = 0; step < 12; step += 1) {
      await userEvent.tab();
      expect(nav()).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Ouvrir le menu' })).toHaveFocus();
    expect(screen.getByText('Dans la page').closest('main')).not.toHaveAttribute('inert');
  });
});

describe('date field', () => {
  // The calendar opens with the focus: never the real register in a test.
  const fetch = vi.fn(async (_url: string) => Response.json({ '2027-12-25': 'Jour de Noël' }));
  beforeEach(() => {
    fetch.mockClear();
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => vi.unstubAllGlobals());
  function DateField({ initial = '' }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <Champ label="Date de réception" type="date" value={value} onChange={setValue} />
        <output aria-label="Valeur">{value}</output>
      </>
    );
  }

  it('reads a day typed the French way or as ISO, and refuses a day that does not exist', async () => {
    renderUi(<DateField />);
    const field = screen.getByLabelText('Date de réception');
    await userEvent.type(field, '05/12/2026');
    expect(screen.getByLabelText('Valeur')).toHaveTextContent('2026-12-05');
    await userEvent.clear(field);
    await userEvent.type(field, '2026-02-03');
    expect(screen.getByLabelText('Valeur')).toHaveTextContent('2026-02-03');
    await userEvent.clear(field);
    await userEvent.type(field, '31/02/2026');
    expect(screen.getByLabelText('Valeur')).toHaveTextContent('');
  });

  it('names the public holidays of the State in its calendar, asking only for the year', async () => {
    renderUi(<DateField initial="2027-12-05" />);
    await userEvent.click(screen.getByLabelText('Date de réception'));
    expect(await screen.findByRole('button', { name: /25 décembre 2027, Jour de Noël, jour férié/u })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://calendrier.api.gouv.fr/jours-feries/metropole/2027.json');
  });
});

describe('DepotFichiers', () => {
  function Drop() {
    const [files, setFiles] = useState<File[]>([]);
    return <DepotFichiers label="Déposez vos factures" hint="PDF, 10 Mo maximum" accept=".pdf" multiple files={files} onChange={setFiles} />;
  }
  it('takes a PDF picked, says why another file is refused, and removes a file', async () => {
    renderUi(<Drop />);
    const input = screen.getByLabelText('Déposez vos factures');
    expect(input).toHaveAttribute('accept', '.pdf');
    await userEvent.upload(input, new File(['x'], 'F-2026-0712.pdf', { type: 'application/pdf' }));
    expect(within(screen.getByRole('list', { name: 'Fichiers choisis' })).getByText('F-2026-0712.pdf')).toBeVisible();
    await userEvent.upload(input, new File(['x'], 'outil.exe', { type: 'application/octet-stream' }), { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent('Fichier refusé : PDF, 10 Mo maximum.');
    await userEvent.click(screen.getByRole('button', { name: 'Retirer F-2026-0712.pdf' }));
    expect(screen.queryByRole('list', { name: 'Fichiers choisis' })).toBeNull();
  });
});

it('writes a phone number the way of the firm once typed', async () => {
  function Phone() {
    const [value, setValue] = useState('');
    return <Champ label="Téléphone" type="tel" value={value} onChange={setValue} />;
  }
  renderUi(<Phone />);
  await userEvent.type(screen.getByLabelText('Téléphone'), '+33612345678');
  await userEvent.tab();
  expect(screen.getByLabelText('Téléphone')).toHaveValue('06 12 34 56 78');
});

it('draws only the rows near the screen in a long table, and still says how many it has', () => {
  const rows = Array.from({ length: 500 }, (_, index) => ({ id: `d${index}`, name: `Dossier ${index + 1}` }));
  renderUi(<Tableau caption="Dossiers" rowId={(row) => row.id} rows={rows} columns={[{ key: 'name', label: 'Débiteur', value: (row) => row.name }]} />);
  const table = screen.getByRole('table');
  expect(table).toHaveAttribute('aria-rowcount', '501');
  const drawn = within(table)
    .getAllByRole('row')
    .filter((row) => row.hasAttribute('aria-rowindex'));
  expect(drawn.length).toBeGreaterThan(10);
  expect(drawn.length).toBeLessThan(100);
  expect(screen.getByText('Dossier 1')).toBeVisible();
  expect(screen.queryByText('Dossier 500')).toBeNull();
});

it('draws every row of a short table', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `d${index}`, name: `Dossier ${index + 1}` }));
  renderUi(<Tableau caption="Dossiers" rowId={(row) => row.id} rows={rows} columns={[{ key: 'name', label: 'Débiteur', value: (row) => row.name }]} />);
  expect(screen.getByRole('table')).not.toHaveAttribute('aria-rowcount');
  expect(screen.getByText('Dossier 30')).toBeInTheDocument();
});

describe('EditeurTexte', () => {
  function Message({ initial = '' }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <EditeurTexte label="Message" required value={value} onChange={setValue} help="Une ligne vide sépare deux paragraphes." />
        <output aria-label="Texte">{value}</output>
        <button type="button" onClick={() => setValue('Modèle inséré')}>
          Insérer
        </button>
      </>
    );
  }
  it('is a labelled text box, with a toolbar in French', async () => {
    const { container } = renderUi(<Message />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box).toHaveAttribute('aria-describedby');
    expect(box).toHaveAttribute('aria-required', 'true');
    for (const name of ['Gras', 'Italique', 'Liste à puces', 'Liste numérotée']) expect(screen.getByRole('button', { name })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });
  it('shows a text with marks formatted, and gives back what it is given', () => {
    renderUi(<Message initial={'Le solde : **4 320 €**.\n\n- F-1\n- F-2'} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(within(box).getByText('4 320 €').tagName).toBe('STRONG');
    expect(within(box).getAllByRole('listitem')).toHaveLength(2);
  });
  it('takes a text put from outside', async () => {
    renderUi(<Message initial="Bonjour" />);
    await userEvent.click(screen.getByRole('button', { name: 'Insérer' }));
    expect(within(screen.getByRole('textbox', { name: 'Message' })).getByText('Modèle inséré')).toBeInTheDocument();
  });
  it('writes what is typed, in bold once asked', async () => {
    renderUi(<Message />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.click(box);
    await userEvent.type(box, 'Bonjour ');
    await userEvent.click(screen.getByRole('button', { name: 'Gras' }));
    await userEvent.type(box, 'urgent');
    expect(screen.getByLabelText('Texte')).toHaveTextContent('Bonjour **urgent**');
  });
});

it('ignores shortcuts while typing in the editor of a message', async () => {
  const pick = vi.fn();
  renderUi(
    <>
      <Toolbar tabs={[{ label: 'A', selected: false, pick }]} query="" onQuery={noop} />
      <EditeurTexte label="Message" value="" onChange={noop} />
    </>,
  );
  const box = screen.getByRole('textbox', { name: 'Message' });
  await userEvent.click(box);
  await userEvent.type(box, '1');
  expect(pick).not.toHaveBeenCalled();
});
