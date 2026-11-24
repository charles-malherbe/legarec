---
description: Construire un écran de la maquette (structure, états, données simulées, tests, comparaison visuelle)
argument-hint: <Ecran> (ex. Dossiers, Telephonie, Payer)
---
Construis l'écran **$ARGUMENTS** de la maquette Legarec.

1. Lis `maquette/$ARGUMENTS.dc.html` (gabarit et `renderVals()`), les captures `maquette/captures/*/$ARGUMENTS-{1440,1024,390}.png`, `maquette/donnees-demo/$ARGUMENTS.json` et les passages de `maquette/HANDOFF.md` qui le concernent. Vérifie `DECISIONS.md` et `QUESTIONS.md`.
2. Repère l'application et la route dans `scripts/ecrans.json` (ajuste la route si le routage diffère, et mets le fichier à jour).
3. Liste les composants de `packages/ui` nécessaires. S'il en manque un, construis-le avec `/composant` dans le même lot.
4. Le plan validé (`PLAN.md`) tient lieu d'accord : n'attends pas de nouvelle validation, sauf si l'écran contredit le plan.
5. Implémente : textes mot pour mot, données simulées (MSW) issues du JSON de démo (données métier uniquement), états chargement / vide / aucun résultat / erreur, confirmations, raccourcis clavier, responsive.
6. Écris les tests : Vitest pour la logique, Playwright pour le parcours principal, axe sans violation.
7. Lance `/comparer $ARGUMENTS` et corrige jusqu'à un écart ≤ 3 % à chaque largeur (ou explique les écarts restants, par ex. polices ou données dynamiques).
8. `pnpm verifier`, puis un commit (message en anglais) sur la branche du lot en cours (`lot/<lettre>`), coche l'écran dans `PLAN.md` et résume : ce qui est fait, écarts restants, questions ajoutées à `QUESTIONS.md`.
