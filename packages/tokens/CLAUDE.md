# packages/tokens

- Source : `maquette/tokens.css` (copie de référence). Exporter : `tokens.css` (variables CSS) et `theme.ts` (`createTheme` Mantine : palette marine en 10 nuances, or, Roboto, rayons, espacements, tailles, ombres, `cssVariablesResolver`).
- Deux variantes de thème : `espace` (dense) et `public` (partenaires, paiement : plus aéré).
- Mode sombre et mode « texte agrandi » (`data-a11y="malvoyant"`) déjà définis dans `tokens.css` : les conserver.
- Police Roboto (texte, titres et écrans de marque, décision du 27/11/2026) hébergée ici au format woff2 ; ses variables `--font-*` remplacent celles de la maquette dans `styles.css`, `tokens.css` restant identique à `maquette/tokens.css`. Lora reste ici pour les courriers. Aucune police chargée depuis Google Fonts ou un autre service externe.
