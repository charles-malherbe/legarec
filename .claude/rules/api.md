---
paths:
  - "apps/api/**"
  - "packages/db/**"
  - "prisma/**"
---

# Règles API (api.legarec.fr)

- NestJS, TypeScript strict, validation de toutes les entrées, réponses d'erreur uniformes, documentation OpenAPI.
- **Cloisonnement** : toute requête concernant des dossiers, factures, documents ou paiements est filtrée par le créancier du compte connecté (rôle créancier) ou par les droits du rôle (équipe). Test automatique obligatoire pour chaque route : un créancier ne peut jamais lire les données d'un autre.
- Modules, routes, tables et colonnes en anglais (glossaire de `CLAUDE.md`) : `auth`, `creditors`, `debtors`, `cases`, `reminders`, `payment-plans`, `litigation`, `documents`, `emails`, `sms`, `calls`, `payments`, `remittances`, `ai`, `audit`, `settings`, `mailboxes`.
- Rôles : Gestionnaire de créances, Responsable du recouvrement (unique), Directeur (unique), Développeur (unique), Créancier. Accès aux dossiers selon le rôle (Directeur : lecture de tous, actions sur les siens ; Responsable : ses dossiers, ceux des gestionnaires et les dossiers sans gestionnaire ; Gestionnaire : les siens ; Développeur : aucun). Délégations technique (Développeur) et administrative (Responsable). Paramètres techniques : Développeur et Directeur.
- Test automatique par route : chaque rôle n'accède qu'aux dossiers prévus, le Directeur ne modifie jamais un dossier qui ne lui est pas attribué, le Développeur ne lit aucun dossier.
- Audit : journaliser qui, quoi, quand, pour le compte de qui, depuis quelle IP pour les actions sensibles (validation d'échéancier, export, modification de coordonnées, secrets, envois LRAR, procédures, boîtes OVH, délégations) et les consultations par le Directeur de dossiers qui ne lui sont pas attribués.
- Prisma : migrations versionnées, pas de requête SQL brute sans justification.
- Tâches longues ou planifiées dans BullMQ sur Valkey (relances, envois groupés, synchronisation IMAP, reversements), jamais dans la requête HTTP.
- **MySendingBox** : compte test par défaut ; production seulement si `MYSENDINGBOX_ENV=production` est explicitement défini. Ne jamais envoyer de vrai courrier depuis un test.
- Documents : modèles HTML Handlebars, PDF via Playwright. Contrôles à l'import d'un modèle : champ inconnu, bloc imposé absent, script ou ressource externe → refus (liste des champs : `maquette/champs-de-fusion.json`).
- E-mails : kit `kits/emails-handlebars` copié sans réécriture dans `apps/api/templates/emails/`, plus `staff-message` ; `config` jamais en dur ; `case.access_code` transmis aux seules relances reminder-1 à reminder-3, jamais dans l'objet, une URL, un nom de fichier ni un journal ; ces relances exigent un SIREN (jamais pour un particulier) ; replyTo seulement pour reminder-1 à reminder-3. Messages des collaborateurs par SMTP OVH de leur boîte (mot de passe chiffré, `MAILBOX_SECRETS_KEY`), copie IMAP dans « Éléments envoyés », quota par boîte ; jamais de bascule vers Resend. recouvrement@ en réception seule.
- Boîtes OVH : API OVHcloud limitée à `/email/domain/legarec.fr/*` ; recouvrement@ protégée ; aucune suppression de boîte depuis l'application ; chaque action confirmée et journalisée.
- Paiement : chèque et virement uniquement, enregistrés à la main ; aucun prestataire de paiement, aucune donnée de carte. Montants en centimes entiers.
- Secrets (Resend, OVH, MySendingBox, Scaleway, 3CX, IA) : en production, saisis dans Paramètres techniques > Secrets (Développeur et Directeur), chiffrés en base, jamais réaffichés ni renvoyés par l'API ; mots de passe des boîtes OVH chiffrés en base. Hors de la base, en variables d'environnement : clé maîtresse du coffre, accès à PostgreSQL et à Valkey, clé de signature des sessions. En développement, `.env` temporaire à la racine, clés de test seulement. Jamais dans le code, les logs, les fixtures ni GitHub Actions.
- Données personnelles : durées de conservation et anonymisation (voir `DECISIONS.md` : dossiers 5 ans après clôture, factures 10 ans, enregistrements 6 mois, journal 1 an).
- IA (`apps/api/src/ai`, couche fournisseur) : sorties structurées validées par Zod, journal de chaque suggestion, contrôle du budget avant appel, minimisation des données, aucune action déclenchée sans validation humaine. Noms de modèles en variables d'environnement.
