---
paths:
  - "apps/espace/**"
  - "apps/partenaires/**"
  - "apps/paiement/**"
  - "packages/ui/**"
  - "packages/tokens/**"
---

# Règles d'interface

- **Mantine 9.8** uniquement, via le thème Legarec (`packages/tokens`). Avant d'utiliser un composant ou un hook, vérifier son API avec le serveur MCP `mantine`. Aucune couleur, taille ou ombre en dur ; pas de Tailwind.
- Les écrans n'importent jamais `@mantine/core` directement pour les éléments de la bibliothèque : ils passent par `packages/ui` (`Bouton`, `Champ`, `Badge`, `Statut`, `Onglets`, `Tableau`, `Confirm`, `Toast`, `Alerte`, `Indicateur`, `PageHeader`, `Toolbar`…), pour garder un seul endroit où ajuster l'apparence.
- Structure d'une page métier (espace) : `PageHeader` (titre, description, actions, chiffres clés) → `Toolbar` (onglets, recherche, filtres) → contenu.
- Listes : composant `Tableau` (TanStack Table 9 + `Table` Mantine) avec en-têtes collants, états chargement (squelettes), vide, aucun résultat, erreur (`EtatListe`), pagination.
- Formulaires : `@mantine/form` + Zod, libellé, aide et erreur reliés (`aria-describedby`), messages en français.
- Chaque action qui engage passe par `Confirm` (récapitulatif dans `details`). Action réversible : `Toast` avec « Annuler ».
- Données via TanStack Query, types de `packages/contracts`, MSW en développement ; aucun filtrage de sécurité dans le navigateur (l'API décide). Le rôle et les délégations viennent de la session ; un dossier en lecture seule (Directeur) n'affiche aucun bouton d'action ; bandeau « Pour le compte du Directeur » pendant une action déléguée.
- Téléphone, notifications, fichiers générés et liens externes : uniquement via `packages/platform`.
- Aucun secret côté front, jamais de jeton dans localStorage ; aucune donnée personnelle ni code d'accès dans une URL.
- Clavier : tout est atteignable au clavier, focus visible, raccourcis de la maquette (`HANDOFF.md`, section raccourcis) inactifs pendant la saisie. La page Appels se pilote entièrement au clavier.
- Responsive : 390, 768, 1024, 1440 px sans défilement horizontal de la page ; tableaux défilants dans leur conteneur ; menu en tiroir sous 1024 px.
- Deux ambiances : `espace` dense ; `partenaires` et `paiement` aérés, titres en Lora. Mode malvoyant : bouton dans la Topbar de l'espace en plus du menu du compte.
- Aucune carte, aucun prélèvement SEPA, aucun badge PCI-DSS : paiement par chèque et virement uniquement.
- Textes : reprendre ceux de la maquette mot pour mot. Montants `48 200 €` (espace fine insécable), dates `05/12/2026`, SIRET groupé `512 384 920 00027`.
- Après un écran : `/comparer <Ecran>` et corriger jusqu'à un écart faible ; vérifier avec axe.
- Suggestions IA : composant dédié (bordure et fond violets, icône étincelle, mention « Proposé par l’IA, à vérifier »), actions « Appliquer » / « Ignorer » / « Annuler », jamais d'application automatique.
