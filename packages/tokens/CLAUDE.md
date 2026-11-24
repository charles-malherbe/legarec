# packages/tokens

- Source : `maquette/tokens.css` (copie de référence). Exporter : `tokens.css` (variables CSS) et `theme.ts` (`createTheme` Mantine : palette marine en 10 nuances, or, Inter / Lora, rayons, espacements, tailles, ombres, `cssVariablesResolver`).
- Deux variantes de thème : `espace` (dense) et `public` (partenaires, paiement : plus aéré).
- Mode sombre et mode « texte agrandi » (`data-a11y="malvoyant"`) déjà définis dans `tokens.css` : les conserver.
- Polices Inter et Lora hébergées ici au format woff2, aussi utilisées par les PDF ; aucune police chargée depuis Google Fonts ou un autre service externe.
