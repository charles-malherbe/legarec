---
description: Construire un composant de la bibliothèque Legarec sur Mantine 9.8
argument-hint: <Composant> (ex. Bouton, Badge, Tableau, Confirm)
---
Construis le composant **$ARGUMENTS** dans `packages/ui`.

1. Lis `maquette/$ARGUMENTS.dc.html` (props dans `data-props`, variantes, états) et sa fiche dans `maquette/captures/composants/Bibliotheque-1440.png` (rubrique $ARGUMENTS : exemples, props, écrans qui l'utilisent).
2. Consulte le serveur MCP `mantine` pour le composant Mantine 9.8 de base le plus proche et son API de styles.
3. Implémente-le en enveloppant Mantine : nom français, props en anglais identiques à la maquette, toutes les variantes et tailles, états (survol, focus visible, désactivé, chargement), accessibilité (rôle, libellés, clavier). Aucune valeur de style en dur : uniquement le thème Legarec.
4. Ajoute une page de démonstration qui reproduit la fiche du catalogue, et des tests (rendu des variantes, clavier, axe).
5. Compare visuellement la page de démonstration à la capture du composant et corrige les écarts.
6. `pnpm verifier`, commit (message en anglais) sur la branche du lot en cours (`lot/<lettre>`), résumé des choix et des écarts.
