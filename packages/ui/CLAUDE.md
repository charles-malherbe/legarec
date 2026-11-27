# packages/ui — bibliothèque de composants Legarec

- Un composant par fichier, nom français (`Bouton`, `Champ`, `Badge`, `Statut`, `Avatar`, `Interrupteur`, `Case`, `Onglets`, `Carte`, `Tuile`, `Reglage`, `Indicateur`, `Progression`, `Alerte`, `Tableau`, `Toast`, `Confirm`, `EtatListe`, `PageHeader`, `Toolbar`, `Pagination`, `PiedDePage`, `Icone`, `SuggestionIA`, `Sidebar`, `Topbar`, `Avatar`, `Case`, `Interrupteur`), props en anglais identiques à `maquette/<Composant>.dc.html` (`data-props`).
- Construits sur Mantine 9.8 via le thème de `packages/tokens` ; vérifier les API avec le serveur MCP `mantine`.
- `src/marque` : fichiers du kit média du cabinet, seulement réduits pour l'écran ; jamais retouchés, recolorés ni remplacés par le nom en texte. Couleur sur fond clair, négatif sur fond marine ou sombre. `Embleme` (bouclier) est l'icône de l'application, le logo complet ne sert qu'aux pages de connexion (décision du 27/11/2026).
- Chaque composant : toutes les variantes de la maquette, états (survol, focus, désactivé, chargement), accessibilité, page de démonstration et tests. Référence visuelle : `maquette/captures/composants/`.
