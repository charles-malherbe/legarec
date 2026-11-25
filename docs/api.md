# API (apps/api) : architecture, schéma, sécurité

Plan validé par le cabinet le 25/11/2026 (questions 65 à 111 de `DECISIONS.md`). À lire avant de toucher à `apps/api`, `packages/contracts` ou `infra/`. Lots, avancement et points à reprendre du front : `PLAN.md`. En cas d'écart, la décision la plus récente de `DECISIONS.md` l'emporte.

But : remplacer les 161 routes simulées (MSW) des trois portails par `apps/api`, derrière les contrats existants. À la fin, chaque route a sa garde de rôle, sa politique de sécurité par ligne et son test de cloisonnement ; MSW ne sert plus qu'aux tests de composants.

## Architecture

### Dépôt
```
apps/api/prisma/{schema,migrations,seed}        schéma multi-fichiers, SQL complété à la main
apps/api/src/main.ts, worker.ts                 API HTTP et workers BullMQ (même code, deux processus)
apps/api/src/platform/                          config, database, audit, crypto, errors, logging, queue, storage, clock
apps/api/src/modules/<domain>/                  controller, service, policy, repository, presenter, tests
infra/dev/services.mjs                          PostgreSQL et Valkey de développement (utilisateur debian, 127.0.0.1:55432 et 56379)
packages/contracts/{src,openapi.json}           Zod : seule source ; corps de requêtes manquants ajoutés
```
Réutilisé tel quel : `canReadCase`, `canActOnCase`, `hasDelegation`, `allocatePayment`, `splitPlan`, `planApprovals`, `letterAmount`, `billingTotals`, `measureSms`, `checkTemplate`, `checkCoordinate`, `firmIdentity`, `newMember`, `newMailbox` (`packages/contracts/src`), `EmailRenderer`, `EmailsService`, `StaffMessagesService`, `formatPhone` (`apps/api/src/emails`). Les règles écrites dans les simulations (`overCap`, `outsideHours`, `onTarget`, `acting`) deviennent du code d'API avec les mêmes tests.

### Dépendances par lot (versions vérifiées sur npm le 25/11/2026, figées à l'installation)
| Lot | Paquets |
|---|---|
| J | `@nestjs/{common,core,platform-express,testing}` 12.6.0, `@nestjs/swagger` 12.1.2, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `prisma` + `@prisma/client` + `@prisma/adapter-pg` 7.10.1 (la 8 n'est qu'en rc), `pg` 8.23.1, `bullmq` 6.7.9, `ioredis` 6.1.0, `pino` 10.4.0, `pino-http` 11.0.0 ; dev : `openapi-typescript` 7.13.0, `fast-check` 4.11.0, types |
| K | `argon2` 0.45.2, `otplib` 13.6.0, `@simplewebauthn/server` 14.1.0 |
| N | `@aws-sdk/client-s3` et `s3-request-presigner` 3.1177.0, `file-type` 22.3.0, `qrcode` 1.5.4 et `playwright` 1.65.1 (déjà présents) |
| P | `csv-parse` 7.0.3, `read-excel-file` 9.3.20, `write-excel-file` 4.1.1, `fflate` 0.8.3 |
| R | `nodemailer` 10.6.1, `imapflow` 2.12.2, `mailparser` 3.15.0 |

Sans dépendance : Resend, MySendingBox, OVH (appels signés : le paquet `ovh` date de 2019), 3CX, IA compatible OpenAI, ClamAV, limites par IP (Valkey). Construction par Vite, déjà présent.

### Routes, sessions, en-têtes
- `https://api.legarec.fr` : `/staff`, `/partner`, `/debtor`, `/public` (valeurs des pages légales), `/hooks` (Resend : signature vérifiée sur le corps brut ; MySendingBox : aucune signature trouvée dans la partie lue de sa documentation, l'API relit donc la lettre chez lui avant tout changement de statut), `/service` (n8n), `/health`. Les chemins des simulations ne changent pas : `VITE_API_URL` vaut `…/staff`, `…/partner`, et la racine pour paiement. En développement, proxy Vite `/api`.
- Cookies `__Host-` distincts par portail, HttpOnly, Secure, SameSite=Strict ; jeton opaque de 256 bits, haché en base ; fermeture à 30 minutes d'inactivité. En-tête `Origin` contrôlé par préfixe, JSON seulement, `Cache-Control: no-store` partout.
- Action qui engage : `Idempotency-Key` et, si le récapitulatif porte un montant, un nombre ou un destinataire, valeur attendue ; l'API répond 409 si l'état a changé depuis la confirmation.
- Erreurs : mêmes codes que les simulations (`INVALID`, `FORBIDDEN`, `LOCKED`, `SELECTION_CHANGED`…).

### Règles de code
Une requête = une transaction `Database.run(actor, fn)` ; ESLint interdit Prisma ailleurs. Aucun appel externe dans une transaction : `outbox`, puis BullMQ. Les tâches ne portent que des identifiants. SQL brut limité à : `SET LOCAL ROLE`, `set_config`, séquences, verrous consultatifs, recherche trigramme, agrégats.

## Schéma PostgreSQL / Prisma (98 tables)

### Conventions
Clés UUID v7 ; `created_at` partout ; dates `timestamptz` ou `date` ; montants en centimes `integer` (`*_cents`, contrôle de plafond), taux en points de base. **Cloisonnement** : toute table liée à un dossier porte `case_id` et `creditor_id`, avec clé étrangère composite vers `cases(id, creditor_id)` : un `creditor_id` faux est impossible. `[c+cr]` ci-dessous désigne ce couple. Énumérations = celles des contrats, complétées (`NEW`, `LOST`, `CREDIT_NOTE`, `QUEUED`, `UNCERTAIN`).

### Rôles PostgreSQL et sécurité par ligne
`legarec_owner` (migrations), `legarec_app` (connexion, aucun droit propre), puis `SET LOCAL ROLE` vers `legarec_auth`, `legarec_staff`, `legarec_partner`, `legarec_debtor`, `legarec_worker` ou `legarec_retention`, et variables `app.user_id`, `app.role`, `app.creditor_id`, `app.debtor_id`, `app.delegations`. Oubli = « permission denied ». RLS activée **et forcée** sur toutes les tables ; droits par colonne pour `partner` et `debtor`.

| Classe | Lecture | Écriture |
|---|---|---|
| CASE | collaborateur : `app.can_read_case(officer_id)` (Directeur tout ; Responsable : siens, gestionnaires, sans gestionnaire ; gestionnaire : siens ; Développeur : rien) ; créancier : son `creditor_id` ; débiteur : ses dossiers | collaborateur : `app.can_act_on_case` ; créancier et débiteur : insertions limitées. Attribution par `app.assign_cases()` (Directeur ou délégation) |
| CRED | collaborateurs sauf Développeur (gestionnaire : créanciers de ses dossiers) ; créancier : le sien | Directeur, Responsable |
| ADMIN | Directeur, ou Responsable avec délégation administrative | idem |
| TECH | Directeur, Développeur | Directeur, ou Développeur avec délégation technique |
| SELF | titulaire de la ligne | idem |
| FIRM | collaborateurs | Directeur ou délégation ; identité et banque : Directeur seul |
| SYS | workers, authentification | idem |
| AUDIT | Directeur, Développeur | `app.log()` seulement : acteur et « pour le compte de » lus dans la session, jamais passés en paramètre |

### Tables

**Comptes et accès** (`auth`, `account`, `members`, `delegations`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `users` | role, status, first_name, last_name, email, creditor_id?, extension?, password_hash?, password_changed_at?, two_factor_required, theme, density, low_vision, daily_summary, quiet_hours, substitute_id?, absent_from?, absent_until?, auto_reply, daily_call_goal?, last_seen_at?, disabled_at?, disabled_by?, disabled_reason? | UQ email ; **UQ partiel** `role` (Directeur, Responsable, Développeur, non désactivé) ; CHECK creditor_id ⇔ rôle créancier | SELF, ADMIN |
| `user_sessions` | user_id, portal, token_hash, device_id?, device_label, ip, last_seen_at, second_factor_at?, persistent, expires_at, revoked_at? | UQ token_hash | SELF |
| `user_devices` | user_id, token_hash, label, last_seen_at, expires_at | UQ token_hash | SELF |
| `second_factors` | user_id, kind, label, secret_cipher?, credential_id?, public_key?, sign_count?, last_step?, confirmed_at?, last_used_at? | UQ credential_id | SELF |
| `backup_codes` | user_id, code_hash, used_at? | — | SELF |
| `auth_tokens` | purpose (invitation, réinitialisation, vérification, second facteur, WebAuthn), user_id?, contact_id?, token_hash, data, expires_at, used_at? | UQ token_hash ; usage unique | SYS |
| `lockouts` | key_hash (HMAC : compte, débiteur ou identifiant inconnu), scope, failures, locked_until?, blocked_at?, last_failure_at | PK key_hash | SYS |
| `delegations` | kind, granted_by, granted_at, withdrawn_by?, withdrawn_at? | **UQ partiel** kind ouvert | FIRM |
| `notification_preferences` | user_id, kind, in_app, email | PK double | SELF |
| `service_accounts` | name, scopes[], key_hash, created_by, last_used_at?, revoked_at? | UQ key_hash | TECH |
| `support_tickets` | number, user_id, subject, message, status | UQ number | SELF, TECH |

**Cabinet** (`settings`, `vault`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `settings` | key, value (jsonb validé par Zod), updated_by, on_behalf_of_id?, version | PK key | FIRM |
| `setting_versions` | key, previous_cipher, changed_by, on_behalf_of_id?, changed_at | index (key, changed_at) ; ajout seul | Directeur |
| `vault_secrets` | name, kind (SERVICE, INTERNAL), service, environment, value_cipher, key_id, status, rotation, rotated_on, expires_on?, requested_by?, decided_by?, last_used_at? | UQ (name, environment) ; aucune lecture de `value_cipher` par `staff` | TECH |
| `integration_states` | provider, status, last_success_at?, last_error_code? | PK provider | TECH |
| `interest_rates` | kind, valid_from, valid_until?, rate_bp, entered_by | EXCLUDE chevauchement | FIRM |
| `number_sequences` | kind, year, last_value | PK (kind, year) | SYS |
| `scenarios`, `scenario_steps` | code, name, audience, active ; position, offset_days, channel, template_id?, label, enabled, needs_creditor_consent | UQ (scenario_id, position) | FIRM |

**Créanciers** (`creditors`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `creditors` | name, legal_name, siren, vat_number, sector, initials, adresse, status, manager_id?, portal_enabled | UQ siren | CRED |
| `creditor_contacts` | creditor_id, name, title, email, phone, is_main | UQ partiel principal | CRED |
| `creditor_bank_accounts` | creditor_id, holder, iban_cipher, iban_last4, bic, valid_from, valid_until? | — | ADMIN |
| `mandates` | creditor_id, contract_document_id?, starts_on, ends_on?, status, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, contract_rate_bp?, fixed_indemnity, reporting_day, scenario_id? | EXCLUDE chevauchement actif | CRED |
| `creditor_threads`, `creditor_messages` | creditor_id, case_id?, subject, reference_label, last_message_at ; author_side, author_id, text, read_at? | index (creditor_id, last_message_at) | CRED |

**Débiteurs** (`debtors`, `debtor-access`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `debtors` | kind (COMPANY, SOLE_TRADER, INDIVIDUAL), legal_form_code?, legal_form_source?, legal_form_checked_at?, name, siren?, anonymized_at? | UQ partiel siren ; particulier sans SIREN | par ses dossiers |
| `debtor_access_codes` | debtor_id, code_cipher, key_id, generated_by?, generated_at | UQ debtor_id ; aucun droit `partner` | CASE (agir) |
| `debtor_retired_codes` | debtor_id, code_hmac, retired_at | index debtor_id | SYS |
| `debtor_sessions`, `debtor_devices` | debtor_id, token_hash, label, ip, last_seen_at, expires_at, revoked_at? | UQ token_hash | débiteur |
| `debtor_links` | debtor_id, [c+cr], token_hash, channel, expires_at, revoked_at?, uses | UQ token_hash (60 bits) | SYS |
| `phone_opt_outs` | phone_e164, stopped_at, exchange_id?, lifted_at?, lifted_by? | PK phone | CASE |
| `case_contacts` | [c+cr], kind, label, value, value_normalized, status, is_primary, note, source, replaced_by_id?, created_by, invalidated_at? | UQ partiel principal par type ; UQ partiel valeur valide ; index value_normalized | CASE |
| `case_contact_events` | [c+cr], contact_id, actor_id?, actor_label, what | ajout seul | CASE |
| `contact_attempts` | debtor_id, [c+cr], channel, origin, counted, exempt_reason?, overridden_by?, override_reason?, reminder_id?, exchange_id?, occurred_at | index partiel (debtor_id, channel, occurred_at) si compté | CASE |

**Dossiers** (`cases`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `cases` | reference, creditor_id, debtor_id, mandate_id, officer_id?, status, external_reference, adresse et interlocuteur du débiteur, scenario_id?, scenario_position, reminders_suspended_until?, suspension_reason?, first_letter_reference?, first_letter_on?, next_action, next_action_on?, risk_label?, risk_reason?, opened_on, closed_on?, close_reason?, purge_after?, anonymized_at?, version | UQ reference, CHECK `^LGR-\d{4}-\d{5}$` ; UQ (id, creditor_id) ; **UQ partiel** un dossier ouvert par créancier et débiteur ; index (officer_id, status), (creditor_id, status), next_action_on | CASE |
| `case_invoices` | [c+cr], number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, interest_paid_cents, indemnity_cents, indemnity_paid_cents, state, document_id?, import_line_id? | UQ (case_id, number) ; CHECK payé ≤ dû | CASE |
| `interest_snapshots` | [c+cr], as_of, amount_cents, detail, reason | index (case_id, as_of) | CASE |
| `promises`, `promise_invoices` | [c+cr], amount_cents, due_on, method, state, call_id?, checked_at? | index (state, due_on) | CASE |
| `disputes`, `dispute_invoices` | [c+cr], reason, source, reminders_suspended, creditor_asked_at?, resolved_at?, resolution? | — | CASE |
| `waivers` | [c+cr], principal_cents, interest_cents, indemnity_cents, reason, status, requested_by, decided_by?, decided_at? | — | CASE |
| `case_events` (historique) | [c+cr], kind, title, detail, tone, actor_id?, actor_label, on_behalf_of_id?, visible_to_creditor, occurred_at | **ajout seul** ; index (case_id, occurred_at) | CASE |
| `conversations` | kind (EMAIL, SMS, DEBTOR_PORTAL), case_id?, creditor_id?, debtor_id?, mailbox_id?, phone_e164?, subject, category, recategorized, unread, archived_at?, last_message_at | sans dossier : Responsable seul | CASE |
| `exchanges` | conversation_id?, case_id?, creditor_id?, debtor_id?, channel, direction, title, text (code retiré), delivery, verified, author_id?, acknowledgment_document_id?, occurred_at | index (case_id, occurred_at desc) | CASE |
| `exchange_attachments` | exchange_id, document_id, [c+cr] | — | CASE |

**Paiements** (`payments`, `payment-plans`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `payments` | [c+cr], debtor_id, method (CHEQUE, TRANSFER), amount_cents, status, received_on, deposited_on?, settled_at?, bounced_at?, bounce_reason?, cheque_number?, bank?, label?, recorded_by, on_behalf_of_id?, version | CHECK champs selon le moyen ; UQ partiel chèque (dossier, numéro, banque) | CASE |
| `payment_allocations` | [c+cr], payment_id, invoice_id?, component (INTEREST, PRINCIPAL, FEES, OVERPAYMENT), amount_cents, reversed_at? | somme = paiement (contrainte différée) | CASE |
| `receipts` | [c+cr], number, payment_id, document_id, issued_at | UQ number, UQ payment_id | CASE |
| `payment_plans` | [c+cr], debtor_id, total_cents, months, method, first_due_on, status, origin, requested_by?, reason, threshold_months, owned_by_director, accepted_at?, accepted_ip?, document_id?, document_sha256? | UQ partiel un plan en cours par dossier | CASE |
| `plan_approvals` | [c+cr], plan_id, step (COLLECTION_MANAGER, CREDITOR, DEBTOR), decision, decided_by?, reason?, on_behalf_of_id?, decided_at? | UQ (plan_id, step) | CASE |
| `installments`, `installment_payments` | [c+cr], plan_id, number, due_on, amount_cents, paid_cents, state ; payment_id, amount_cents | UQ (plan_id, number) ; index (state, due_on) | CASE |

**Relances, courriers, documents** (`reminders`, `documents`, `templates`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `reminders` | [c+cr], debtor_id, type, origin, scenario_step_id?, planned_on, planned_time?, title, status, limit_reason?, exchange_id?, batch_id?, created_by?, done_by?, done_at? | index (status, planned_on) ; tâche `reminder-<id>` | CASE |
| `send_batches` | kind, template_id, filters, expected_count, actual_count, created_by, on_behalf_of_id?, confirmed_at, status | — | ADMIN, Responsable |
| `letters` | exchange_id, [c+cr], number, template_version_id, registered, document_id, provider_id?, provider_env, status, postage_cents?, sent_at?, acknowledged_at?, snapshot | UQ number `LR-AAAA-NNNN` ; jamais relancé si `UNCERTAIN` | CASE |
| `documents` | case_id?, creditor_id?, category, kind, title, original_name, storage_key, size_bytes, sha256, content_type, status, source, author_id?, shared_with_creditor_at?, visible_to_debtor, contains_access_code, redacted_document_id?, scan_status, retention_class, purged_at? | UQ storage_key ; partagé seulement sans code | CASE |
| `uploads` | owner_kind, owner_id?, document_id, expires_at, claimed_at? | index expires_at | SELF |
| `templates`, `template_versions` | name, kind, category, registered, is_reminder, block ; number, source, sha256, status, checks, imported_by, submitted_by?, reviewed_by?, on_behalf_of_id?, review_reason?, published_at? | UQ partiel une version publiée, une en attente | FIRM |

**Messagerie, SMS, téléphonie** (`mailboxes`, `emails`, `sms`, `calls`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `mailboxes` | address, kind, holder_id?, size_mb, used_mb, connection, password_cipher?, key_id?, protected, imap_uidvalidity?, imap_last_uid?, last_synced_at?, last_error? | UQ address ; CHECK recouvrement@ sans `password_cipher` (le sien est dans le coffre, question 93) | TECH |
| `mailbox_redirections`, `mailbox_auto_replies`, `mailbox_requests` | ovh_id, target ; text, until? ; user_id, local, requested_by, status, decided_by? | — | TECH |
| `exchange_emails` | exchange_id, mailbox_id?, message_id, in_reply_to?, imap_uid?, from_address, to_address, template_code?, provider, provider_id?, idempotency_key?, error_code? | UQ (mailbox_id, message_id) | CASE |
| `exchange_sms` | exchange_id, phone_e164, segments, automatic_label?, provider_id?, error_code? | index phone | CASE |
| `exchange_portal` | exchange_id, request_kind?, request_data?, sender_name?, sender_email?, claimed_reference?, read_by_staff_at?, read_by_debtor_at? | — | CASE |
| `email_drafts`, `message_templates` | author_id, to, subject, text, case_id? ; use, name, subject, text | — | SELF, FIRM |
| `calls` | exchange_id, [c+cr], officer_id, direction, phone_e164, tcx_call_id?, started_at, answered_at?, ended_at?, queue?, recording_announced, outcome?, tcx_code?, interlocutor?, notes?, qualified_at? | UQ tcx_call_id | CASE |
| `call_targets` | [c+cr], officer_id, kind, reason, slot_at?, priority, status, reminder_id? | index (officer_id, status) | CASE |
| `call_recordings`, `call_transcripts` | call_id, [c+cr], document_id, expires_on ; segments_cipher, expires_on | index expires_on (6 mois) | CASE |
| `presence_events` | user_id, state, since, until? | index (user_id, since) | Directeur, Responsable |

**Contentieux, facturation, dépôts, pilotage**
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `litigation_files`, `litigation_acts`, `procedure_costs` | [c+cr], stage, procedure, court, partner_id?, consent_status, consent_document_id?, next_deadline? ; title, occurred_on?, state, document_id? ; label, amount_cents, billed_document_id? | UQ case_id | CASE |
| `litigation_partners` | name, kind, email, phone, active | — | CRED |
| `prospects`, `billing_documents`, `billing_lines` | type (INVOICE, QUOTE, CONTRACT, CREDIT_NOTE), number?, client_creditor_id?, prospect_id?, status, issued_on?, due_on?, net_cents, vat_rate_bp, vat_cents, gross_cents, operation_category, vat_on_debits, terms, document_id?, corrected_id?, issued_by?, on_behalf_of_id?, snapshot ; label, quantity, unit_price_cents | UQ number ; **immuable une fois émis** (déclencheur) | ADMIN |
| `remittance_batches`, `remittances`, `remittance_lines` | period, status, validated_by?, on_behalf_of_id?, paid_on? ; creditor_id, collected_cents, fee_cents, vat_cents, net_cents, invoice_id?, statement_document_id? ; [c+cr], payment_id, kind (COLLECTION, REVERSAL, CARRY_OVER, COST) | UQ payment_id par type ; UQ (batch, creditor) | ADMIN ; créancier : les siens |
| `claim_imports`, `claim_import_lines` | creditor_id, uploaded_by, document_id, status, lines, valid, total_cents, confirmed_at?, expires_at ; line, data, error_message?, case_id? | rien de créé avant confirmation | CRED |
| `notifications`, `task_marks`, `scheduled_reports` | user_id, kind, text, meta, href, cta, case_id?, read_at? ; user_id, key, done_at ; code, active | index (user_id, read_at) | SELF, FIRM |

**Plateforme, RGPD, IA**
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `audit_log` | occurred_at, actor_kind, actor_id?, actor_label, on_behalf_of_id?, action, entity_type?, entity_id?, summary (sans nom, référence ni valeur), ip, request_id | **ajout seul** : ni UPDATE, ni DELETE, ni TRUNCATE ; purge à 1 an par `app.purge_audit()` | AUDIT |
| `outbox`, `webhook_events`, `idempotency_keys` | queue, payload (identifiants), dedupe_key, published_at? ; provider, provider_event_id, status ; actor, key, route, result | UQ dedupe_key, (provider, event), (actor, key) | SYS |
| `gdpr_requests`, `retention_runs` | debtor_id, [c+cr], kind, origin, received_on, due_on, status, handled_by?, transmitted_to_creditor_at? ; started_at, counts | index (status, due_on) | ADMIN |
| `ai_suggestions`, `ai_usage` | function, [c+cr], input_digest, output, model, prompt_version, tokens, cost, status, decided_by?, decided_at? ; month, cost, alerted_at?, paused_at? | — | CASE, TECH |

### Points posés en SQL dans les migrations
```sql
CREATE UNIQUE INDEX users_single_role ON users (role)
  WHERE role IN ('DIRECTOR','COLLECTION_MANAGER','DEVELOPER') AND status <> 'DISABLED';
-- LGR-AAAA-NNNNN : compteur annuel, verrouillé dans la transaction qui crée le dossier
INSERT INTO number_sequences (kind, year, last_value) VALUES ('CASE', $1, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = number_sequences.last_value + 1 RETURNING last_value;
CREATE POLICY cases_read    ON cases FOR SELECT TO legarec_staff   USING (app.can_read_case(officer_id));
CREATE POLICY cases_act     ON cases FOR UPDATE TO legarec_staff   USING (app.can_act_on_case(officer_id));
CREATE POLICY cases_partner ON cases FOR SELECT TO legarec_partner USING (creditor_id = app.creditor_id());
CREATE POLICY cases_debtor  ON cases FOR SELECT TO legarec_debtor  USING (debtor_id  = app.debtor_id());
```
Extensions : `citext`, `pg_trgm`, `unaccent`, `btree_gist`. Index partiels, EXCLUDE, RLS et déclencheurs sont en SQL (les index partiels de Prisma 7 sont en préversion) ; un test refuse toute dérive entre schéma et base. Factures, avoirs et quittances : numérotation continue dans la même transaction.

**Imputation** : intérêts de tout le dossier, puis principal de la facture la plus ancienne à la plus récente, puis indemnités ; reste en trop-perçu. Chèque impayé : écritures d'annulation, jamais d'effacement.

## Chiffrement et hachage

| Donnée | Méthode |
|---|---|
| Code d'accès | AES-256-GCM, lié au débiteur, `ACCESS_CODE_KEY` (clé interne) ; jamais dans une file, un journal, une URL, un texte stocké |
| Mots de passe OVH | AES-256-GCM, lié à la boîte, `MAILBOX_SECRETS_KEY` (clé interne) |
| Clés des services, clés internes, TOTP, IBAN des créanciers, transcriptions | AES-256-GCM, `VAULT_MASTER_KEY` (fichier du serveur) |
| Mots de passe des comptes, codes de secours | Argon2id |
| Jetons (session, lien, invitation : 256 bits ; lien de SMS : 60 bits), identifiants inconnus, anciens codes | HMAC-SHA-256, `SESSION_SIGNING_KEY` (fichier du serveur) : une copie de la base seule ne permet pas de les retrouver |

Trousseau versionné (`key_id`) pour renouveler une clé sans coupure.

## Conservation (tâche quotidienne, rôle `legarec_retention`)

| Durée | Données |
|---|---|
| 5 ans après clôture | dossiers, historique, échanges, pièces : anonymisés, fichiers S3 supprimés |
| 10 ans | factures du cabinet, quittances, paiements, reversements |
| 6 mois | enregistrements, transcriptions, SMS non rattachés, messages non vérifiés, présence 3CX |
| 1 an | journal d'audit, verrouillages, journal de l'IA |
| 30 jours | imports non confirmés, fichiers non rattachés |

## Clés et secrets : noms, emplacement, saisie

**Les valeurs sont saisies par le cabinet seul, hors de Claude Code**, qui n'écrit que des noms : il ne lit, n'affiche et ne copie aucune valeur.

| Quoi | Développement | Production | Qui saisit |
|---|---|---|---|
| Clés des services (Resend, OVH…) | `.env` à la racine de la copie de travail utilisée par Claude Code, clés de test seulement | Paramètres techniques > Secrets, chiffrées en base | Dev : le cabinet, en SSH. Prod : Directeur ou Développeur (délégation technique), dans l'écran |
| Valeurs de démarrage | Tirées au hasard au premier lancement de `infra/dev/services.mjs`, dans `infra/dev/.local/` (hors Git) : rien à saisir | `/etc/legarec/api.env`, lu par l'API et le worker seulement, monté comme fichier (pas de variable visible par `docker inspect`) | Prod : le cabinet, en SSH |
| Clés internes | Générées par l'API | Générées par l'API, rangées dans le coffre | Personne |
| Migrations | Rien à saisir | `/etc/legarec/migration.env`, lu seulement pendant une migration | Prod : le cabinet, en SSH |
| Autres conteneurs | Aucun | Un fichier par conteneur dans `/etc/legarec/` (lot X) | Prod : le cabinet, en SSH |
| SIREN, IBAN, adresse… | Paramètres du cabinet (remplacent `FIRM_*` et `BANK_*`) | Paramètres du cabinet | Directeur |
| Pages (`VITE_API_URL`, `VITE_LOGO_NEGATIVE_URL`, `VITE_API`) | Publiques : jamais un secret | idem | — |
| GitHub Actions | Aucun secret | Aucun secret | — |

**Pourquoi un fichier du serveur (nécessité technique)** : le coffre est dans la base ; il ne peut contenir ni sa propre clé, ni l'accès à la base, et l'API a besoin de ces valeurs avant de pouvoir le lire.

- **Valeurs de démarrage** : `VAULT_MASTER_KEY`, `DATABASE_URL`, `VALKEY_URL`, `SESSION_SIGNING_KEY` ; pour les migrations seulement : `MIGRATION_DATABASE_URL`. Réglages non secrets du même fichier : `MYSENDINGBOX_ENV`, `IA_MODELE_RAPIDE`, `IA_MODELE_AVANCE`, `AI_BASE_URL`, `SCW_REGION`, `SCW_DOCUMENTS_BUCKET`, `STAFF_PORTAL_URL`, `PARTNER_PORTAL_URL`, `DEBTOR_PORTAL_URL`. Pendant un renouvellement, l'ancienne clé reste sous le même nom suivi de `_PREVIOUS`.
- **Clés internes** : `MAILBOX_SECRETS_KEY`, `ACCESS_CODE_KEY` : tirées au hasard par l'API, chiffrées par `VAULT_MASTER_KEY`, renouvelables depuis l'écran (les données sont rechiffrées), jamais révocables.
- **Autres conteneurs (lot X)** : PostgreSQL `POSTGRES_PASSWORD` ; pgBackRest `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS` ; n8n `N8N_ENCRYPTION_KEY` et sa clé de compte de service (créée dans l'application, affichée une fois) ; Grafana `GF_SECURITY_ADMIN_PASSWORD` ; Gatus `GATUS_ALERT_KEY`.

| Service (lot) | Noms des clés | Où la créer, avec quels droits | En développement |
|---|---|---|---|
| Resend (Q) | `RESEND_API_KEY`, `RESEND_ACCOUNT_API_KEY` (second domaine, 84), `RESEND_WEBHOOK_SECRET` | Resend > API Keys : accès « envoi » limité à un domaine ; Webhooks | Clé limitée à un domaine de test ; destinataires `@resend.dev` (comptés dans le quota) |
| MySendingBox (Q) | `MYSENDINGBOX_API_KEY` (`live_`), `MYSENDINGBOX_TEST_API_KEY` (`test_`) | Compte MySendingBox | Clé `test_` seulement : aucun courrier ne part |
| Scaleway (N) | `SCW_ACCESS_KEY`, `SCW_SECRET_KEY` | Clé limitée au bucket `legarec-documents` | Facultatif (bucket de test) ; sinon disque local |
| OVH, boîtes (R) | `OVH_API_APP_KEY`, `OVH_API_APP_SECRET`, `OVH_API_CONSUMER_KEY` | eu.api.ovh.com/createToken, règles `/email/domain/legarec.fr/*` seulement | **Aucune** : pas de mode test trouvé, elle agirait sur les vraies boîtes |
| OVH, SMS (R) | `OVH_SMS_APP_KEY`, `OVH_SMS_APP_SECRET`, `OVH_SMS_CONSUMER_KEY`, `OVH_SMS_SERVICE_NAME` | idem, règles `/sms/<compte>/*` seulement | **Aucune** ; facultatif : compte SMS séparé et un numéro du cabinet |
| recouvrement@ (R) | `COLLECTION_MAILBOX_PASSWORD` | Mot de passe de la boîte, posé chez OVH | **Aucune** : serveur IMAP simulé |
| 3CX (T) | `TCX_API_CLIENT_ID`, `TCX_API_CLIENT_SECRET` | Console 3CX > Integrations > API | **Aucune** : standard simulé |
| IA (W) | `AI_API_KEY`, seulement si un hébergeur est retenu (106) | — | Aucune : modèle local |

Deux clés suffisent donc en développement : Resend (test) et MySendingBox (`test_`). Sans elles, tout marche en simulé.

**Emplacement du `.env` de développement** : la racine de la copie de travail utilisée par Claude Code. Les refus `Read(./.env)` et `Edit(./.env)` de `.claude/settings.json` portent sur le dossier courant : placé à la racine du dépôt principal, il serait dans un dossier parent de la copie de travail, donc sans protection pour la session qui y tourne. Ignoré par Git, il disparaît avec la copie de travail ; si une autre copie prend la suite, le cabinet le déplace. Modèle à copier : `apps/api/env.example` (noms seulement, tenu à jour à chaque lot), car `.env.exemple` est interdit à Claude Code en lecture comme en écriture. Le refus ne couvre pas une recherche récursive : Claude Code n'utilise que `git grep`, qui ne voit que les fichiers suivis.

**Garde-fous en développement** : `.env` chargé par le seul lancement de l'API, jamais par les tests, `pnpm verifier`, `pnpm e2e` ni GitHub Actions ; clé `live_` refusée au démarrage ; destinataire refusé avant l'appel s'il n'est ni `@resend.dev` ni dans `DEV_RECIPIENTS` (adresses et numéros du cabinet) ; le journal dit seulement « Resend : configuré » ou « simulé ».

**En production** : valeur reçue une fois, chiffrée, jamais renvoyée par aucune route ; absente des journaux, de l'audit, de Valkey, des clés d'idempotence et des messages d'erreur ; `Confirm`, puis une ligne d'audit avec le nom seul. L'API refuse de démarrer sans valeur de démarrage ; une clé de service absente met sa file en pause, rien n'est perdu. Ordre de mise en service : fichier du serveur, migrations, premier Directeur par commande (lien affiché une fois dans le terminal, aucun e-mail n'étant encore possible), clé Resend, autres clés, invitations. Le cabinet garde une copie de `/etc/legarec/api.env` dans son gestionnaire de mots de passe, **jamais avec les sauvegardes de la base** : perdue, tout ce qui est chiffré est illisible ; rangée avec elles, le chiffrement ne protège plus rien.

## Tests

- **Matrice d'accès** (le cœur) : un tableau déclaratif route × acteur (anonyme, Développeur, Directeur, Responsable avec et sans délégation, gestionnaires A et B, créanciers A et B, débiteurs A et B, compte de service) × ressource (sienne, d'un autre, sans gestionnaire, du Directeur) → statut attendu. Un méta-test lit les routes de NestJS : **une route absente du tableau fait échouer `pnpm verifier`**.
- **Fuites** : chaque créancier du jeu de test porte une marque unique ; aucune réponse ne doit contenir celle d'un autre. Champ `creditor_id` falsifié dans un corps ou une URL : sans effet.
- **RLS en SQL**, sans l'API : toute table a une politique forcée ; sans acteur, zéro ligne ; `partner` et `debtor` n'ont aucun droit sur codes, coordonnées, appels, IA ; `staff` ne lit jamais une valeur du coffre.
- **Rôles** : Directeur en lecture seule hors de ses dossiers et consultation notée ; Développeur : aucun dossier ; second titulaire d'un rôle unique refusé, y compris en concurrence ; délégation retirée = refus immédiat ; double nom dans l'historique.
- **Accès débiteur** : SIREN ou référence ; référence refusée pour une entreprise ; réponses, statuts, en-têtes et durées identiques pour inconnu et mauvais code ; 5 échecs = 15 minutes, 10 = blocage, régénération = déblocage et anciennes sessions fermées ; 20 échecs par heure et par IP (bloc /64 en IPv6) ; 3 SMS par heure ; notification au gestionnaire ; lien inconnu = 404 uniforme.
- **Confirmations** : double clic = un seul effet ; état changé = 409 ; envoi groupé refusé si le nombre diffère ; LRAR incertain jamais relancé.
- **Plafonds** : 20 envois simultanés au même débiteur par deux créanciers = le plafond, pas un de plus ; dérogation : motif obligatoire, bon rôle ; dimanches, fériés, changement d'heure.
- **Audit** : chaque action sensible = une ligne (qui, pour le compte de qui, IP) ; UPDATE, DELETE et TRUNCATE impossibles ; ni secret, ni code, ni nom, ni référence.
- **Argent** (avec `fast-check`) : somme des imputations = paiement ; intérêts d'abord ; jamais de 40 € ni d'intérêts avant mise en demeure pour un particulier ; chèque impayé rétablit exactement le dû ; numérotation sans trou en concurrence.
- **Fuites techniques** : contenu de Valkey, journaux, URL et noms de fichiers scannés pendant toute la suite (code, e-mail, téléphone, IBAN, mot de passe) ; code retiré des messages entrants, même espacé ou cité.
- **Secrets** : aucune route ne renvoie une valeur du coffre, ni dans une erreur de validation ; valeur absente des journaux, de l'audit, de Valkey et des clés d'idempotence ; nom inconnu refusé ; clé interne jamais révocable ; renouvellement rechiffre tout ; `.env` jamais chargé par les tests ; clé `live_` et destinataire hors liste refusés en développement.
- **Documents** : type réel, EICAR bloqué, PDF sans JavaScript ni réseau, texte vérifié, copie du créancier sans code.
- Puis : webhooks signés et rejoués, contrats OpenAPI régénérés sans différence, migrations depuis zéro, Playwright et axe contre l'API, cas IA en mode simulé. `relecteur-securite` et `testeur` sur chaque lot.

## Sources vérifiées le 25/11/2026
[NestJS 12](https://docs.nestjs.com/migration-guide) · [tickets nestjs-zod](https://github.com/BenLorantfy/nestjs-zod/issues) · [Prisma 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) · [index partiels](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes) · [BullMQ](https://docs.bullmq.io/changelog) · [calendrier Node](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) · [PostgreSQL](https://www.postgresql.org/support/versioning/) · [expéditeurs SMS OVH](https://docs.ovhcloud.com/fr/guides/web-cloud/messaging/sms/sms-senders) · [API SMS OVH](https://docs.ovhcloud.com/fr/guides/web-cloud/messaging/sms/api-sms-cookbook) · [API e-mail OVH](https://eu.api.ovh.com/1.0/email/domain.json) · [3CX Call Control](https://www.3cx.com/docs/call-control-api/) (page de mai 2025, citée par un résultat de recherche) · [suivi Resend](https://resend.com/docs/dashboard/domains/tracking) · [facture électronique](https://entreprendre.service-public.gouv.fr/actualites/A15683) · [API Recherche d'entreprises](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises) · [clés Resend](https://resend.com/docs/dashboard/api-keys/introduction) · [adresses de test Resend](https://resend.com/docs/dashboard/emails/send-test-emails) · [signature des webhooks Resend](https://resend.com/docs/webhooks/verify-webhooks-requests) · [MySendingBox](https://docs.mysendingbox.fr/) (lue en partie) · [clés API OVHcloud](https://docs.ovhcloud.com/en/guides/manage-and-operate/api/first-steps) · [API 3CX](https://www.3cx.com/community/threads/setup-of-call-control-api.131572/post-632334) (message d'un forum) · [fichiers secrets de Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets/) · [refus de lecture de Claude Code](https://code.claude.com/docs/en/permissions)
