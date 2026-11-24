# apps/paiement

paiement.legarec.fr — espace débiteur, sans compte : accès par identifiant (SIRET, ou référence du dossier pour un particulier) et code d'accès. Ambiance aérée et rassurante, titres Lora. D'abord un espace d'échange (messages, pièces, demandes guidées), puis solde, échéancier, quittances et consignes de paiement (virement, chèque). Aucun paiement en ligne, aucune carte.

- Règles : `.claude/rules/front.md` (chargées automatiquement) ; composants uniquement via `packages/ui`.
- Écrans : Accès à mon dossier (à proposer), Payer réorganisé, Confidentialité (RGPD).
- Code d'accès : jamais dans une URL ni un journal ; envoyé par courrier et dans les relances par e-mail, par téléphone ou SMS sur demande uniquement.
- Routes et captures de référence : `scripts/ecrans.json`, `maquette/captures/`.
- Données simulées (MSW) : `maquette/donnees-demo/<Ecran>.json`.
