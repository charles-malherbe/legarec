# Legarec — note de handoff (maquette → application)

> **Mise à jour v2.5 (24/11/2026)** : ce texte a été aligné sur `PROMPT-FRONT.md` et `DECISIONS.md`, qui priment en cas d'écart. Les écrans `.dc.html` et les captures restent ceux de la maquette figée : ils peuvent encore montrer l'ancien fonctionnement (paiement par carte, « Dirigeant », etc.).

## Intention de design
- Outil de production pour un cabinet de recouvrement parisien : densité d'information et rapidité avant la décoration.
- Charte LEGAREC v1.0 : marine #002B74, or #FCBE03 (accent, jamais en texte sur fond clair), ardoise #5D7087 (texte secondaire), Lora Bold (titres), Poppins (textes).
- **Polices de l'application (v1.5)** : Inter pour toute l'interface (titres 600–700, texte 400–500, chiffres alignés, très lisible en 12–14 px, accents complets). Lora, police de la marque, reste réservée aux titres des écrans de marque : connexion, espace de paiement, espace créancier, page d'erreur (attribut `data-brand`), ainsi qu'aux courriers et au kit média. Poppins n'est plus chargée dans l'application ; elle reste dans la charte pour la communication.
- **Pied de page (v1.6)** : composant `PiedDePage`, uniquement sur les écrans publics (Connexion, Payer, Portail, Erreur) ; jamais dans l'application de gestion. Contenu : © Legarec, cabinet de recouvrement amiable, Paris, 01 87 88 02 98 (lien `tel:`), Mentions légales, Confidentialité (RGPD), Cookies. Sur Payer : « agissant pour le compte de [créancier] », seulement après vérification du code d'accès ; plus de mention de paiement par carte. Les textes des pages légales sont à fournir et à faire valider par le juriste.
- **Menu latéral (v1.7)** : Pilotage (Tableau de bord, Rapports, Équipe, Facturation) · Portefeuille (Créanciers, Débiteurs) · Recouvrement (Relances, Échéanciers, Contentieux) · Communication (Appels, E-mails, SMS) · Documents (Tous les documents, Rédiger un courrier). Le libellé du menu = titre de la page = fil d'Ariane. En-tête : icône L, « Legarec », « Recouvrement de créances » ; le bouton « Réduire le menu » est en bas du menu ; menu fixe au défilement (≥ 1024 px) ; bouton Fermer dans le tiroir mobile.
- **Modèles = fichiers HTML (v1.10)** : pas d'éditeur dans l'application. Paramètres > Modèles de documents liste les modèles ; `Modele.dc.html` permet de télécharger le fichier, d'importer une nouvelle version (contrôles : champ inconnu, bloc imposé absent, script ou ressource externe → refus), de voir l'aperçu et de soumettre au Directeur (ou au Responsable du recouvrement, par délégation). Syntaxe Handlebars `{{champ}}`, `{{#each}}`, `{{#if}}`, blocs imposés `{{> mentions_recouvrement}}` etc. Liste complète : `champs-de-fusion.html` (source `tools/fields.py`).
- **Domaines** : `espace.legarec.fr` = portail interne (employés : appels, SMS, e-mails, agenda, suivi des relances, historique des fichiers) ; `partenaires.legarec.fr` = portail créanciers (avancement, transmission de pièces) ; `paiement.legarec.fr` = portail débiteurs (paiement, RIB, échéancier ; liens des courriers et SMS) ; `api.legarec.fr` = API back-end ; `legarec.on3cx.fr` = standard 3CX ; `media.legarec.fr` = fichiers publics (`e-mails/v1/`, `marque/`, `documents-publics/`). `mail.legarec.fr` = Resend (e-mails automatiques, expéditeur ne-pas-repondre@mail.legarec.fr ; SPF/DKIM sur ce sous-domaine, ceux d'OVH restent sur legarec.fr). `n8n.legarec.fr` = automatisations ; `status.legarec.fr` = page d'état (Gatus). `legarec.fr` = domaine principal (site public du cabinet, hors application ; adresses e-mail OVH). Les autres domaines ne sont pas à prendre en compte. Tableau dans Paramètres techniques > Intégrations et API.
- **Confirmations (v1.10)** : fenêtre de confirmation avant tout envoi définitif, désactivation ou dépôt engageant : envoi de courriers (Rédiger un courrier, simple et groupé), déconnexion de sessions (Compte), désactivation d'un utilisateur ou annulation d'invitation, dépôt de créances (espace créancier), demande d'échéancier et contestation (espace de paiement). Déjà présentes : contentieux, échéanciers, facturation, clés API, actions groupées sur les débiteurs, téléphonie, modèles. Les actions réversibles (archiver, filtrer) utilisent un toast avec Annuler plutôt qu'une fenêtre.
- **Messagerie** : la boîte partagée `recouvrement@legarec.fr` (OVH) est en **réception seule** (réponses aux relances) : personne n'écrit depuis elle. Chaque collaborateur écrit et répond depuis sa boîte professionnelle (`initiales@legarec.fr` ou adresse de fonction ; dans la maquette, `cl@legarec.fr` Camille Laurent, compte fictif), avec sa signature ; copie rattachée au dossier. Les messages rédigés dans l'espace partent par la boîte OVH du collaborateur. Prévoir une règle pour les initiales en double.
- **Connexion par portail** : `espace.legarec.fr` (comptes @legarec.fr, SSO possible) et `partenaires.legarec.fr` (créanciers). Après mot de passe correct, un compte connecté sur la mauvaise adresse est redirigé vers la bonne avec un message (pas avant l'authentification, pour ne pas révéler l'existence d'un compte). Prop `portail` du composant Connexion.
- **Stack retenue** : TypeScript partout. Front React 19.2+ + Vite + **Mantine 9.8** (thème issu de `tokens.css`), TanStack Table 9 en direct, affiché avec le `Table` de Mantine (listes), FullCalendar (agenda, extensions gratuites), @mantine/charts (graphiques, base Recharts ; pas de Tailwind), cmdk (recherche rapide) (monorepo pnpm/Turborepo : `espace`, `partenaires`, `paiement`, `packages/ui`, `packages/tokens`). API NestJS sur `api.legarec.fr`, PostgreSQL + **Prisma**, Valkey + BullMQ pour les tâches planifiées. PDF des modèles Handlebars avec **Playwright** (Chromium). Fichiers sur **Scaleway Object Storage (S3)**. Lettres recommandées et courriers via **MySendingBox** (clés test et production). Code sur **GitHub, avec GitHub Actions** pour les vérifications (sans déploiement). Déploiement en **conteneurs Docker sur un serveur VPS**, derrière **Caddy**. Paiement des débiteurs : **chèque et virement uniquement** (RIB et référence du dossier) ; plus de carte ni de prélèvement SEPA.
- **Messagerie OVH (MX Plan, Roundcube)** : IMAP `ssl0.ovh.net` 993 SSL/TLS (réception), SMTP `smtp.mail.ovh.net` 465 SSL/TLS (envoi depuis la boîte de chaque collaborateur), POP non utilisé. Boîtes gérées depuis Paramètres techniques par l'API OVHcloud.
- **Aspect retenu** : deux ambiances sur les mêmes composants. `espace.legarec.fr` (outil de production) : sobre et dense, fond gris clair, marine réservé aux actions et à l'élément actif, or en accent, Inter, lignes de tableau serrées (préférence « Densité » dans Mon compte). `partenaires.legarec.fr` et `paiement.legarec.fr` (publics extérieurs) : plus aérés et rassurants, titres en Lora (`data-brand`), plus d'espace, textes d'aide plus présents. Seuls des réglages de tokens diffèrent, pas les composants.
- **Bibliothèque UI** : Mantine retenu. Comparatif visuel des 5 options étudiées (shadcn, Mantine, React Aria, Ant Design, MUI) sur la page « Comparatif bibliothèques UI » du canevas.
- Logos uniquement sur la connexion, dans l'en-tête des e-mails et dans le kit média.
- **Assistant IA (v2.0)** : l'IA suggère, un collaborateur valide toujours. Appels : transcription en direct seulement après l'annonce de l'enregistrement, puis résumé et qualification proposés (« Appliquer à la fiche » / « Ignorer », annulable). E-mails : catégorie proposée (icône étincelle dans la liste, corrigeable), analyse (résumé, dossier rattaché, montants et dates extraits, actions proposées), bouton « Brouillon IA » dans la réponse. Fiche débiteur : synthèse en 5 lignes (situation, promesses, dernier contact, blocage, suggestion), « Régénérer », « Signaler une erreur ». Paramètres > Assistant IA : fonctions activables une à une, garde-fous verrouillés, fournisseur et hébergement (à choisir), budget mensuel, journal des suggestions et des décisions. Couleur violette réservée à l'IA ; mention « Proposé par l'IA, à vérifier » partout.
- Structure commune des pages métier : en-tête (titre, description, actions, chiffres clés) → barre de filtres → contenu.
- Toute décision qui engage (argent, procédure, coordonnées, secrets) passe par une fenêtre de confirmation, avec un motif quand c'est pertinent, et une trace d'audit.
- La page Appels est le cœur : on y qualifie un appel au clavier en moins de 60 s, sans quitter l'appel pour corriger les coordonnées.
- Identification : débiteurs par SIRET (ou « Particulier »), créanciers par SIREN.
- Mobile : menu en tiroir, contenu sur une colonne, tableaux défilants. L'usage principal reste sur ordinateur, avec casque et 3CX.

## Où trouver quoi
- **Tokens** : bloc `/* tokens:start … tokens:end */` présent dans chaque fichier (`:root` + règles globales : focus, survol, désactivé, squelettes, cibles 44 px). Source unique : `tokens.css` à la racine du projet.
- **Fondations** : `Composants.dc.html` (couleurs, typographie, rayons, ombres, espacements, règles globales).
- **Bibliothèque de composants** : catalogue `Bibliotheque.dc.html` (exemples vivants, props, écrans qui les utilisent), page « Bibliothèque de composants » du canevas. Chaque composant est un fichier `.dc.html` importé par les écrans (`<dc-import name="Bouton" …>`) :
  - fondamentaux : `Bouton` (8 variantes, 4 tailles, icône, raccourci, compteur, chargement, lien), `Icone` (58 icônes au trait), `Badge`, `Statut`, `Avatar` ;
  - formulaires : `Champ` (libellé, aide et erreur reliés), `Interrupteur`, `Case`, `Reglage` (ligne de paramètre) ;
  - navigation et structure : `Onglets`, `Carte`, `Tuile`, `PageHeader`, `Toolbar`, `Pagination`, `Sidebar`, `Topbar` ;
  - données et retours : `Tableau`, `Toast`, `Indicateur`, `Progression`, `Alerte`, `EtatListe`, `Confirm`.
  - Props en anglais, noms de composants en français. Dans la maquette, les instances portent `style="display: contents"` pour ne pas ajouter de boîte : détail propre à l'outil, à ignorer en production.
  - Restent en balisage dans les écrans : les tableaux métier riches (cases à cocher, actions par ligne), les puces de choix (forme pilule) et les boutons-lignes. Ils suivent les mêmes règles que `Tableau` et sont à basculer sur ce composant au développement.
- **Listes longues** : les en-têtes de colonnes restent visibles au défilement (attribut `data-table-scroll`, hauteur max. 68 % de l'écran).
- **Écrans** : `canvas.json` (pages Connexion, Pilotage, Portefeuille, Recouvrement, Documents, Administration, Aide, Espaces externes, Composants).

## Règles métier à implémenter
1. **Rôles** : Développeur, Directeur (remplace « Dirigeant »), Responsable du recouvrement, Gestionnaire de créances, Créancier. Directeur, Responsable et Développeur sont uniques.
   - Directeur : lecture de tous les dossiers, actions sur les siens, chiffres globaux du cabinet.
   - Responsable du recouvrement : ses dossiers, ceux des gestionnaires et les dossiers sans gestionnaire.
   - Gestionnaire de créances : ses dossiers. Développeur : aucun dossier.
   - Délégations du Directeur, actives dès la mise en service : technique au Développeur, administratif (facturation, modèles, invitations, attribution) au Responsable.
   - Paramètres techniques : Développeur et Directeur.
   - Un créancier ne voit que ses propres dossiers.
   - **Contrôle côté serveur obligatoire.**
1 bis. **Fournisseurs** : téléphonie 3CX ; e-mails automatiques Resend, messagerie de l'équipe OVH MX Plan ; **SMS OVHcloud** (API SMS, nom d'expéditeur validé par OVHcloud, clé dans « Secrets et clés »). Numéro du service : 01 87 88 02 98.
2. **Connexion**
   - Mot de passe de 12 caractères minimum, stocké chiffré.
   - Verrouillage de 15 min après 5 échecs.
   - Lien de réinitialisation valable 1 h, invitation valable 72 h.
   - Double authentification obligatoire pour le Développeur ; proposée aux autres rôles.
   - Avertissement à 28 min d'inactivité, déconnexion à 30 min.
   - Journal d'audit.
3. **Échéanciers** : au-delà du seuil (6 mois par défaut, réglable par le Responsable), validation du Responsable (sauf dossiers du Directeur) puis accord du créancier. Les relances sont suspendues tant que le plan est respecté.
4. **Qualification d'appel**
   - 8 résultats, avec un code envoyé à 3CX : PROMESSE, ECHEANCIER, RAPPEL, LITIGE, DEJA_PAYE, ABSENT, NON_REPONSE, FAUX_NUMERO.
   - Champs obligatoires selon le résultat.
   - Post-appel de 60 s pendant lequel 3CX met le poste en pause.
5. **Coordonnées du débiteur**
   - Plusieurs numéros et e-mails, dont un principal.
   - Contrôle du format et des doublons ; origine de la correction obligatoire.
   - Confirmation avant enregistrement ; l'ancienne valeur est conservée et marquée invalide.
   - Vérification d'un nouvel e-mail par Resend ; synchronisation de la fiche contact 3CX.
6. **Facturation**
   - Le numéro devient définitif à l'émission ; une correction passe par un avoir.
   - Mentions légales : pénalités de retard, indemnité forfaitaire de 40 € (article L441-10 du Code de commerce).
7. **E-mails** : envois automatiques par Resend (kit `kits/emails-handlebars`, expéditeur ne-pas-repondre@mail.legarec.fr), échanges écrits par l'équipe via sa boîte OVH (MX Plan), y compris depuis l'espace. Le SPF et le DKIM doivent couvrir les deux.
8. **Conformité**
   - Recouvrement amiable : articles R124-1 et suivants du Code des procédures civiles d'exécution.
   - SMS : mention STOP obligatoire.
   - Appels : enregistrement annoncé au débiteur, conservation 6 mois.
   - Salariés : information sur le suivi de leur activité (article L1222-4 du Code du travail).
   - Paiements : chèque et virement uniquement.
   - Données personnelles : durées de conservation RGPD.
9. **Raccourcis clavier** (inactifs pendant la saisie)
   - Partout : « / » ou Ctrl K pour la recherche, « ? » pour l'aide, G suivi d'une lettre pour la navigation, N pour l'action principale, F pour chercher dans la liste, 1 à 9 pour les onglets.
   - Page Appels : D, X, M, A, H et T ; Ctrl Entrée pour enregistrer.
10. **Typographie française** : espace insécable avant « : ; ! ? » ; montants au format 1 250,00 € ; dates en toutes lettres dans les courriers.

## Comportements d'interface
- **Tokens** : couleurs, typographie, espacements (grille de 4 px, demi-pas de 2, 6, 10 et 14 px), hauteurs de contrôles (28, 36, 40, 44), rayons, ombres et voiles passent tous par des variables (`tokens.css`).
- **Fenêtres** (confirmation, raccourcis, session) : le focus est retenu dans la fenêtre et rendu à l'élément d'origine à la fermeture. Échap ferme ; Entrée confirme.
- **Actions confirmées** : le bouton passe en « Enregistrement en cours… », désactivé avec un indicateur, pendant l'envoi.
- **Listes** :
  - squelette au premier chargement ;
  - « Aucun élément » quand la liste est vide ;
  - « Aucun résultat pour … » quand la recherche ne trouve rien, avec un bouton pour l'effacer.
- **Recherche** : la recherche des listes filtre sur tous les champs visibles, y compris SIRET et SIREN sans espaces.
- ~~**Paiement par carte**~~ : supprimé (chèque et virement uniquement).
- **Barre latérale** : les compteurs au-delà de 99 s'affichent « 99+ ». Le menu tiroir mobile se ferme avec Échap et rend le focus au bouton du menu.
- **Navigation** : pas de widget « Ma journée » ni d'objectif dans les barres de navigation. Les indicateurs sont sur le tableau de bord.
- **Recherche globale** : la page ne s'assombrit pas. Un clic hors des résultats les ferme.
- **Icône d'application** : « L » or sur carré marine (Lora), dans toute l'application. Le logo complet n'apparaît que sur la page de connexion, dans l'en-tête des e-mails et dans le kit média.
- **Pagination** (composant `Pagination`) :
  - intervalle affiché (« 1–25 sur 248 »), 25, 50 ou 100 lignes par page, numéros de page avec « … » ;
  - en mobile, le choix se réduit à « Page n / N » ;
  - pagination côté serveur : la maquette répète les données de démonstration d'une page à l'autre.
- **Modes d'affichage**, choisis dans le menu du compte et mémorisés par utilisateur :
  - thème clair, sombre ou système (`data-theme` sur `<html>`) ;
  - mode malvoyant (`data-a11y="malvoyant"`) : texte agrandi d'environ 20 %, contraste renforcé, contour de focus de 3 px, liens soulignés, cibles de 48 px, barre latérale élargie ;
  - les deux modes sont définis uniquement par les tokens ;
  - l'espace de paiement, l'espace créancier et la connexion ont leurs propres boutons « Aa » (texte agrandi) et lune (mode sombre).
- **Corrections de l'audit v1.3 (P1, appliquées en v1.4)** :
  - Appels : de 1 024 à 1 439 px, la file d'appels se replie en rail (bouton « › ») ; dès 1 280 px, carte et qualification restent côte à côte, la qualification défile seule et son pied (« Enregistrer et appel suivant ») reste visible ; les indicateurs sont masqués pendant un appel ;
  - mode sombre : le texte posé sur une couleur utilise `--on-primary` (jamais `--white`) ; « Raccrocher » utilise `--danger` ; la carte d'appel a une bordure ;
  - contrastes : `--border-strong` passe à #7D8DA1 (#67778F en sombre) et sert de bordure à tous les champs ; focus #9DB8F0 en sombre ; badges pleins sur les tons `--solid-*` ;
  - fiche débiteur : bandeau des contacts (appel en un clic) et « Appeler » en bouton principal ;
  - périmètre créancier : le sélecteur « Créancier actif » du menu latéral est la seule source (mémorisé, `lg-creditor`) ; les barres de filtres l'affichent en puce, sans liste « Tous les créanciers » ; les sous-menus de Débiteurs sont retirés ;
  - états d'échec : bandeau « Connexion perdue », toast « Fiche enregistrée · Annuler » (Appels), alertes « 3CX injoignable » et « Appel non abouti », erreur de chargement de liste.
  - Pour les voir dans la maquette : menu du compte → « Démonstration » (fin de session, coupure réseau) ; carte d'appel → « Démonstration : simuler » ; Débiteurs → taper « erreur » dans la recherche.
- **Appels 3CX** :
  - mise en attente : bandeau avec la durée d'attente et bouton « Reprendre l'appel » (touche A) ;
  - transfert « Annoncé » (on présente le dossier au collègue, puis « Finaliser le transfert » ou « Reprendre le débiteur ») ou « Direct » ; les postes absents ou en appel ne sont pas proposés ;
  - case « Annonce de l'enregistrement faite au débiteur », obligatoire pour enregistrer la fiche ;
  - fiche impossible à enregistrer sans résultat d'appel ; le post-appel affiche un compte à rebours de 60 s puis le dépassement ;
  - composition prévisualisée : la fiche suivante s'affiche 5 s avant que 3CX compose, avec « Appeler maintenant », « Passer ce débiteur » et « Mettre en pause ».
- **Paramètres : page d'accueil et sous-pages** :
  - l'accueil présente les thèmes en tuiles (icône, description, état actuel : « 1 compte sans double authentification », « 2 secrets à renouveler »…), regroupés en colonnes, avec une recherche de paramètre ;
  - chaque thème s'ouvre seul, avec un lien de retour, des onglets vers les thèmes voisins du même groupe et un état « Tout est à jour » ;
  - une modification fait apparaître une barre d'enregistrement fixée en bas (« Annuler » / « Enregistrer ») ;
  - le sélecteur de rôle de démonstration est rangé en bas de l'accueil.
- **Paramètres séparés** :
  - « Paramètres du cabinet » pour tous les rôles autorisés : organisation, comptes, rôles, kit média, relances, modèles, SMS, reversements, données personnelles ;
  - « Paramètres techniques » (3CX, boîtes e-mail OVH, API, secrets, sécurité, journaux ; plus de paiement en ligne), visibles pour le Développeur et le Directeur ; tout autre rôle voit un écran d'accès refusé ;
  - le menu du compte regroupe les paramètres de l'utilisateur : profil, sécurité, notifications, affichage.

## Purement illustratif — NE PAS implémenter tel quel
- Commandes « Démonstration » (menu du compte, carte d'appel) et recherche « erreur » de Débiteurs : uniquement pour montrer les états.
- Sélecteurs « Voir en tant que » (Paramètres, Facturation) : le rôle choisi est mémorisé dans le navigateur (`lg-role`) pour simuler le rôle Développeur. En production, le rôle vient de la session.
- Mémorisation des préférences et du mode des paramètres dans le navigateur (`lg-theme`, `lg-a11y`, `lg-settings`) : en production, stocker les préférences dans le profil utilisateur.
- Appel entrant simulé sur le tableau de bord (propriété `ringing` de la barre supérieure).
- Avertissement de session forcé (propriété `expiring` de la barre supérieure).
- Affichage en clair des secrets : en production, réauthentification, affichage ponctuel, aucune valeur côté navigateur.
- Lecture des enregistrements, QR code et codes de secours, lien « Ouvrir le lien (démo) ».
- Données, montants, dates, numéros SIRET et SIREN (générés ; celui de Matériaux Delta est invalide), ancienne adresse `media.legarec.fr/kit/` (remplacée par `media.legarec.fr/marque/`), instance `legarec.on3cx.fr`.
- Chargement simulé : délai de 600 à 700 ms au premier affichage, et 600 ms pour l'envoi des confirmations.
- Refus de carte simulé : sans objet (plus de paiement par carte).
- Navigation par G suivi d'une lettre : elle simule un clic sur les liens. Utiliser le routeur de l'application.
- Boutons marqués `data-hors-perimetre` : ils sont hors du périmètre de cette maquette.

## Hors périmètre de la maquette (à concevoir ensuite)
- Rapprochement des encaissements.
- Validation du lot de reversements.
- Création de débiteur, de créancier, et import de factures côté cabinet.
- Avoir.
- Assistant de procédure contentieuse.
- Accord du créancier sur un échéancier dans l'espace créancier (à proposer dans le plan, lot H).

## Contenus à fournir
- SIREN et numéro de TVA de Legarec.
- IBAN du compte dédié.
- Numéro STOP pour les SMS.
- Durées de conservation RGPD (marquées « [DURÉE À VALIDER] »).
- ~~Fichiers définitifs du kit média~~ : fournis (8 logos officiels, `media.legarec.fr/marque/`).
