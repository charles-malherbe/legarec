# Questions ouvertes

Claude Code : ajoute ici toute question que la maquette, `HANDOFF.md` ou `DECISIONS.md` ne tranchent pas, avec l'option que tu retiens par défaut en attendant. Quand une question est tranchée, déplace la réponse dans `DECISIONS.md`.

| # | Question | Option par défaut en attendant | Statut |
|---|---|---|---|
| 1 | Prestataire de paiement par carte et prélèvement SEPA ? | Plus de paiement en ligne : chèque et virement uniquement (`DECISIONS.md`, 24/11/2026) | Close |
| 2 | Rapprochement des virements reçus | Saisie manuelle depuis la fiche débiteur pour l'instant ; import de relevés à concevoir plus tard, hors périmètre de la maquette | Ouverte |
| 3 | Chèques acceptés comme moyen de paiement ? | Oui (`DECISIONS.md`, 24/11/2026) | Close |
| 4 | Règle pour les initiales en double dans les adresses `initiales@legarec.fr` ? | Ajout d'un chiffre (`xx2@legarec.fr`), à confirmer | Ouverte |
| 5 | Agenda des relances : FullCalendar ou `@mantine/schedule` ? | FullCalendar (extensions gratuites) | Ouverte |
| 6 | IBAN et BIC du compte dédié, SIREN et n° de TVA du cabinet | Valeurs entre crochets en configuration | À fournir |
| 7 | Textes juridiques : mentions légales, confidentialité, cookies, mentions des courriers (R124-4 CPCE, L111-8) et des factures ; règles de « Recouvrement amiable » du prompt v2.5 | Emplacements marqués « à valider par le juriste » | À fournir |
| 8 | Comptes réels de l'équipe | Comptes de démonstration de la maquette ; rôles uniques Directeur, Responsable, Développeur | À fournir |
| 9 | IA : hébergement des traitements (API Anthropic, AWS Bedrock UE, Google Vertex UE, Scaleway ou OVH compatibles OpenAI) et contrat de sous-traitance (DPA) | Couche fournisseur ; IA désactivée en production tant que le DPA n'est pas signé | Ouverte |
| 10 | IA : service de transcription des appels (3CX si la licence l'inclut, sinon service européen) | Transcription simulée en développement | Ouverte |
| 11 | IA : analyse juridique (RGPD, AI Act) des fonctions, information des débiteurs et des salariés | Seulement le lot 1 (appels, e-mails, synthèse) ; « Score de risque » de la fiche débiteur à revoir (explicable, pas de décision automatique) | Ouverte |
| 12 | IA : budget mensuel et seuil d'alerte | 150 €, alerte à 80 % | Ouverte |
| 20 | `legarec.fr` : rôle et hébergement | Site public du cabinet, hors de cette application et hors de Caddy ; pied de page des portails avec un lien vers legarec.fr | Close |
| 21 | Code d'accès dans la fiche débiteur : masqué avec « Afficher » ou affiché en clair ? | Masqué avec « Afficher », chaque affichage noté dans l'historique | Ouverte |
| 22 | Identifiant des débiteurs particuliers | Référence du dossier à la place du SIRET | Ouverte |
| 23 | Statut RGPD du cabinet : sous-traitant de chaque créancier ou responsable du traitement ? | À trancher avec le juriste | Ouverte |
| 24 | Texte de la mention STOP avec un expéditeur sous forme de numéro | Texte actuel du bloc `{{> mention_sms}}` | Ouverte |
| 25 | Agrandissement du mode malvoyant : celui de la maquette suffit-il ? | Oui, complété par le zoom du navigateur jusqu'à 200 % | Ouverte |
| 26 | Textes des e-mails du kit : relecture par le juriste, en particulier les relances | Textes du kit | Ouverte |
| 27 | Postes 3CX des collaborateurs | Aucun : la signature affiche le standard seul | À fournir |
| 28 | Suppression d'une boîte OVH depuis l'application | Autorisée avec double confirmation (saisie de l'adresse) ; recouvrement@ protégée | Ouverte |
| 29 | Taille par défaut d'une nouvelle boîte OVH | La plus grande proposée par l'offre | Ouverte |
