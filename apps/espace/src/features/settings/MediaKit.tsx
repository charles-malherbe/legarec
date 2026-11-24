import { openExternal } from '@legarec/platform';
import { Bouton, Carte, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import css from './Settings.module.css';

const BASE = 'https://media.legarec.fr/marque';
const LOGOS = [
  ['Logo horizontal', 'Usage principal : site, e-mails, documents', 'legarec-logo-horizontal'],
  ['Logo vertical', 'Formats carrés, réseaux sociaux, signalétique', 'legarec-logo-vertical'],
  ['Emblème', 'Favicon, avatar, petits formats', 'legarec-embleme'],
  ['Logo négatif', 'Sur fond bleu Legarec ou fond foncé', 'legarec-logo-negatif'],
] as const;
// Brand values published in the kit: they are content to copy, not styles of the app.
const COLORS = [
  ['Bleu Legarec', '#002B74', 'rgb(0, 43, 116)', 'var(--marine)'],
  ['Jaune Legarec', '#FCBE03', 'rgb(252, 190, 3)', 'var(--or)'],
  ['Ardoise', '#5D7087', 'rgb(93, 112, 135)', 'var(--text-3)'],
  ['Bleu nuit', '#001B4D', 'rgb(0, 27, 77)', 'var(--app-icon-bg)'],
] as const;

export function MediaKit() {
  const toast = useToast();
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast({ message: 'Copié.' });
  };
  return (
    <>
      <Carte title="Kit complet" description="Logos, couleurs, typographie et règles d'usage · ZIP de 4,2 Mo · mis à jour le 12/11/2026">
        <div className={layout.inline}>
          <Bouton variant="secondary" label="Copier le lien du kit" onPress={() => void copy(`${BASE}/`)} />
          <Bouton label="Télécharger le kit (.zip)" icon="download" onPress={() => openExternal(`${BASE}/legarec-kit-media.zip`)} />
        </div>
      </Carte>
      <Carte title="Logos">
        <div className={layout.grid}>
          {LOGOS.map(([name, use, file]) => (
            <article key={file} className={layout.stack}>
              <div className={css.logo} data-brand>
                {name}
              </div>
              <div className={layout.text}>
                <span className={layout.strong}>{name}</span>
                <span className={layout.hint}>{use}</span>
              </div>
              <div className={layout.inline}>
                {(['svg', 'png', 'pdf'] as const).map((format) => (
                  <Bouton
                    key={format}
                    variant="secondary"
                    size="xs"
                    icon="download"
                    label={format.toUpperCase()}
                    ariaLabel={`${format.toUpperCase()} : ${name}`}
                    onPress={() => openExternal(`${BASE}/${file}.${format}`)}
                  />
                ))}
                <Bouton variant="ghost" size="xs" label="Copier l’URL" ariaLabel={`Copier l’URL : ${name}`} onPress={() => void copy(`${BASE}/${file}.svg`)} />
              </div>
            </article>
          ))}
        </div>
      </Carte>
      <Carte title="Couleurs">
        <div className={layout.grid}>
          {COLORS.map(([name, hex, rgb, token]) => (
            <div key={hex} className={layout.tightStack}>
              <div className={css.swatch} style={{ background: token }} aria-hidden />
              <span className={layout.strong}>{name}</span>
              <span className={layout.hint}>
                {hex} · {rgb}
              </span>
              <Bouton variant="link" size="sm" label="Copier" ariaLabel={`Copier ${hex}`} onPress={() => void copy(hex)} />
            </div>
          ))}
        </div>
      </Carte>
      <Carte title="Typographie et usage">
        <div className={layout.stack}>
          <div className={layout.text}>
            <span className={layout.strong}>Lora · titres</span>
            <span className={layout.hint}>SemiBold 600 · Bold 700 · licence libre (OFL)</span>
          </div>
          <div className={layout.text}>
            <span className={layout.strong}>Inter · textes</span>
            <span className={layout.hint}>Regular 400 · Medium 500 · SemiBold 600 · Bold 700 · licence libre (OFL)</span>
          </div>
          <ul className={`${css.notes} ${layout.body}`}>
            <li>Laisser autour du logo un espace libre au moins égal à la hauteur de l’emblème.</li>
            <li>Ne pas déformer, recolorer ni ajouter d’ombre au logo.</li>
            <li>Sur fond foncé ou photo, utiliser la version négative.</li>
            <li>Largeur minimale : 120 px à l’écran, 30 mm à l’impression.</li>
          </ul>
        </div>
      </Carte>
    </>
  );
}
