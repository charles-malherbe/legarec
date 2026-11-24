# apps/api — api.legarec.fr (NestJS)

- Règles : `.claude/rules/api.md` (chargées automatiquement), `docs/stack.md`, `docs/ia.md` pour le module `src/ai`.
- Un module NestJS par domaine, nommé en anglais (glossaire de `CLAUDE.md`) : `auth`, `creditors`, `debtors`, `cases`, `reminders`, `payment-plans`, `litigation`, `documents` (modèles Handlebars, PDF), `emails` (Resend, SMTP/IMAP OVH, modèles du kit), `mailboxes` (API OVHcloud), `sms`, `calls` (3CX), `payments`, `remittances`, `ai`, `audit`, `settings`.
- Chaque route : garde d'authentification, contrôle du rôle et des délégations, filtre par créancier et par droits du rôle sur les dossiers, validation Zod (`packages/contracts`), entrée dans l'audit si sensible, test de cloisonnement.
- Modèles d'e-mails : `templates/emails/` (copie de `kits/emails-handlebars` et `kits/emails-ajout-staff-message`, sans réécriture).
- Tâches longues : BullMQ sur Valkey (`src/jobs`). Jamais d'appel à un service externe dans une requête HTTP qui pourrait attendre plus de 2 s.
- Données de démonstration (seed Prisma) : reprendre les débiteurs, créanciers et montants de `maquette/donnees-demo/` (montants en centimes).
