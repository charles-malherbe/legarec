import { settingsHub } from '@legarec/contracts';
import { Alerte, Bouton, Champ, EtatListe, Onglets, PageHeader, Tuile, type IconName } from '@legarec/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApi } from '../../app/data';
import { opens } from '../../app/features';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import { matches } from '../../shared/listState';
import css from './Settings.module.css';
import { SectionBody } from './SectionBody';

const TITLES = {
  firm: {
    title: 'Paramètres du cabinet',
    hub: 'Choisissez un thème. Les réglages techniques sont réservés au rôle Développeur.',
  },
  techniques: {
    title: 'Paramètres techniques',
    hub: '3CX, e-mails, boîtes OVH, API, secrets, sécurité et journaux · rôle Développeur',
  },
};

export function SettingsPage({ scope = 'firm' }: { scope?: 'firm' | 'techniques' }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { section } = useParams();
  const base = scope === 'firm' ? '/parametres' : '/parametres/techniques';
  const denied = scope === 'techniques' && user.role !== 'DEVELOPER' && user.role !== 'DIRECTOR';
  const { data, error, refetch } = useApi(settingsHub, `/settings/${scope}`, { enabled: !denied });
  const [query, setQuery] = useState('');
  const header = TITLES[scope];
  if (denied)
    return (
      <>
        <PageHeader title={header.title} />
        <section role="alert" className={layout.card}>
          <EtatListe
            kind="error"
            title="Réservé au rôle Développeur"
            text="La configuration technique (3CX, e-mails, boîtes OVH, API, secrets, sécurité et journaux) n’est accessible qu’au Développeur et au Directeur."
            actionLabel="Retour aux paramètres du cabinet"
            onAction={() => void navigate('/parametres')}
          />
        </section>
      </>
    );
  // The section of a part left out of this build is not offered (its address leads to « Page introuvable »).
  const groups = (data?.groups ?? [])
    .map((item) => ({ ...item, tiles: item.tiles.filter((tile) => opens(`${base}/${tile.id}`)) }))
    .filter((item) => item.tiles.length > 0);
  const group = groups.find((item) => item.tiles.some((tile) => tile.id === section));
  const current = group?.tiles.find((tile) => tile.id === section);
  const hits = groups
    .map((item) => ({ ...item, tiles: item.tiles.filter((tile) => matches(query, tile.title, tile.description, item.label)) }))
    .filter((item) => item.tiles.length > 0);
  return (
    <>
      {section && (
        <Bouton label={`Tous les ${header.title.toLowerCase()}`} icon="arrow-left" variant="link" size="sm" href={base} layout={{ alignSelf: 'flex-start' }} />
      )}
      <PageHeader
        title={section ? (current?.title ?? header.title) : header.title}
        description={section ? (current?.description ?? '') : header.hub}
        actions={
          scope === 'techniques'
            ? [{ label: 'Paramètres du cabinet', icon: 'building', size: 'sm', href: '/parametres' }]
            : user.role === 'DEVELOPER' || user.role === 'DIRECTOR'
              ? [{ label: 'Paramètres techniques', icon: 'code', size: 'sm', href: '/parametres/techniques' }]
              : []
        }
      />
      {!data ? (
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : !section ? (
        <div className={css.hub}>
          <div className={css.search}>
            <Champ
              type="search"
              label="Rechercher un paramètre"
              hideLabel
              placeholder="Rechercher : SMS, mot de passe, logo…"
              value={query}
              onChange={setQuery}
            />
          </div>
          {hits.length === 0 && <EtatListe kind="noresult" actionLabel="Effacer la recherche" onAction={() => setQuery('')} />}
          <div className={css.groups}>
            {hits.map((item) => (
              <section key={item.label} aria-label={item.label} className={css.group}>
                <h2>{item.label}</h2>
                <div className={css.tiles}>
                  {item.tiles.map((tile) => (
                    <Tuile
                      key={tile.id}
                      title={tile.title}
                      description={tile.description}
                      icon={tile.icon as IconName}
                      status={tile.status}
                      statusTone={tile.statusTone}
                      badge={data.canEdit || tile.id === 'users' ? undefined : 'Lecture seule'}
                      href={`${base}/${tile.id}`}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : !current || !group ? (
        <div className={layout.card}>
          <EtatListe
            kind="empty"
            title="Paramètre introuvable"
            text="Ce paramètre n’existe pas ou ne vous est pas accessible."
            actionLabel="Tous les paramètres"
            onAction={() => void navigate(base)}
          />
        </div>
      ) : (
        <>
          {group.tiles.length > 1 && (
            <Onglets
              variant="underline"
              label={group.label}
              items={group.tiles.map((tile) => ({ label: tile.title, selected: tile.id === section, pick: () => void navigate(`${base}/${tile.id}`) }))}
            />
          )}
          {!data.canEdit && section !== 'users' && (
            <Alerte
              tone="neutral"
              icon="lock"
              title="Lecture seule"
              text={
                scope === 'firm'
                  ? 'Ces paramètres sont modifiés par le Directeur ou, par délégation, par le Responsable du recouvrement.'
                  : 'La configuration technique est modifiée par le Directeur ou, par délégation, par le Développeur.'
              }
              actionLabel="En savoir plus sur les rôles"
              actionHref="/aide"
            />
          )}
          <SectionBody key={`${scope}/${section}`} scope={scope} id={section} label={current.title} />
        </>
      )}
    </>
  );
}
