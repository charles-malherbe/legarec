# Assistant IA

Principe : **l'IA suggère, un collaborateur valide.** Aucune suggestion n'est appliquée, envoyée ou enregistrée sans un clic humain. Toute suggestion est marquée « Proposé par l'IA » (couleur violette, icône étincelle).

## Fonctions (maquette v2.0)
| Écran | Fonction | Déclencheur | Modèle |
|---|---|---|---|
| Appels (`Telephonie`) | Transcription après l'appel (question 72), puis résumé et qualification proposée (résultat, montant, date, factures, prochaine action) | Fin de l'appel **et** annonce de l'enregistrement cochée | Rapide (extraction) + avancé (résumé) |
| E-mails (`Messagerie`) | Catégorie, dossier rattaché, extraction (montants, dates, factures), actions proposées ; brouillon de réponse | Arrivée d'un e-mail (BullMQ) ; brouillon à la demande | Rapide (tri) ; avancé (brouillon) |
| Fiche débiteur (`Dossier`) | Synthèse en 5 lignes : situation, promesses, dernier contact, blocage, suggestion | Nouvel événement sur le dossier (avec cache) ; « Régénérer » | Avancé |
| Paramètres (`Reglages`, section `ia`) | Activation par fonction, garde-fous, fournisseur, hébergement, budget, journal | — | — |

## Garde-fous (non désactivables)
- Validation humaine obligatoire ; pas de décision automatique sur les débiteurs (RGPD art. 22) ; pas de note de solvabilité sur des particuliers.
- Transcription seulement après l'annonce de l'enregistrement ; sinon rien n'est envoyé.
- Minimisation : IBAN, données bancaires, pièces d'identité et code d'accès masqués avant envoi.
- Les mentions obligatoires viennent des modèles validés, jamais de l'IA. Ton conforme au recouvrement amiable (pas de pression ni de menace).
- Journal : chaque suggestion est conservée (fonction, dossier, entrée résumée, version du modèle et du prompt, décision : acceptée, modifiée, ignorée, corrigée, signalée, collaborateur).

## Technique
- Module `apps/api/src/ai` : un service par fonction, appels derrière une **couche fournisseur** (interface unique ; adaptateurs Anthropic et compatible OpenAI pour Scaleway et OVH), sorties structurées (JSON validé par Zod) pour tout ce qui pré-remplit un formulaire. Le front ne dépend d'aucun fournisseur.
- Deux niveaux de modèle configurables par variable d'environnement (`IA_MODELE_RAPIDE`, `IA_MODELE_AVANCE`) ; ne jamais coder un nom de modèle en dur ; variable absente = IA éteinte. Interrupteur de production dans le fichier du serveur (`AI_ENABLED`). Coût de chaque appel noté au journal.
- Traitements longs en tâches BullMQ ; budget mensuel contrôlé avant chaque appel (pause au-delà, alerte à 80 %).
- Prompts versionnés dans `apps/api/src/ai/prompts/` avec un jeu de cas de test (point de départ : `ia/cas-de-test.json`) exécuté par `pnpm verifier` en mode simulé, et à la demande contre l'API réelle.
- Transcription : Whisper large-v3 chez OVHcloud AI Endpoints, après l'appel seulement, si l'enregistrement a été annoncé (option C, décision du 26/11/2026).
- Hébergement des traitements : services hébergés en France, OVHcloud AI Endpoints, même fournisseur que le stockage des fichiers, par l'adaptateur compatible OpenAI (option C, décisions du 26/11/2026) ; plus d'IA sur le serveur du cabinet. Activation après un essai de qualité au lot W, l'avis du juriste et un contrat de sous-traitance signé ; IA désactivée en production jusque-là.
