---
description: Tous les contrôles avant une pull request
---
1. `pnpm verifier` (types, lint, tests unitaires) : corrige tout échec.
2. Tests Playwright des parcours touchés et contrôle axe : aucune violation.
3. `/comparer` sur chaque écran modifié.
4. Délègue en parallèle aux sous-agents `relecteur-securite`, `relecteur-maquette` et `testeur`, puis corrige les points bloquants et importants qu’ils remontent.
5. Relis le diff : aucun secret, aucune valeur de style en dur, aucun texte modifié par rapport à la maquette sans mention dans `DECISIONS.md`, cloisonnement par créancier et droits par rôle respectés dans les routes API touchées.
6. Résume en français : ce qui change, comment le tester, écarts visuels restants, questions ouvertes.
