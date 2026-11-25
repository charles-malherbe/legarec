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
| 13 | Numéros 13 à 19 : absents du kit v2.5 alors que le prompt annonce « questions 1 à 29 » | Numéros laissés libres (sauf celui-ci) | Ouverte |
| 30 | Versions : TypeScript 7 est la dernière, mais typescript-eslint exige < 6.1 | TypeScript 6.0.3 figé | Ouverte |
| 31 | Validation des formulaires : Mantine 9 fournit `schemaResolver` (Standard Schema), compatible Zod 4, sans paquet séparé | `schemaResolver` de `@mantine/form`, `{ sync: true }` | Ouverte |
| 32 | Dépendances non citées : outils (eslint, prettier, typescript-eslint, testing-library, jsdom, @axe-core/playwright, postcss-preset-mantine), temporal-polyfill (exigé par FullCalendar 7), libphonenumber-js (API) | Retenues, versions exactes figées, rien d'autre | Ouverte |
| 33 | Double authentification : @simplewebauthn/browser et QR code | Retenus au lot G seulement, avec `qrcode` | Ouverte |
| 34 | Relectures par sous-agents demandées par `/verifier` | Une relecture par lot, avant l'ouverture de la PR | Ouverte |
| 35 | `kits/emails-handlebars` contient un IBAN, un BIC et un SIREN qui semblent réels (config.example.json, README) | Jamais repris dans l'application : valeurs entre crochets. À confirmer avant de pousser le kit | À confirmer |
| 36 | La machine de développement héberge des conteneurs qui semblent de production (Caddy, n8n, Gatus) et l'utilisateur système a accès à docker, contrairement à l'annexe Architecture | Claude Code n'utilise aucune commande docker | À corriger par le cabinet |
| 37 | Logo de la page de connexion : nom exact du fichier négatif sur media.legarec.fr/marque/ | Variable `VITE_LOGO_NEGATIVE_URL` ; à défaut, le nom en texte | À fournir |
| 38 | SSO de l'entreprise (hors périmètre dans la maquette) | Bouton affiché mais désactivé | Ouverte |
| 39 | « Activer mon compte » sans lien d'invitation | L'activation passe par le lien reçu par e-mail ; texte adapté | Ouverte |
| 40 | Tableau de bord du Développeur, absent de la maquette | Accueil technique sans aucune donnée de dossier | Ouverte |
| 41 | Connexion SSH à GitHub refusée sur la machine de développement | Branches gardées en local ; aucune PR ouverte | À corriger par le cabinet |
| 42 | Boîte OVH à l'invitation d'un collaborateur : le Responsable invite (délégation administrative), la boîte relève du technique | L'invitation part d'Équipe, le Développeur ou le Directeur crée la boîte dans Paramètres techniques | Ouverte |
| 43 | Notifications par SMS (Compte) : aucun portable n'est stocké | Colonne SMS retirée ; restent l'application et l'e-mail | Ouverte |
| 44 | Photo de profil, langue anglaise et page d'accueil au choix (Compte) | Non repris : initiales, français, tableau de bord | Ouverte |
| 45 | Plafonds de contacts par canal : valeurs | [PLAFOND À VALIDER], réglables dans Paramètres du cabinet > Relances | Ouverte |
| 46 | IBAN des débiteurs « visibles par Dirigeant et Développeur » (maquette), alors que le Développeur n'a aucun dossier | Visibles par le Directeur seulement | Ouverte |
| 47 | Révocation d'un secret : « accord d'un second développeur », rôle unique | Accord du Directeur | Ouverte |
| 48 | Numéro STOP : la maquette écrit « 36173 » et [NUMÉRO STOP] | [NUMÉRO STOP] partout | Ouverte |
| 49 | Adresse du siège : la maquette donne une adresse | [ADRESSE DU CABINET] tant qu'elle n'est pas confirmée | Ouverte |
| 50 | Triple accolade dans un modèle importé (texte non protégé) | Refusée, en plus des contrôles demandés | Ouverte |
| 51 | Articles d'aide : un seul est rédigé dans la maquette | Les 17 autres affichent « Article en cours de rédaction » | Ouverte |
