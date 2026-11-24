# Mission
Développer le front-end des trois portails web de Legarec, à partir du kit Claude Code v2.3
(CLAUDE.md, DECISIONS.md, QUESTIONS.md, docs/, .claude/, scripts/, maquette/).
Données simulées (MSW) tant que l'API n'existe pas. L'application de bureau (Tauri, apps/desktop) n'est pas concernée.
Exception côté serveur : le lot I intègre les modèles d'e-mails dans apps/api (rendu et tests, sans envoi réel).
Version 2.5 du prompt : rôles et délégations revus, e-mails (kit emails-handlebars), envoi par OVH des messages
des collaborateurs, signatures, fichiers publics de media.legarec.fr, GitHub Actions.
À l'écran, tout est en français ; le code est en anglais (voir « Langue et nommage »).

# Portails et domaines
- espace.legarec.fr → apps/espace : collaborateurs (appels, SMS, e-mails, agenda, relances, historique des fichiers).
- partenaires.legarec.fr → apps/partenaires : créanciers (avancement des dossiers, dépôt de créances, transmission de pièces).
- paiement.legarec.fr → apps/paiement : espace débiteur, d'abord pour échanger avec les collaborateurs
  (messages, pièces), puis consulter le solde, l'échéancier, le RIB et les consignes pour les chèques ;
  liens des courriers et SMS.
- api.legarec.fr : API NestJS, seule porte d'accès aux données.
- legarec.fr : domaine principal (site public du cabinet, hors application ; boîtes e-mail OVH, offre MX Plan) :
  - recouvrement@legarec.fr : boîte partagée en réception seule (réponses aux relances 1 à 3). Personne n'écrit
    depuis cette boîte, ni dans l'application ni dans la messagerie ;
  - une boîte professionnelle par collaborateur (initiales@legarec.fr, ou une adresse de fonction comme
    administratif@legarec.fr ou support@legarec.fr) : chacun écrit et répond depuis la sienne.
    L'adresse de chaque collaborateur est une donnée de son profil, jamais écrite en dur.
- mail.legarec.fr : e-mails automatiques (Resend), expéditeur « LEGAREC <ne-pas-repondre@mail.legarec.fr> ».
  Ce domaine n'a pas de réception.
- legarec.on3cx.fr : standard téléphonique 3CX.
- n8n.legarec.fr : automatisations.
- status.legarec.fr : Gatus.
- media.legarec.fr : fichiers publics (bucket Scaleway legarec-media, public, liste du contenu désactivée).
  Chemins versionnés, un fichier publié n'est jamais remplacé (nouvelle version = nouveau dossier) :
  - e-mails/v1/ : legarec-logo-en-tete.png (520 × 130, fond blanc, affiché en 260 px)
    et legarec-logo-en-tete-negatif.png (mode sombre d'Outlook) ;
  - marque/ : les 8 logos officiels (emblème et logo horizontal ; couleur, négatif, monochrome marine, monochrome blanc) ;
  - documents-publics/ : conditions générales, politique de confidentialité, information RGPD des débiteurs.
  Les documents des dossiers sont dans un bucket privé distinct (legarec-documents, accès par URL présignée de l'API).
- Un compte connecté sur le mauvais portail est redirigé vers le bon, avec un message, uniquement après authentification.

# Langue et nommage
- En anglais : code, identifiants, types, tables et colonnes, routes et modules de l'API, nouvelles variables
  d'environnement, codes techniques, commentaires, messages de commit.
- En français : tout ce que voient les utilisateurs (écrans, messages d'erreur des formulaires, PDF, e-mails, SMS),
  ainsi que la documentation du kit (CLAUDE.md, DECISIONS.md, QUESTIONS.md, docs/, .claude/).
  Dates, montants et nombres au format fr-FR, fuseau Europe/Paris.
- Restent en français, par exception :
  - les noms des composants de packages/ui (Bouton, Champ…), avec des props en anglais identiques à la maquette ;
  - les routes des portails (scripts/ecrans.json), visibles par les utilisateurs ;
  - les champs de fusion des modèles (maquette/champs-de-fusion.json), utilisés par le cabinet ;
  - les noms existants de fichiers, scripts, commandes, agents et hooks (pnpm verifier, comparer, deployer ;
    /ecran, /composant, /comparer, /verifier ; relecteur-maquette, relecteur-securite, testeur…).
- Répertoires : ceux qui portent le nom d'un sous-domaine restent en français (apps/espace, apps/partenaires,
  apps/paiement) ; les nouveaux sont en anglais (packages/contracts, packages/platform).
- Glossaire à inscrire dans CLAUDE.md et à respecter dans le code :
  créancier, mandant → creditor ; débiteur → debtor ; dossier → case ; créance → claim ; relance → reminder ;
  échéancier → payment plan ; échéance → installment ; mise en demeure → formal notice ; quittance → receipt ;
  courrier → letter ; LRAR → registered letter ; accusé de réception → acknowledgment of receipt ;
  pièce → attachment ; contentieux → litigation ; rapprochement → reconciliation ; reversement → remittance ;
  facture → invoice ; avoir → credit note ; modèle → template ; paramètres → settings ; IA → AI ;
  délégation → delegation ; code d'accès → access code.
- Qualification des appels : codes internes en anglais (PROMISE_TO_PAY, PAYMENT_PLAN, CALLBACK, DISPUTE, ALREADY_PAID,
  ABSENT, NO_ANSWER, WRONG_NUMBER) ; à l'écran, les libellés exacts de la maquette. Les codes envoyés à 3CX restent
  ceux de la maquette (PROMESSE, ECHEANCIER, RAPPEL, LITIGE, DEJA_PAYE, ABSENT, NON_REPONSE, FAUX_NUMERO) :
  table de correspondance dans packages/contracts.

# Rôles
Développeur, Directeur, Responsable du recouvrement, Gestionnaire de créances, Créancier.
« Directeur » remplace « Dirigeant » partout (écrans, contrats, historique, documentation du kit).
- Directeur (unique) : en haut de la hiérarchie. Il ne doit rien avoir à configurer : interface la plus simple possible.
  - Consulte tous les dossiers, en lecture seule. N'agit que sur les dossiers qui lui sont attribués : il fait
    les mêmes actions de recouvrement qu'un gestionnaire (relances, appels, messages, échéanciers, paiements).
  - Sur un dossier qui ne lui est pas attribué, aucun bouton d'action ; l'API refuse toute modification.
  - Tableau de bord : chiffres globaux du cabinet (agrégés) et son propre portefeuille.
  - Ses actions sensibles sur ses dossiers ne demandent pas de validation du Responsable.
- Responsable du recouvrement (unique) : voit et traite ses dossiers, ceux de tous les gestionnaires
  et les dossiers sans gestionnaire (après un import, par exemple), qu'il attribue. Tableau de bord de l'équipe.
- Gestionnaire de créances (un ou plusieurs) : ses dossiers uniquement ; tableau de bord personnel.
- Développeur (unique) : administration technique et support des collaborateurs.
  Aucun accès aux dossiers.
- Créancier : portail partenaires, ses dossiers uniquement.
- Rôles uniques : l'API refuse d'attribuer Directeur, Responsable du recouvrement ou Développeur à une deuxième
  personne ; pour changer de titulaire, retirer d'abord le rôle à l'actuel.
- Pas de rattachement gestionnaire → responsable : avec un seul Responsable, il voit tous les gestionnaires.
- Délégations du Directeur, actives dès la mise en service (le Directeur n'a rien à configurer) :
  - technique → Développeur : Paramètres techniques, intégrations (Resend, OVH, 3CX, MySendingBox), mots de passe
    des boîtes OVH, sauvegardes, alertes, support des comptes (déblocage, double authentification, nouvel appareil) ;
  - administratif → Responsable du recouvrement : Facturation et reversements, validation des modèles, invitations
    des créanciers et des collaborateurs, attribution des dossiers, seuil des échéanciers, paramètres du cabinet.
  - Le Directeur garde tous ses droits pendant une délégation ; il retire ou redonne chaque délégation en un clic
    depuis Mon compte. Le délégué ne peut pas se l'attribuer.
  - Toute action déléguée affiche un bandeau « Pour le compte du Directeur » dans la Topbar ; l'historique enregistre
    les deux noms (qui agit, pour le compte de qui). Le menu ne change pas.
- Paramètres techniques : Développeur (et Directeur) ; les autres rôles voient un écran d'accès refusé.
- Double authentification obligatoire pour le Développeur seulement ; proposée aux autres rôles dans Mon compte,
  Directeur compris. Méthodes : code TOTP (application d'authentification) ou clé de sécurité (WebAuthn) ;
  étape dédiée à la connexion.
- Départ d'un collaborateur : compte désactivé (jamais supprimé), dossiers réattribués par le Responsable,
  mot de passe de sa boîte OVH retiré côté API, historique conservé.
- Profil d'un collaborateur : poste 3CX (facultatif, modifiable par le Développeur). Aucun numéro de portable
  n'est stocké : le renvoi vers le mobile quand le poste ne répond pas se règle dans 3CX.
- Historique : il enregistre aussi les consultations, par le Directeur, des dossiers qui ne lui sont pas attribués.
- Le débiteur n'a pas de compte : il accède à paiement.legarec.fr avec un identifiant et un code d'accès
  (voir « Espace débiteur »).
- Le rôle vient toujours de la session ; le contrôle réel est fait par l'API (filtrage des dossiers compris).

# Stack
Monorepo : TypeScript strict, pnpm + Turborepo
(apps/espace, apps/partenaires, apps/paiement, apps/api, packages/ui, packages/tokens, packages/contracts, packages/platform).
Versions exactes figées : n'en mets aucune à jour sans me le proposer. Avant de figer une version, vérifie qu'elle existe
et qu'elle est stable (npm view) ; sinon, note-le dans QUESTIONS.md.
Front :
- React 19.2+ (exigé par Mantine 9) et Vite ; React Router ; TanStack Query pour les appels API ; MSW pour les données simulées.
- Mantine 9.8 : @mantine/core, hooks, form, dates, notifications, modals, dropzone, charts.
  Mantine 9 est récent : vérifie chaque composant et chaque API avec le serveur MCP mantine,
  pas avec ta mémoire des versions 7 ou 8.
- Formulaires : @mantine/form + Zod. En v9, zodResolver n'est plus exporté par @mantine/form : utiliser un résolveur Zod séparé.
- Listes : TanStack Table 9 (@tanstack/react-table) en direct.
  - useTable (pas useReactTable) ; tableFeatures et modèles de lignes déclarés explicitement ; pas d'export legacy.
  - Tout le câblage dans le composant Tableau de packages/ui, affiché avec le Table de Mantine.
- Agenda des relances : FullCalendar en français, extensions gratuites (MIT) uniquement.
  @mantine/schedule reste une alternative à évaluer (QUESTIONS.md).
- Graphiques : @mantine/charts (Recharts 3) ; Recharts directement si un type manque.
- Recherche rapide (« / ») et palette de commandes : cmdk dans une Modal Mantine.
- Tests : Vitest, Playwright (parcours et comparaison visuelle avec maquette/captures/), axe (accessibilité).
- Données : packages/contracts (schémas Zod) est la seule source des types. MSW et les formulaires s'appuient dessus,
  l'API aussi plus tard : les écrans passeront de MSW à l'API sans changement.
Côté serveur, pour typer les données (détail dans l'annexe « Architecture ») :
- API REST NestJS documentée en OpenAPI, PostgreSQL + Prisma, Valkey + BullMQ ;
- PDF par Handlebars + Playwright, fichiers sur Scaleway S3, IA par API derrière une couche fournisseur.
Services : Resend, OVH (IMAP, SMTP, SMS), 3CX, MySendingBox.
Hébergement : Docker sur VPS. Code sur GitHub ; intégration continue par GitHub Actions (pas de CircleCI) :
.github/workflows/ lance pnpm verifier (types, lint, tests, contrats) sur chaque pull request ;
aucun secret de production dans GitHub Actions, aucun déploiement depuis GitHub Actions.
Aucune autre dépendance sans me la proposer dans le plan. À proposer notamment : @simplewebauthn/browser
et l'affichage d'un QR code pour la double authentification.

# Sources de vérité (dans cet ordre)
1. DECISIONS.md.
2. maquette/HANDOFF.md : règles, rôles, parcours, textes.
3. maquette/captures/ (PNG à 1440, 1024 et 390 px) et maquette/*.dc.html (structure, données, états dans renderVals()).
4. docs/ : stack, domaines et services, lecture de la maquette, IA.
Ce prompt contient des décisions plus récentes que la maquette : paiement, espace débiteur et son accès, SMS à double sens,
domaines, Valkey, double authentification, rôles et délégations, bouton du mode malvoyant, recouvrement amiable, RGPD,
nommage, e-mails, rythme de travail.
5. Kit d'e-mails : kits/emails-handlebars/ (25 modèles, référence, à ne pas modifier) et kits/emails-ajout-staff-message/
   (modèle staff-message et partiel signature).
6. kits/caddy/Caddyfile.exemple : Caddyfile de référence pour infra/caddy/Caddyfile (valeurs entre crochets à garder). En cas d'écart, ce prompt et DECISIONS.md priment.
La maquette est figée : ne modifie ni les écrans ni les captures de maquette/ (HANDOFF.md a été aligné en v2.5). Les évolutions vont dans le code et dans DECISIONS.md.

# Étape 0 : vérifier les décisions (une PR, avant tout écran)
Le kit v2.5 a déjà été mis à jour avec ces décisions : DECISIONS.md, QUESTIONS.md (questions 1 à 29), CLAUDE.md,
LISEZMOI.md, docs/, .claude/rules/, .claude/commands/, .claude/agents/, apps/*/CLAUDE.md, packages/*/CLAUDE.md,
.env.exemple et maquette/HANDOFF.md (texte seulement ; écrans et captures inchangés).
Vérifie que chacun des points suivants y figure et qu'aucun de ces fichiers ne contredit ce prompt :
- paiement par chèque et par virement bancaire uniquement ; plus de carte, de prélèvement SEPA,
  de prestataire de paiement, de badge « Paiements PCI-DSS » ni de clés de prestataire ;
- paiement.legarec.fr est d'abord un espace d'échange entre débiteurs et collaborateurs ;
- accès des débiteurs par identifiant (SIRET ou référence du dossier) et code d'accès ;
- SMS à double sens ;
- nouveaux domaines n8n.legarec.fr (automatisations) et status.legarec.fr (Gatus) ;
- Valkey à la place de Redis ;
- IA par API, fournisseur non imposé, derrière une couche fournisseur ;
- double authentification obligatoire pour le Développeur seulement ;
- « Directeur » remplace « Dirigeant » ; rôles uniques (Directeur, Responsable, Développeur) ;
- droits d'accès aux dossiers par rôle et tableaux de bord (voir « Rôles ») ;
- délégations du Directeur : technique au Développeur, administratif au Responsable, actives dès la mise en service ;
- e-mails : kit emails-handlebars comme seule référence, expéditeur ne-pas-repondre@mail.legarec.fr,
  recouvrement@legarec.fr en réception seule, messages des collaborateurs envoyés par OVH avec signature ;
- code d'accès des débiteurs jamais envoyé par e-mail ;
- fichiers publics de media.legarec.fr (chemins versionnés) ;
- gestion des boîtes OVH (MX Plan, Roundcube) depuis l'espace, par l'API OVHcloud aux droits limités ;
- Caddy comme proxy inverse et pour les redirections (voir l'annexe « Architecture ») ;
- GitHub Actions pour l'intégration continue (remplace « sans GitHub Actions ») ;
- bouton du mode malvoyant dans la Topbar de l'espace ;
- règles « Langue et nommage » ;
- règles du recouvrement amiable et du RGPD ;
- une branche et une pull request par lot (un commit par écran), à la place d'une par écran ou par composant ;
- toutes les décisions de l'annexe « Architecture » (à consigner seulement : rien à développer dans cette mission).
En cas d'oubli ou de contradiction : corrige le fichier du kit (ce prompt prime), et liste les corrections dans la PR.
Ne touche ni à .claude/settings.json (les permissions, c'est moi qui les règle), ni aux écrans et captures de maquette/,
ni à kits/emails-handlebars/.
Crée aussi .github/workflows/ (pnpm verifier sur chaque PR, sans secret ni déploiement) dès que pnpm verifier existe (lot A0).

# Règles métier essentielles (détail dans HANDOFF.md)
- Un créancier ne voit que ses dossiers : filtrage dans l'API. Le portail affiche ce que l'API renvoie,
  sans filtrage de sécurité dans le navigateur. Des tests vérifient qu'un créancier ne voit jamais
  le dossier d'un autre (contre MSW aujourd'hui, contre l'API ensuite).
- Échéancier au-delà du seuil (paramètre administratif, 6 mois par défaut, modifiable par le Responsable) :
  validation du Responsable (sauf sur les dossiers du Directeur), puis accord du créancier.
  Les relances sont suspendues tant que le plan est respecté.
- E-mails : voir la section « E-mails ». Réception des réponses aux relances dans recouvrement@legarec.fr
  (réception seule) ; chaque collaborateur écrit et répond depuis sa boîte professionnelle.
- SMS (OVHcloud), à double sens :
  - les réponses des débiteurs arrivent dans la fiche débiteur (historique des échanges) et dans SMS, en conversation ;
    le gestionnaire du dossier reçoit une notification ;
  - la réponse part de ces deux endroits, avec Confirm et récapitulatif ;
  - une réponse d'un numéro inconnu arrive dans une file « Non rattachés », à relier à la main à un dossier ;
  - chaque SMS contient le bloc imposé {{> mention_sms}} ; une réponse « STOP » arrête les SMS automatiques
    vers ce numéro et prévient le gestionnaire ;
  - compteur de caractères et de SMS facturés : un « ê », un « ç », une apostrophe typographique (’) ou des guillemets « »
    font passer un SMS de 160 à 70 caractères ; le compteur le signale, et les modèles de SMS utilisent l'apostrophe droite (').
- Appels :
  - qualification avec les libellés exacts de la maquette (codes : voir « Langue et nommage ») ;
  - appel sortant en un clic (tel: vers 3CX), chaque appel rattaché au dossier ;
  - un appel entrant d'un numéro connu ouvre la fiche du débiteur (simulé par MSW) ;
  - enregistrement annoncé au débiteur et conservé 6 mois (HANDOFF.md).
- Montants :
  - entiers en centimes dans packages/contracts et MSW (convertis ceux de maquette/donnees-demo), jamais de nombres à virgule ;
  - principal, intérêts et frais séparés ;
  - affichage et saisie au format français (règles de .claude/rules/front.md) ;
  - un paiement partiel s'impute d'abord sur les intérêts (calcul fait par l'API, simulé par MSW).
- Modèles de documents : fichiers HTML Handlebars, sans éditeur.
  Import d'une nouvelle version avec contrôles, aperçu et soumission au Directeur (ou au Responsable par délégation).
  - Contrôles existants : champ inconnu, bloc imposé absent, script ou ressource externe → refus.
  - Contrôles ajoutés : relance sans les champs de la référence et de la date du premier courrier → refus ;
    termes qui imitent un acte de commissaire de justice (sommation, commandement, saisie…) → alerte à valider ;
    modèle de SMS avec des caractères qui font passer à 70 caractères → alerte.
  - La liste des champs de l'application reprend maquette/champs-de-fusion.json et ajoute, dans le même style :
    debiteur.code_acces, dossier.premier_courrier_reference, dossier.premier_courrier_date.
- Paiement : deux moyens seulement.
  - Virement : RIB du compte dédié ([IBAN DU COMPTE DÉDIÉ]), avec la référence du dossier en libellé.
  - Chèque : à l'ordre de [ORDRE DES CHÈQUES], envoyé à [ADRESSE D'ENVOI DES CHÈQUES],
    avec la référence du dossier au dos.
  - Le lien de paiement des modèles (paiement.lien) mène à l'espace débiteur (paiement.legarec.fr).
  - Côté collaborateurs, un paiement reçu s'enregistre à la main depuis la fiche débiteur :
    - chèque : numéro, banque, montant, date de réception, date de remise, puis encaissé ou impayé ;
    - virement : date, montant, libellé reçu, rapprochement avec le dossier.
    Un chèque impayé annule le paiement et relance le suivi du dossier : cette action passe par Confirm.
  - Quittance : générée quand un paiement devient définitif (chèque encaissé, virement rapproché) ;
    consultable dans la fiche débiteur, dans Tous les documents et dans l'espace débiteur.
- Preuves : la fiche débiteur affiche le statut de chaque envoi (e-mail, SMS, courrier, LRAR : envoyé, distribué,
  accusé de réception reçu, erreur) et donne accès aux accusés de réception des LRAR. Le journal d'audit
  (qui, quoi, quand, pour le compte de qui) alimente l'historique.
- Dépôt de créances (partenaires) : import CSV ou Excel. Le fichier part à l'API, qui renvoie un rapport ligne par ligne
  (simulé par MSW) ; aucune analyse du fichier dans le navigateur ; modèle de fichier téléchargeable ;
  rien n'est créé avant Confirm avec récapitulatif (lignes valides, lignes en erreur).
- Logos : uniquement sur les pages de connexion et d'accès, dans l'en-tête des e-mails (fichiers de media.legarec.fr)
  et dans le kit média.
- IA : elle suggère, un collaborateur valide toujours (Appliquer ou Ignorer).
  Jamais d'envoi ni de décision automatique ; tout est masqué si l'assistant est désactivé.
  Le front ne dépend d'aucun fournisseur d'IA.

## Recouvrement amiable (droit français, à faire valider par le juriste du cabinet)
- Le bloc imposé {{> mentions_recouvrement}} porte les mentions de l'article R124-4 du code des procédures civiles
  d'exécution et l'information RGPD. Il est obligatoire dans les courriers, LRAR et e-mails de recouvrement ;
  son texte est à faire valider (QUESTIONS.md, question 7). Mentions attendues :
  - nom ou dénomination et adresse du cabinet, et l'indication qu'il exerce une activité de recouvrement amiable ;
  - nom ou dénomination et adresse du créancier ;
  - fondement et montant de la somme due, en distinguant principal, intérêts et autres accessoires,
    hors frais restant à la charge du créancier ;
  - invitation à payer et modalités de paiement ;
  - reproduction des alinéas de l'article L111-8 prévus par ce texte.
- Chaque démarche suivante (relance, e-mail, SMS) rappelle la référence et la date d'envoi du premier courrier.
- Aucun frais de recouvrement ajouté au montant réclamé, hors cas prévus par la loi. L'indemnité forfaitaire de 40 €
  (creance.indemnites) ne concerne que les débiteurs professionnels, jamais un Particulier.
- Aucune ressemblance avec un acte de commissaire de justice (sommation, commandement) ni menace infondée de saisie
  (article 433-13 du code pénal).
- Pas de harcèlement : plafonds de contacts par débiteur et par canal, plages horaires d'envoi et d'appel,
  réglables dans Paramètres du cabinet > Relances ; historique de chaque contact ; l'agenda des relances prévient
  quand une relance dépasse ces limites.
- Signale dans la PR du lot tout texte de la maquette qui contredit ces règles.

## RGPD
- Information des débiteurs : le bloc {{> mentions_recouvrement}} dès le premier courrier, et la page
  « Confidentialité (RGPD) » du pied de page des écrans publics (texte à fournir).
- Paramètres du cabinet > Données personnelles (thème existant) : durées de conservation par type de donnée
  (valeurs [DURÉE À VALIDER]) et registre des demandes (accès, rectification, opposition, effacement), avec le délai
  d'un mois et l'export des données d'un débiteur. Dans la fiche débiteur, une action « Demande RGPD » alimente ce registre.
  La suppression et l'anonymisation sont faites par l'API.
- Aucune donnée personnelle ni code d'accès dans une URL, un nom de fichier ou un journal.

# E-mails
## Deux circuits
| Type | Envoi | Expéditeur | Réponses |
|---|---|---|---|
| 25 e-mails automatiques (kit) | Resend | LEGAREC <ne-pas-repondre@mail.legarec.fr> | Non acceptées, sauf reminder-1 à reminder-3 : replyTo recouvrement@legarec.fr |
| Message rédigé par un collaborateur dans l'espace (staff-message) | SMTP OVH de sa boîte | Prénom NOM <sa boîte>@legarec.fr | Dans sa boîte OVH (pas de replyTo) |
Les réponses des collaborateurs depuis leur messagerie (hors application) partent de leur boîte OVH, avec la signature
de leur messagerie : rien à développer.

## Kit emails-handlebars (kits/emails-handlebars/)
- Seule référence pour les e-mails automatiques : 25 modèles, layout.hbs, partiels en_tete et mentions_recouvrement,
  subjects.json, samples.json, config.example.json, README.md. Les listes d'e-mails et les champs en français
  des versions précédentes du prompt sont abandonnés : noms de fichiers et champs du kit (config.*, case.*, debtor.*…).
- Copie dans apps/api/templates/emails/ sans réécrire le gabarit, les partiels ni les modèles ; chargement comme
  dans le README (handlebars 4.x, objets compilés avec noEscape: true, corps échappé normalement).
- Aucune valeur en dur : l'objet config vient de la configuration de l'API (variables d'environnement ou table
  de paramètres). config.example.json reste un exemple. Logos : MEDIA_BASE_URL + e-mails/v1/….
- Montants et dates passés déjà formatés en texte (fr-FR), comme le prévoit le kit.
- role_label (invitation d'un collaborateur) vient des libellés de rôle de l'application (« Gestionnaire de créances »),
  pas de samples.json.

## Ajout staff-message (kits/emails-ajout-staff-message/)
- templates/staff-message.hbs et partials/signature.hbs, à copier à côté du kit ; notice AJOUT-staff-message.md.
- Corps : texte saisi par le collaborateur, découpé en paragraphes par l'API aux lignes vides, rendu échappé
  (jamais de HTML libre) ; espaces insécables entre chiffres. Objet saisi par le collaborateur.
- Signature (sans doublon avec l'en-tête et le pied de page) : nom, fonction = libellé du rôle, e-mail de sa boîte,
  téléphone, adresse postale, site, mention de confidentialité ; police Arial comme le reste du kit.
  - Téléphone : numéro 3CX (standard par défaut, config.phone), suivi de « · poste N » si le collaborateur a un poste ;
    lien tel:+33187880298,N. Formats national et international calculés par l'API (libphonenumber-js).
    Jamais de portable personnel.
  - Ajoute à config : firm_address, website_url, website_label.
- Destinataire débiteur (debtor_recipient) : mentions_recouvrement en bas ; sinon « Vous pouvez répondre directement
  à ce message. ». La référence du dossier n'apparaît qu'une fois.
- Envoi par la boîte OVH du collaborateur (MX Plan : chaque boîte s'authentifie avec son propre mot de passe) :
  - SMTP smtp.mail.ovh.net:465 (SSL/TLS) avec nodemailer ; copie dans « Éléments envoyés » par IMAP APPEND
    (ssl0.ovh.net:993) ; copie dans l'historique du dossier ;
  - mots de passe des boîtes : secrets côté API, chiffrés au repos (MAILBOX_SECRETS_KEY), jamais exposés au front,
    dans le code, les journaux ni Git ; saisis par le Développeur dans Paramètres techniques (champ en écriture seule) ;
    aucun pour recouvrement@ ; alerte au Développeur en cas d'échec d'authentification ;
  - quota MX Plan d'environ 200 e-mails par heure et par boîte : compteur par boîte, blocage avec message clair
    avant la limite ; tout envoi en masse passe par Resend ;
  - échec d'envoi : erreur visible dans l'écran, nouvelle tentative proposée ; jamais de bascule silencieuse vers Resend.

## Gestion des boîtes OVH depuis l'espace (MX Plan, webmail Roundcube)
Écran Paramètres techniques > Boîtes e-mail : Développeur (délégation technique) et Directeur uniquement.
Données simulées par MSW dans cette mission ; côté API, appels à l'API OVHcloud (endpoint ovh-eu),
routes /email/domain/legarec.fr/… (ancienne version MX Plan : Roundcube). Vérifie chaque route dans la console
de l'API OVHcloud, pas de mémoire ; écart ou route manquante → QUESTIONS.md.
- Liste des boîtes : adresse, collaborateur rattaché (ou « adresse de fonction »), espace utilisé / taille,
  état de la connexion SMTP/IMAP de l'application.
- Créer une boîte : depuis l'écran ou à l'invitation d'un collaborateur (écran Équipe) ; taille choisie ;
  mot de passe généré par l'API.
- Changer le mot de passe : généré par l'API, enregistré chiffré pour l'envoi des messages, affiché une seule fois
  au Développeur pour être transmis au collaborateur (qui le met à jour dans sa messagerie) ; jamais renvoyé ensuite.
- Redirections et réponse automatique (absence, départ) : créer, modifier, supprimer.
- Départ d'un collaborateur : enchaînement proposé (nouveau mot de passe, réponse automatique, redirection
  vers recouvrement@legarec.fr), chaque étape confirmée.
- Supprimer une boîte : Confirm avec récapitulatif et saisie de l'adresse complète ; irréversible.
  recouvrement@legarec.fr est protégée : ni suppression ni changement de mot de passe depuis l'application.
- Toute action passe par Confirm et est notée dans l'historique (qui, quoi, pour le compte de qui).
- Clés de l'API OVH : application dédiée, droits limités aux routes /email/domain/legarec.fr/* (jamais domaines,
  DNS, facturation ni le reste du compte) ; secrets côté API uniquement, saisis par moi.

## Tests (lot I)
- Rendu des 26 modèles avec la vraie bibliothèque handlebars et les données de samples.json (et de la notice pour
  staff-message) ; captures de référence (snapshots) versionnées.
- Schéma Zod par modèle dans packages/contracts, déduit de samples.json et des commentaires d'en-tête des modèles.
- Seules reminder-1 à reminder-3 ont un replyTo ; staff-message n'en a pas.
- case.access_code n'est jamais transmis à un modèle.
- staff-message : texte saisi échappé (<script> rendu comme texte) ; fonction absente si le rôle est vide ;
  poste affiché seulement s'il est renseigné ; SIREN et référence du dossier présents une seule fois.
- Aucun envoi réel dans les tests : Resend et SMTP simulés.

# Espace débiteur (paiement.legarec.fr)
## Accès
Écran « Accès à mon dossier », absent de la maquette, à proposer dans le plan.
- Identifiant, pré-rempli quand le débiteur arrive par le lien ou le QR code d'un courrier, ou par le lien d'un SMS :
  - entreprise : SIRET, 14 chiffres saisis avec ou sans espaces, clé de contrôle vérifiée ; la recherche se fait
    sur le SIREN (9 premiers chiffres), pour qu'un établissement retrouve un dossier adressé au siège ;
  - Particulier : référence du dossier (dossier.reference), imprimée sur les courriers.
- Code d'accès : 4 lettres majuscules sans I ni O (par exemple KXPM), un par débiteur, valable pour tous ses dossiers,
  généré par l'application et imprimé sur les courriers (debiteur.code_acces). Le débiteur peut demander à le recevoir
  par SMS, au numéro du dossier, affiché masqué (« SMS au 06 •• •• •• 42 ») ; jamais par e-mail (le champ
  case.access_code des modèles d'e-mails n'est jamais transmis : les relances indiquent de le demander par téléphone) ;
  nombre d'envois limité par identifiant et par heure.
- Champ du code affiché en clair (pas masqué), passage automatique en majuscules, correcteur orthographique désactivé,
  minuscules acceptées. Le code n'apparaît jamais dans une URL.
- Essais limités, comme pour la connexion des comptes : après 5 échecs, accès bloqué 15 minutes ; après 10, bloqué
  jusqu'à ce qu'un collaborateur régénère le code, et le gestionnaire du dossier est prévenu ; limite aussi par
  adresse IP. Le front affiche ces états, l'API les applique (MSW les simule).
- Session par cookie httpOnly, fermée après 30 minutes d'inactivité comme sur les autres portails ; sur un appareil
  mémorisé, le code n'est pas redemandé pendant 30 jours.
- Sans code, accès limité : consignes de paiement et envoi de messages ou de pièces, mais rien sur la dette
  (ni montant, ni créancier, y compris dans le pied de page). Ces messages arrivent côté collaborateurs
  avec la mention « non vérifié ».
- Dans la fiche débiteur (espace) : code masqué (« •••• ») ; « Afficher » le révèle et chaque affichage est noté
  dans l'historique ; « Régénérer » passe par Confirm et rend l'ancien code inutilisable.

## Écrans
La maquette Payer est en retard sur ce point : garde son aspect et ses composants, mais réorganise-la ainsi.
- Accueil : solde dû, prochaine échéance, état du dossier, dernier message du cabinet ;
  liste des dossiers si le débiteur en a plusieurs.
- Messages, au premier plan : fil d'échanges avec le cabinet ; envoi de pièces (justificatif de virement,
  copie de chèque, contestation, attestation) par glisser-déposer ; accusé de réception affiché.
- Demandes guidées, chacune envoyée comme un message structuré : proposer un échéancier,
  contester la créance, signaler un paiement déjà effectué, demander à être rappelé.
- Payer : deux onglets, Virement (RIB copiable, référence du dossier) et Chèque (ordre, adresse, référence) ;
  aucun formulaire de paiement en ligne.
- Échéancier : échéances, montants, statut ; quittances téléchargeables.
- Pied de page : retire la mention de paiement sécurisé par carte ; « agissant pour le compte de [créancier] »
  seulement après vérification du code.
- Prévenir le débiteur d'un nouveau message par e-mail (Resend), sans le contenu du message dans l'e-mail.
Côté espace collaborateurs :
- les messages des débiteurs arrivent dans la fiche débiteur (historique des échanges) et dans E-mails,
  avec la source « Espace débiteur » et un filtre dédié ;
- la réponse se fait depuis ces deux endroits et repart dans l'espace débiteur ;
- une notification est créée pour le gestionnaire du dossier ;
- le menu reste inchangé.
Ce qui n'est pas dessiné dans la maquette : propose l'interface dans le plan à partir des composants existants
(fil de messages de Messagerie, Dropzone, Onglets) et ajoute les points ouverts à QUESTIONS.md.

# Aspect et accessibilité
- Deux ambiances sur les mêmes composants :
  - espace : sobre et dense (lignes serrées, préférence « Densité » du compte) ;
  - partenaires et paiement : plus aérés, titres en Lora (data-brand dans la maquette).
- Thèmes clair et sombre. Jamais le rendu par défaut de Mantine (bleu, badges en majuscules).
- Polices : Inter (interface) et Lora (titres des écrans de marque, courriers), hébergées dans packages/tokens
  au format woff2. Aucune police chargée depuis Google Fonts ou un autre service externe ; les PDF utilisent
  les mêmes fichiers.
- Mode malvoyant : celui de la maquette, à conserver tel quel.
  - data-a11y="malvoyant", défini uniquement par les tokens (tokens.css) : texte agrandi d'environ 20 %, contraste
    renforcé, contour de focus de 3 px, liens soulignés, cibles de 48 px, barre latérale élargie.
  - Écrans publics et pages de connexion : boutons « Aa » (texte agrandi) et lune (mode sombre) de la maquette.
  - Espace : en plus du menu du compte, un bouton visible dans la Topbar l'active en un clic.
  - Choix mémorisé dans le profil (espace, partenaires) et sur l'appareil (espace débiteur, pages de connexion).
  - Au-delà, le zoom du navigateur jusqu'à 200 % fonctionne sans perte de contenu.
- Menu de l'espace, ordre validé à ne pas changer :
  - Pilotage : Tableau de bord, Rapports, Équipe, Facturation ;
  - Portefeuille : Créanciers, Débiteurs ;
  - Recouvrement : Relances, Échéanciers, Contentieux ;
  - Communication : Appels, E-mails, SMS ;
  - Documents : Tous les documents, Rédiger un courrier ;
  - Paramètres.
- RGAA / WCAG 2.2 AA, navigation clavier complète, aucun défilement horizontal à 390, 768, 1024 et 1440 px ;
  respect des réglages du système (contraste, animations réduites).

# Étape 1 : plan (mode plan, attends ma validation)
Pour chaque écran, indique :
- la route (scripts/ecrans.json) ;
- les composants de packages/ui à créer ou compléter ;
- les données MSW ;
- les actions qui passent par Confirm ;
- les états à couvrir ;
- les points ouverts.
Une fois le plan validé, enregistre-le dans PLAN.md, à la racine : tu y cocheras l'avancement.
Lots proposés (ajuste l'ordre si une dépendance l'impose) :
- A0. Initialisation, si elle manque :
  - monorepo pnpm + Turborepo ;
  - scripts pnpm dev, build, verifier (types + lint + tests) et comparer ;
  - packages/tokens (thème espace et public, mode sombre, mode malvoyant, polices locales) ;
  - packages/contracts (schémas Zod et correspondance des codes 3CX) ;
  - packages/platform (téléphone, notifications, fichiers générés, liens externes) ;
  - packages/ui (bibliothèque de la maquette, /composant <Nom>) : Alerte, Avatar, Badge, Bouton, Carte, Case, Champ,
    Confirm, EtatListe, Icone, Indicateur, Interrupteur, Onglets, PageHeader, Pagination, PiedDePage, Progression,
    Reglage, Sidebar, Statut, SuggestionIA, Tableau, Toast, Toolbar, Topbar, Tuile.
- A. Socle de l'espace :
  - coquille : Sidebar (sections, compteurs, « Créancier actif »), Topbar (recherche, Créer, aide, notifications, compte,
    bouton du mode malvoyant, bandeau de délégation), PageHeader ;
  - routes, thèmes clair et sombre, préférence Densité, mode malvoyant ;
  - Confirm et Toast « Annuler » disponibles partout ;
  - MSW et session simulée avec rôle et délégations (technique, administrative) ; accès aux routes selon le rôle ;
    lecture seule du Directeur sur les dossiers qui ne lui sont pas attribués ;
  - états communs (chargement, vide, erreur) ;
  - écrans Erreur, Connexion (si elle n'existe pas, avec l'étape de double authentification) et Tableau de bord (Main).
- B. Portefeuille : Créanciers (Mandants), Fiche créancier (Mandant), Débiteurs (Dossiers),
  Fiche débiteur (Dossier, avec la synthèse IA, l'enregistrement des paiements et les quittances, les messages
  de l'espace débiteur, le code d'accès, les preuves d'envoi, l'historique et l'action « Demande RGPD »).
- C. Recouvrement : Relances (agenda FullCalendar, alertes de plafonds et de plages horaires), Échéanciers, Contentieux.
- D. Communication : Appels (Telephonie, avec le panneau IA et l'appel entrant), E-mails (Messagerie, avec l'analyse
  et le brouillon IA et les messages de l'espace débiteur), SMS (conversations, « Non rattachés », compteur).
- E. Pilotage : Notifications, Rapports, Équipe (rôles uniques, poste 3CX, désactivation d'un collaborateur),
  Facturation (y compris par délégation) ; tableaux de bord par rôle (global pour le Directeur, équipe pour le Responsable).
- F. Documents : Tous les documents (avec les quittances), Rédiger un courrier (Generer).
- G. Paramètres, compte et aide : Paramètres (Reglages : Paramètres du cabinet avec Relances, SMS et Données personnelles ;
  Paramètres techniques sans paiement en ligne ; Assistant IA), Modèle (avec les contrôles ajoutés),
  Paramètres techniques : boîtes e-mail OVH (liste, création, mot de passe, redirections, réponse automatique,
  départ d'un collaborateur, suppression ; voir « Gestion des boîtes OVH ») ;
  Mon compte (Compte : double authentification, délégations, affichage), Aide, Article d'aide (AideArticle).
- H. Portails externes :
  - partenaires : Connexion avec portail="partenaires", Portail, dépôt de créances par fichier, et accord du créancier
    sur les échéanciers de plus de 6 mois (absent de la maquette : à proposer) ;
  - espace débiteur : Accès à mon dossier, accès limité, Payer réorganisé, page Confidentialité (RGPD).
- I. E-mails (apps/api) : intégration du kit et de l'ajout staff-message, service de rendu, schémas Zod, tests
  (voir « E-mails ») ; écran de rédaction d'un message dans la fiche débiteur et dans E-mails (envoi par OVH simulé
  par MSW) ; workflow GitHub Actions qui lance pnpm verifier.

# Étape 2 : pour chaque écran
- Une branche lot/<lettre> par lot, créée depuis la branche du lot précédent tant que celui-ci n'est pas fusionné :
  la PR du lot vise alors cette branche (PR empilées), ou main si le lot précédent est fusionné. PR ouvertes avec gh.
- /ecran <Nom> sans attendre d'accord (le plan validé en tient lieu), puis un commit par écran.
  Un composant manquant se construit avec /composant, dans le même lot.
Un écran est terminé quand :
- structure, textes, libellés et ordre sont identiques à la maquette et à HANDOFF.md, sauf les décisions de ce prompt ;
  tout écart est signalé dans la PR du lot ;
- tous les états de renderVals() sont couverts : chargement, vide, erreur, rôles, délégation, confirmations,
  mode sombre, mode malvoyant ;
- les données viennent de MSW (maquette/donnees-demo/<Ecran>.json, données métier uniquement) via TanStack Query,
  avec des types rangés dans packages/contracts pour passer à l'API sans toucher aux écrans ;
- toute action qui engage (envoi, LRAR, désactivation, dépôt, paiement, procédure) passe par Confirm avec récapitulatif ;
  une action réversible affiche un Toast « Annuler » ;
- rien ne défile horizontalement aux quatre largeurs ; navigation clavier complète ; axe ne remonte aucune erreur,
  en mode normal comme en mode malvoyant ;
- /comparer <Nom> passe sous le seuil à 1440, 1024 et 390 px en mode normal, ou l'écart est expliqué.
  Écrans et états sans capture (Accès à mon dossier, registre des demandes RGPD, « Non rattachés », délégation,
  mode malvoyant…) : pas de comparaison, mais relecture par relecteur-maquette et contrôle axe ;
- les tests Vitest et le parcours Playwright existent, et /verifier est vert (relecteur-maquette, relecteur-securite, testeur).

# Garde-fous
- Les blocs « Démonstration » et les sélecteurs « Voir en tant que » de la maquette ne sont pas reproduits :
  le rôle vient de la session (simulée par MSW en développement).
- Les données de la maquette (montants, SIRET, SIREN) sont fictives : uniquement dans MSW.
- Aucun secret côté front, jamais de jeton dans localStorage.
- Mots de passe des boîtes OVH et clés (MAILBOX_SECRETS_KEY, clés de l'API OVH, Resend) : jamais dans le code, Git, les journaux,
  les tests ni GitHub Actions ; c'est moi qui les saisis, hors de Claude Code.
- Kits d'e-mails : ne modifie pas kits/ ; travaille sur la copie dans apps/api/templates/emails/.
- Tu travailles uniquement dans l'environnement de développement : aucun accès aux secrets, aux conteneurs,
  aux journaux ni à la base de production du VPS, même si tu tournes sur la même machine.
  docker compose : uniquement le projet de développement. Uniquement des données fictives.
- Aucune donnée personnelle ni code d'accès dans une URL, un nom de fichier ou un journal.
- Aucune carte, aucun prélèvement SEPA, aucun prestataire de paiement ni badge PCI-DSS, nulle part.
  Écrans de la maquette qui en parlent encore, à adapter au moment de leur développement :
  Connexion, Payer, Dossier, Dossiers, Echeanciers, Telephonie, Sms, Generer, Modele, Reglages, Aide, AideArticle,
  Bibliotheque, Composants, Toast.
- Valeurs entre crochets ([SIREN], [IBAN DU COMPTE DÉDIÉ], [ORDRE DES CHÈQUES], [ADRESSE D'ENVOI DES CHÈQUES],
  [DURÉE À VALIDER]…) : laisse-les telles quelles, ce sont des valeurs de configuration.
- Téléphone (tel: vers 3CX), notifications, fichiers générés et liens externes passent par un seul module : packages/platform.
- Libellés, ordre des menus et règles métier validés : ne les change pas sans le signaler.
- Ne modifie ni .claude/settings.json, ni les écrans et captures de maquette/, ni kits/emails-handlebars/.
- Ne lance jamais pnpm deployer ; ne pousse jamais directement sur main ; pas de force push.

# Rythme
Après validation du plan, enchaîne tous les lots sans t'arrêter ni attendre « suite ».
- Une PR par lot (un commit par écran), plus une PR pour l'étape 0.
- Écran suivant dès que /verifier est vert ; coche-le dans PLAN.md.
- Point non tranché : prends l'option par défaut, note-la dans QUESTIONS.md et continue.
- Arrête-toi seulement si :
  - une décision ne peut pas être annulée ;
  - une règle de sécurité ou une règle métier serait en jeu ;
  - /verifier échoue toujours après trois tentatives.
- Si la session est interrompue ou relancée, reprends à partir de PLAN.md et du dernier bilan.
- À la fin de chaque lot : bilan de trois lignes (fait, écarts avec la maquette, questions ajoutées), puis lot suivant.
- À la fin : bilan général et liste des questions à trancher.

# Annexe « Architecture » : décisions à consigner à l'étape 0 (rien à développer dans cette mission)
- Files d'attente : Valkey + BullMQ (VALKEY_URL) ; workers dans un conteneur séparé de l'API ; Valkey avec persistance
  AOF et maxmemory-policy noeviction. Option notée : le backend PostgreSQL de BullMQ 6, plus récent, non retenu pour l'instant.
- Relances programmées : planning dans PostgreSQL (date prévue, statut) ; un job scheduler BullMQ met en file
  les relances échues toutes les 5 minutes environ, avec un identifiant de job fixe (reminder-<id>) ;
  avant l'envoi, le worker vérifie que la relance est toujours due et qu'elle respecte les plages et les plafonds.
- Envois : une file par canal (e-mail Resend, e-mail OVH des collaborateurs, SMS OVH, courrier MySendingBox),
  limiteur de débit par fournisseur (et par boîte OVH : quota MX Plan),
  nouvelles tentatives espacées, flows pour les envois groupés ; clé d'idempotence Resend ;
  aucune nouvelle tentative automatique d'un LRAR au statut incertain : vérification manuelle.
- PDF : file dédiée à faible concurrence, un seul Chromium réutilisé, conteneur à mémoire plafonnée ;
  polices Inter et Lora locales.
- E-mails entrants : synchronisation IMAP par interrogation toutes les 1 à 2 minutes, une seule à la fois par boîte
  (ImapFlow) ; état de synchronisation (UIDVALIDITY, dernier UID) en base ; pièces jointes dans S3 ;
  réponses des collaborateurs par SMTP OVH de leur propre boîte (MX Plan, un mot de passe par boîte, chiffré) ;
  recouvrement@legarec.fr synchronisée en réception seule.
- Boîtes OVH : gestion par l'API OVHcloud (client ovh pour Node ou appels signés), clé d'application dédiée
  limitée à /email/domain/legarec.fr/* ; aucune action OVH
  lancée par un worker sans demande d'un utilisateur.
- SMS : OVHcloud ; expéditeur sous forme de numéro (et non le nom « LEGAREC ») pour recevoir les réponses,
  rattachées au dossier par numéro de téléphone.
- Contrats : schémas Zod de packages/contracts → OpenAPI produit par nestjs-zod → types des routes générés
  par openapi-typescript, régénérés et vérifiés par pnpm verifier (en local et dans GitHub Actions).
- Montants : centimes entiers ; taux d'intérêt légal dans une table mise à jour chaque semestre.
- Double authentification : otplib (TOTP) et @simplewebauthn/server.
- IA : couche fournisseur (interface unique ; adaptateurs Anthropic et compatible OpenAI pour Scaleway et OVH).
  Les deux niveaux de docs/ia.md (IA_MODELE_RAPIDE, IA_MODELE_AVANCE) pointent par défaut vers Claude Haiku 5.5
  et Claude Sonnet 5.5, jamais en dur ; budget et journal de docs/ia.md conservés, avec le coût de chaque appel ;
  seules les données nécessaires sont envoyées ; IA désactivée en production tant que le contrat de sous-traitance
  n'est pas signé.
- Fichiers des dossiers (Scaleway S3, bucket legarec-documents) : répertoires en français, sans accents ni espaces :
  dossiers/{id}/pieces/, dossiers/{id}/courriers/, dossiers/{id}/accuses-reception/, dossiers/{id}/quittances/,
  dossiers/{id}/emails/, imports/. Noms de fichiers : identifiants générés, nom d'origine conservé en base.
- Sauvegardes : pgBackRest 2.59.3 minimum (projet maintenu, relancé en mai 2026 après l'annonce d'avril),
  chiffrement activé, dépôt dans un bucket séparé (legarec-sauvegardes) avec ses propres clés et le versioning activé ;
  restauration testée automatiquement et régulièrement dans un conteneur temporaire.
- Surveillance : Gatus surveille aussi les sauvegardes et les tests de restauration.
- Proxy inverse : Caddy, seul service exposé sur Internet (ports 80 et 443), dans le docker compose de production ;
  un Caddyfile versionné dans le dépôt (infra/caddy/Caddyfile), validé par caddy validate dans pnpm verifier.
  - HTTPS automatique (Let's Encrypt), HTTP redirigé vers HTTPS, HSTS ; en-têtes de sécurité par portail
    (CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) ; compression ; journaux d'accès JSON
    sans données personnelles ni paramètres de requête.
  - Routage : espace, partenaires et paiement vers leurs fichiers statiques (repli sur index.html pour les routes
    du front) ; api.legarec.fr vers l'API ; n8n.legarec.fr et status.legarec.fr vers leurs conteneurs,
    n8n restreint (adresses IP autorisées ou authentification devant).
  - status.legarec.fr : proxy inverse vers le conteneur Gatus (reverse_proxy gatus:8080), page publique
    limitée aux services utiles aux utilisateurs (portails, API) ; les contrôles internes (sauvegardes, restauration,
    files, base) restent visibles seulement depuis les adresses IP autorisées ou derrière authentification.
  - Redirections, une par ligne dans le Caddyfile avec un commentaire, sans transmettre de paramètre ni de donnée
    personnelle :
    - http → https sur tous les sous-domaines (automatique) ;
    - www.espace, www.partenaires, www.paiement → même adresse sans www (301) ;
    - mail.legarec.fr (page web) → legarec.fr (301) ; media.legarec.fr/ et api.legarec.fr/ (racine seule)
      → legarec.fr et status.legarec.fr (302).
    - legarec.fr et www.legarec.fr ne passent pas par Caddy : aucune redirection pour eux.
  - La redirection d'un compte connecté vers le bon portail reste faite par l'application, pas par Caddy.
  - Les conteneurs internes (API, PostgreSQL, Valkey, workers) ne publient aucun port sur l'hôte.
  - Caddy de développement séparé, avec certificats locaux ; Claude Code ne touche jamais au Caddy de production.
- Journaux : JSON (pino), centralisés dans Loki et consultés dans Grafana ; données personnelles et bancaires masquées.
- n8n passe par l'API avec un compte de service aux droits limités, jamais directement par PostgreSQL.
- Mises à jour : versions exactes figées ; Renovate (application GitHub) propose les mises à jour regroupées,
  vérifiées par pnpm verifier dans GitHub Actions avant fusion.
- Fichiers publics : bucket legarec-media (media.legarec.fr), chemins versionnés, jamais de remplacement ;
  documents des dossiers dans legarec-documents (privé), sauvegardes dans legarec-sauvegardes : une clé d'accès par bucket.
- Claude Code : environnement de développement séparé, données fictives, aucun accès aux secrets ni à la production ;
  utilisateur système dédié, sans accès aux fichiers de production ni au groupe docker de la production ;
  déploiement uniquement par pnpm deployer, lancé par moi.
