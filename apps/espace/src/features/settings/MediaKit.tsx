import { openExternal } from '@legarec/platform';
import { Bouton, Carte, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import type { CSSProperties } from 'react';
import css from './Settings.module.css';

// The firm's media kit (édition de novembre 2026), as media.legarec.fr serves it: from the bucket, or from the copy
// kept with Caddy (infra/media/marque). Its 12 logos, under the names of the kit, and its ZIP.
const BASE = 'https://media.legarec.fr/marque';
const KIT = `${BASE}/legarec-kit-media.zip`;
const LOGOS = [
  ['Logo horizontal', 'Usage principal : site, e-mails, documents', 'legarec-logo-horizontal'],
  ['Logo vertical', 'Formats carrés, réseaux sociaux, signalétique', 'legarec-logo-vertical'],
  ['Emblème', 'Favicon, avatar, petits formats', 'legarec-embleme'],
] as const;
const VERSIONS = [
  ['Couleur', 'couleur'],
  ['Négatif', 'negatif'],
  ['Monochrome marine', 'monochrome-marine'],
  ['Monochrome blanc', 'monochrome-blanc'],
] as const;
// Brand values published in the kit: content to copy, shown as they are in both themes, not styles of the app.
const COLORS = [
  ['Marine', '#002B74', 'rgb(0, 43, 116)', 'Couleur dominante : fonds, titres, logo'],
  ['Or', '#FCBE03', 'rgb(252, 190, 3)', 'Accent : filets, pastilles. Jamais pour du texte'],
  ['Ardoise', '#5D7087', 'rgb(93, 112, 135)', 'Textes secondaires, légendes'],
  ['Encre', '#16233B', 'rgb(22, 35, 59)', 'Texte courant sur fond clair'],
] as const;

export function MediaKit() {
  const toast = useToast();
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast({ message: 'Copié.' });
  };
  return (
    <>
      <Carte title="Kit complet" description="Logos, avatars, visuels, guide PDF et textes de présentation · ZIP de 2,4 Mo · édition de novembre 2026">
        <div className={layout.inline}>
          <Bouton variant="secondary" label="Copier le lien du kit" onPress={() => void copy(KIT)} />
          <Bouton label="Télécharger le kit (.zip)" icon="download" onPress={() => openExternal(KIT)} />
        </div>
      </Carte>
      <Carte
        title="Logos"
        description="PNG à fond transparent. Couleur et monochrome marine sur fond clair ; négatif et monochrome blanc sur fond marine ou sombre."
      >
        <div className={layout.grid}>
          {LOGOS.map(([name, use, file]) => (
            <article key={file} className={layout.stack}>
              {/* The files of the kit, never the name written in their place: colour on a light surface, negative in dark mode. */}
              <div className={css.logo}>
                <img className={css.onLight} src={`${BASE}/${file}-couleur.png`} alt={`${name}, couleur`} />
                <img className={css.onDark} src={`${BASE}/${file}-negatif.png`} alt={`${name}, négatif`} />
              </div>
              <div className={layout.text}>
                <span className={layout.strong}>{name}</span>
                <span className={layout.hint}>{use}</span>
              </div>
              <div className={layout.inline}>
                {VERSIONS.map(([label, version]) => (
                  <Bouton
                    key={version}
                    variant="secondary"
                    size="xs"
                    icon="download"
                    label={label}
                    ariaLabel={`PNG ${label.toLowerCase()} : ${name}`}
                    onPress={() => openExternal(`${BASE}/${file}-${version}.png`)}
                  />
                ))}
                <Bouton
                  variant="ghost"
                  size="xs"
                  label="Copier l’URL"
                  ariaLabel={`Copier l’URL : ${name}`}
                  onPress={() => void copy(`${BASE}/${file}-couleur.png`)}
                />
              </div>
            </article>
          ))}
        </div>
      </Carte>
      <Carte title="Couleurs" description="Le marine domine, l’ardoise accompagne, l’or souligne.">
        <div className={layout.grid}>
          {COLORS.map(([name, hex, rgb, use]) => (
            <div key={hex} className={layout.tightStack}>
              <div className={css.swatch} style={{ '--swatch': hex } as CSSProperties} aria-hidden />
              <span className={layout.strong}>{name}</span>
              <span className={layout.hint}>
                {hex} · {rgb}
              </span>
              <span className={layout.hint}>{use}</span>
              <Bouton variant="link" size="sm" label="Copier" ariaLabel={`Copier ${hex}`} onPress={() => void copy(hex)} />
            </div>
          ))}
        </div>
      </Carte>
      <Carte title="Typographie et usage">
        <div className={layout.stack}>
          <div className={layout.text}>
            <span className={layout.strong}>Lora · titres et citations</span>
            <span className={layout.hint}>Graisses régulière à grasse, italique · licence libre (SIL Open Font License)</span>
          </div>
          <div className={layout.text}>
            <span className={layout.strong}>Poppins · texte courant</span>
            <span className={layout.hint}>Interfaces et supports numériques · licence libre (SIL Open Font License)</span>
          </div>
          <div className={layout.text}>
            <span className={layout.strong}>Georgia et Arial · e-mails, documents Word ou PowerPoint</span>
            <span className={layout.hint}>Georgia pour les titres, Arial pour le texte : polices installées sur tous les postes</span>
          </div>
          <ul className={`${css.notes} ${layout.body}`}>
            <li>Laisser autour du logo un espace libre au moins égal à la hauteur des capitales du logotype, sans texte ni bord de page.</li>
            <li>Couleur sur fond clair, négatif sur fond marine.</li>
            <li>Ne pas déformer, recolorer, ajouter d’effet ni poser le logo sur un fond peu contrasté.</li>
            <li>Ne pas écrire LEGAREC en capitales suivi de « cabinet de recouvrement », ni recomposer le logotype avec une autre police.</li>
          </ul>
        </div>
      </Carte>
    </>
  );
}
