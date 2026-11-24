# Questions ouvertes

Claude Code : ajoute ici toute question que la maquette, `HANDOFF.md` ou `DECISIONS.md` ne tranchent pas, avec l'option que tu retiens par défaut en attendant. Quand une question est tranchée, déplace la réponse dans `DECISIONS.md`.

| # | Question | Option par défaut en attendant | Statut |
|---|---|---|---|
| 1 | Prestataire de paiement par carte et prélèvement SEPA ? | Plus de paiement en ligne : chèque et virement uniquement (`DECISIONS.md`, 24/11/2026) | Close |
| 2 | Rapprochement des virements reçus | Saisie manuelle depuis la fiche débiteur pour l'instant ; import de relevés à concevoir plus tard, hors périmètre de la maquette | Close : option par défaut retenue (24/11/2026) |
| 3 | Chèques acceptés comme moyen de paiement ? | Oui (`DECISIONS.md`, 24/11/2026) | Close |
| 4 | Règle pour les initiales en double dans les adresses `initiales@legarec.fr` ? | Ajout d'un chiffre (`xx2@legarec.fr`), à confirmer | Close (24/11/2026) |
| 5 | Agenda des relances : FullCalendar ou `@mantine/schedule` ? | FullCalendar (extensions gratuites) | Close : option par défaut retenue (24/11/2026) |
| 6 | IBAN et BIC du compte dédié, SIREN et n° de TVA du cabinet | Valeurs entre crochets en configuration | À fournir |
| 7 | Textes juridiques : mentions légales, confidentialité, cookies, mentions des courriers (R124-4 CPCE, L111-8) et des factures ; règles de « Recouvrement amiable » du prompt v2.5 | Emplacements marqués « à valider par le juriste » | À fournir |
| 8 | Comptes réels de l'équipe | Comptes de démonstration de la maquette ; rôles uniques Directeur, Responsable, Développeur | À fournir |
| 9 | IA : hébergement des traitements (API Anthropic, AWS Bedrock UE, Google Vertex UE, Scaleway ou OVH compatibles OpenAI) et contrat de sous-traitance (DPA) | Couche fournisseur ; IA désactivée en production tant que le DPA n'est pas signé | Ouverte |
| 10 | IA : service de transcription des appels (3CX si la licence l'inclut, sinon service européen) | Transcription simulée en développement | Ouverte |
| 11 | IA : analyse juridique (RGPD, AI Act) des fonctions, information des débiteurs et des salariés | Seulement le lot 1 (appels, e-mails, synthèse) ; « Score de risque » de la fiche débiteur à revoir (explicable, pas de décision automatique) | Décidée ; avis du juriste attendu (24/11/2026) |
| 12 | IA : budget mensuel et seuil d'alerte | 150 €, alerte à 80 % | Ouverte |
| 20 | `legarec.fr` : rôle et hébergement | Site public du cabinet, hors de cette application et hors de Caddy ; pied de page des portails avec un lien vers legarec.fr | Close |
| 21 | Code d'accès dans la fiche débiteur : masqué avec « Afficher » ou affiché en clair ? | Masqué avec « Afficher », chaque affichage noté dans l'historique | Close (24/11/2026) |
| 22 | Identifiant des débiteurs particuliers | Référence du dossier à la place du SIRET | Close : option par défaut retenue (24/11/2026) |
| 23 | Statut RGPD du cabinet : sous-traitant de chaque créancier ou responsable du traitement ? | À trancher avec le juriste | Ouverte |
| 24 | Texte de la mention STOP avec un expéditeur sous forme de numéro | Texte actuel du bloc `{{> mention_sms}}` | Close (24/11/2026) |
| 25 | Agrandissement du mode malvoyant : celui de la maquette suffit-il ? | Oui, complété par le zoom du navigateur jusqu'à 200 % | Close : option par défaut retenue (24/11/2026) |
| 26 | Textes des e-mails du kit : relecture par le juriste, en particulier les relances | Textes du kit | Ouverte |
| 27 | Postes 3CX des collaborateurs | Aucun : la signature affiche le standard seul | À fournir |
| 28 | Suppression d'une boîte OVH depuis l'application | Autorisée avec double confirmation (saisie de l'adresse) ; recouvrement@ protégée | Close (24/11/2026) |
| 29 | Taille par défaut d'une nouvelle boîte OVH | La plus grande proposée par l'offre | Close (24/11/2026) |
| 13 | Numéros 13 à 19 : absents du kit v2.5 alors que le prompt annonce « questions 1 à 29 » | Numéros laissés libres (sauf celui-ci) | Close : option par défaut retenue (24/11/2026) |
| 30 | Versions : TypeScript 7 est la dernière, mais typescript-eslint exige < 6.1 | TypeScript 6.0.3 figé | Close : option par défaut retenue (24/11/2026) |
| 31 | Validation des formulaires : Mantine 9 fournit `schemaResolver` (Standard Schema), compatible Zod 4, sans paquet séparé | `schemaResolver` de `@mantine/form`, `{ sync: true }` | Close : option par défaut retenue (24/11/2026) |
| 32 | Dépendances non citées : outils (eslint, prettier, typescript-eslint, testing-library, jsdom, @axe-core/playwright, postcss-preset-mantine), temporal-polyfill (exigé par FullCalendar 7), libphonenumber-js (API) | Retenues, versions exactes figées, rien d'autre | Close : option par défaut retenue (24/11/2026) |
| 33 | Double authentification : @simplewebauthn/browser et QR code | Retenus au lot G seulement, avec `qrcode` | Close : option par défaut retenue (24/11/2026) |
| 34 | Relectures par sous-agents demandées par `/verifier` | Une relecture par lot, avant l'ouverture de la PR | Close : option par défaut retenue (24/11/2026) |
| 35 | `kits/emails-handlebars` contient un IBAN, un BIC et un SIREN qui semblent réels (config.example.json, README) | Jamais repris dans l'application : valeurs entre crochets. À confirmer avant de pousser le kit | Décidée, à faire par le cabinet (24/11/2026) |
| 36 | La machine de développement héberge des conteneurs qui semblent de production (Caddy, n8n, Gatus) et l'utilisateur système a accès à docker, contrairement à l'annexe Architecture | Claude Code n'utilise aucune commande docker | À corriger par le cabinet |
| 37 | Logo de la page de connexion : nom exact du fichier négatif sur media.legarec.fr/marque/ | Variable `VITE_LOGO_NEGATIVE_URL` ; à défaut, le nom en texte | À fournir |
| 38 | SSO de l'entreprise (hors périmètre dans la maquette) | Bouton affiché mais désactivé | Close (24/11/2026) |
| 39 | « Activer mon compte » sans lien d'invitation | L'activation passe par le lien reçu par e-mail ; texte adapté | Close : option par défaut retenue (24/11/2026) |
| 40 | Tableau de bord du Développeur, absent de la maquette | Accueil technique sans aucune donnée de dossier | Close : option par défaut retenue (24/11/2026) |
| 41 | Connexion SSH à GitHub refusée sur la machine de développement | Dépôt distant passé en HTTPS par le cabinet | Réglée le 24/11/2026 |
| 42 | Boîte OVH à l'invitation d'un collaborateur : le Responsable invite (délégation administrative), la boîte relève du technique | L'invitation part d'Équipe, le Développeur ou le Directeur crée la boîte dans Paramètres techniques | Close (24/11/2026) |
| 43 | Notifications par SMS (Compte) : aucun portable n'est stocké | Colonne SMS retirée ; restent l'application et l'e-mail | Close : option par défaut retenue (24/11/2026) |
| 44 | Photo de profil, langue anglaise et page d'accueil au choix (Compte) | Non repris : initiales, français, tableau de bord | Close : option par défaut retenue (24/11/2026) |
| 45 | Plafonds de contacts par canal : valeurs | [PLAFOND À VALIDER], réglables dans Paramètres du cabinet > Relances | Décidée ; avis du juriste attendu (24/11/2026) |
| 46 | IBAN des débiteurs « visibles par Dirigeant et Développeur » (maquette), alors que le Développeur n'a aucun dossier | Visibles par le Directeur seulement | Close (24/11/2026) |
| 47 | Révocation d'un secret : « accord d'un second développeur », rôle unique | Accord du Directeur | Close : option par défaut retenue (24/11/2026) |
| 48 | Numéro STOP : la maquette écrit « 36173 » et [NUMÉRO STOP] | [NUMÉRO STOP] partout | Close : option par défaut retenue (24/11/2026) |
| 49 | Adresse du siège : la maquette donne une adresse | [ADRESSE DU CABINET] tant qu'elle n'est pas confirmée | À fournir (24/11/2026) |
| 50 | Triple accolade dans un modèle importé (texte non protégé) | Refusée, en plus des contrôles demandés | Close : option par défaut retenue (24/11/2026) |
| 51 | Articles d'aide : un seul est rédigé dans la maquette | Les 17 autres affichent « Article en cours de rédaction » | Close : option par défaut retenue (24/11/2026) |
| 52 | Accord du créancier sur un échéancier long : emplacement (absent de la maquette) | Bandeau en tête du tableau de bord du portail partenaires, Accepter ou Refuser avec motif | Close : option par défaut retenue (24/11/2026) |
| 53 | Code par SMS : afficher le numéro masqué révèle qu'un dossier existe pour cet identifiant | Numéro masqué affiché comme demandé, 3 envois par heure ; à revoir si le risque est jugé trop élevé | Close (24/11/2026) |
| 54 | Accès débiteur d'une entreprise sans SIRET sous la main | Identifiant SIRET seulement ; sinon appel ou accès limité | Close (24/11/2026) |
| 55 | Accès limité : « Référence du dossier » facultative dans le message | Champ facultatif, message reçu avec la mention « non vérifié » | Close : option par défaut retenue (24/11/2026) |
| 56 | Format de la référence de dossier : DOS-2026-0181 et LGR-2026-04812 coexistent dans la maquette | Les deux formats sont acceptés | Close (24/11/2026) |
| 57 | Textes légaux (mentions légales, confidentialité, cookies) absents du dépôt | [TEXTE À FOURNIR] sur les trois portails | Ouverte |
| 58 | Téléchargements PDF (RIB, quittances, relevés) : générés par l'API | Boutons présents mais désactivés tant que l'API n'existe pas | Close : option par défaut retenue (24/11/2026) |
| 59 | Import de créances : corriger une ligne à l'écran | Les lignes en erreur se redéposent dans un nouveau fichier | Close : option par défaut retenue (24/11/2026) |
| 60 | Modèles importés : un texte masqué par combinaison de styles imbriqués reste possible malgré les contrôles | Relecture humaine à la validation, puis rendu PDF sans JavaScript ni réseau côté API | Ouverte |
