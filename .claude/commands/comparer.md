---
description: Comparer un écran de l'application à la capture de la maquette et corriger les écarts
argument-hint: <Ecran> [--largeurs 1440,1024,390]
---
1. Vérifie que l'application concernée tourne (`pnpm dev`). Sinon, lance-la en arrière-plan.
2. Exécute `node scripts/comparer-ecran.mjs $ARGUMENTS`.
3. Ouvre `.comparaisons/<Ecran>/*-cote-a-cote.png` et `rapport.json`. Décris les écarts visibles (espacements, tailles, couleurs, ordre, textes, éléments manquants) par ordre d'importance.
4. Corrige-les dans le code (thème ou composant `packages/ui` si l'écart vient d'un composant partagé, pour en faire profiter tous les écrans).
5. Relance la comparaison jusqu'à un écart ≤ 3 % à chaque largeur, ou explique pourquoi un écart doit rester (données ou dates dynamiques, rendu des polices).
