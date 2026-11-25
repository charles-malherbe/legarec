# Propositions pour les quatre écrans absents de la maquette

Question 69 de `DECISIONS.md`, lots L et S de `PLAN.md` (mission API). Espace collaborateurs seulement. Aucun code d'application : des pages statiques à valider par le cabinet avant développement.

| Écran | Page | Captures | Lot | Validation |
|---|---|---|---|---|
| 1. Créancier et mandat | [creancier-et-mandat.html](creancier-et-mandat.html) | [1440](captures/creancier-et-mandat-1440.png) · [1024](captures/creancier-et-mandat-1024.png) · [390](captures/creancier-et-mandat-390.png) · [états](captures/creancier-et-mandat-etats-1440.png) | L | en attente |
| 2. Débiteur et factures | [debiteur-et-factures.html](debiteur-et-factures.html) | [1440](captures/debiteur-et-factures-1440.png) · [1024](captures/debiteur-et-factures-1024.png) · [390](captures/debiteur-et-factures-390.png) · [états](captures/debiteur-et-factures-etats-1440.png) | L | en attente |
| 3. Validation des reversements | [validation-des-reversements.html](validation-des-reversements.html) | [1440](captures/validation-des-reversements-1440.png) · [1024](captures/validation-des-reversements-1024.png) · [390](captures/validation-des-reversements-390.png) · [états](captures/validation-des-reversements-etats-1440.png) | S | en attente |
| 4. Avoir | [avoir.html](avoir.html) | [1440](captures/avoir-1440.png) · [1024](captures/avoir-1024.png) · [390](captures/avoir-390.png) · [états](captures/avoir-etats-1440.png) | S | en attente |

Chaque page montre l'écran, puis une planche « Accès, états et confirmations ». Elle s'ouvre depuis une copie du dépôt : `propositions.css` importe `packages/tokens`, aucune couleur ni taille n'est en dur, aucun script ni ressource externe. Vérifié le 25/11/2026 à 390, 768, 1024 et 1440 px, en modes clair, sombre et malvoyant : aucun défilement horizontal de la page, aucune erreur axe.

## Règles communes

- Captures : vue du Responsable du recouvrement, délégation administrative active. Données fictives (IBAN d'exemple de la norme, SIREN inventés) ; valeurs entre crochets laissées telles quelles.
- Action qui engage : `Confirm` avec récapitulatif, `Idempotency-Key` et valeur attendue ; 409 si l'état a changé, rien n'est enregistré. Action réversible : `Toast` avec « Annuler ».
- Action faite par délégation : bandeau ou badge « Pour le compte du Directeur », double nom dans l'historique et dans le journal d'audit.
- États communs : chargement (squelette), vide, erreur avec « Réessayer », accès refusé (écran existant), saisie conservée à l'écran après un échec.
- Barre d'enregistrement collante en bas, comme dans Paramètres (fixe dans les captures). Dates : champs date du navigateur.
- Menu, libellés et ordre inchangés. Ajouts signalés dans « Points à trancher ».

## 1. Créancier et mandat

**Accès.** Directeur et Responsable : création et modification (droit propre, « Gérer les créanciers »). Compte de reversement : Directeur, ou Responsable avec la délégation administrative (table de classe ADMIN). Gestionnaire : lecture de la fiche des créanciers de ses dossiers, sans compte ni reversements. Développeur : refus. Aucune lecture seule du Directeur ici : il agit.

**Points d'entrée.** Créanciers › « + Nouveau créancier » (N) ; barre du haut › Créer › Créancier ; menu « Créancier actif » › « Ajouter ou gérer les créanciers » ; fiche créancier › « Convention de mandat » › « Modifier » (dans la maquette, absent de l'application : à remettre). Routes proposées : `/creanciers/nouveau`, `/creanciers/:id/modifier`.

| Champs (\* obligatoire) | Contrôles | Colonnes |
|---|---|---|
| SIREN\*, raison sociale\*, nom affiché\*, secteur, n° de TVA | 9 chiffres et clé (`isValidSiren`), SIREN unique ; TVA préremplie (`vatNumber`), même format que `firmIdentity` | `creditors` |
| Adresse\*, code postal\*, ville\* ; gestionnaire du compte | 5 chiffres ; collaborateur actif qui traite des dossiers | `creditors.adresse`, `manager_id` |
| Interlocuteurs : nom\*, fonction, e-mail\*, téléphone | Format (`checkCoordinate`), un seul principal, au moins un | `creditor_contacts` |
| Convention signée (PDF) | 10 Mo, type réel, antivirus ; voir C1 | `mandates.contract_document_id` |
| Date d'effet\*, fin | Fin après début ; jamais deux mandats actifs en même temps | `starts_on`, `ends_on` |
| Honoraires amiable\* et judiciaire\*, frais d'ouverture | 0 à 100 %, deux décimales ; montant positif ou nul ; défaut : Paramètres › Reversements | `amicable_rate_bp`, `litigation_rate_bp`, `opening_fee_cents` |
| Échéancier sans accord, remise autorisée, contentieux sur accord écrit | Mois en liste (3, 6, 12) ; 0 à 100 % | `plan_months_without_consent`, `discount_max_bp`, `litigation_needs_consent` |
| Intérêts de retard, taux du contrat, indemnité de 40 € | Taux exigé si « Taux prévu au contrat » ; 40 € jamais pour un particulier | `interest_mode`, `contract_rate_bp`, `fixed_indemnity` |
| Scénario de relance, jour du rapport | Jour de 1 à 28 | `scenario_id`, `reporting_day` |
| Titulaire\*, IBAN\*, BIC\*, confirmé par téléphone | `isValidIban`, 8 ou 11 caractères ; IBAN masqué après enregistrement ; voir C3 | `creditor_bank_accounts` |
| Accès à l'espace créancier | Les comptes s'invitent depuis Équipe (déjà développé) | `portal_enabled` |

**États.** Création ; modification (mandat actif en lecture, avenant daté, versions) ; erreurs de saisie ; Responsable sans délégation (compte verrouillé) ; lecture seule du Gestionnaire ; fiche modifiée entre-temps ; chargement, vide, erreur, accès refusé.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Créer le créancier | Créancier et SIREN, dates, honoraires, ouverture, échéancier, compte masqué, « Pour le compte de » (compte) | SIREN absent de la base |
| Enregistrer l'avenant | Date d'effet, ancien → nouveau taux, dossiers concernés et inchangés, document | Version du mandat |
| Remplacer le compte (ton danger) | Ancien compte masqué, nouvel IBAN complet, BIC, date, confirmation téléphonique, « Pour le compte de » | Compte en vigueur |

Identité, coordonnées et gestionnaire du compte : réversibles, `Toast` avec « Annuler ».

**Tables.** Lues : `creditors`, `mandates`, `creditor_contacts`, `creditor_bank_accounts` (`iban_last4`), `users`, `scenarios`, `settings`, `cases` (comptage). Écrites : `creditors`, `creditor_contacts`, `mandates`, `creditor_bank_accounts`, `uploads`, `documents`, `audit_log`.

## 2. Débiteur et factures

**Accès** (D1 à trancher). Directeur et Responsable : tout créancier ; Gestionnaire : les créanciers de ses dossiers ; Développeur : refus. Attribution : `app.assign_cases()`, Directeur ou délégation administrative.

**Points d'entrée.** Débiteurs › « + Nouveau débiteur » (N) ; Tableau de bord › « + Nouveau dossier » (N) ; fiche créancier › « + Ajouter un débiteur » (créancier prérempli) ; barre du haut › Créer › Débiteur. Route proposée : `/debiteurs/nouveau`.

| Champs (\* obligatoire) | Contrôles | Colonnes |
|---|---|---|
| Créancier\*, réf. créancier | Mandat actif exigé ; liste limitée par l'API | `cases.creditor_id`, `mandate_id`, `external_reference` |
| Type\* : entreprise, entrepreneur individuel, particulier | Particulier : sans SIREN, jamais fusionné automatiquement | `debtors.kind` |
| SIRET ou SIREN\* | 14 ou 9 chiffres et clé ; un SIREN connu réutilise le débiteur sans rien dévoiler | `debtors.siren` (voir écart E4) |
| Raison sociale\* ou nom\*, case « Raison sociale confirmée » | Case exigée ; le nom enregistré n'est jamais écrasé | `debtors.name` |
| Forme juridique | Recherche d'entreprises en tâche de fond, corrigeable ; inconnue : pas de score | `legal_form_*` |
| Adresse\*, code postal\*, ville\*, interlocuteur, fonction | 5 chiffres | `cases` |
| Téléphones, e-mails | `checkCoordinate`, doublons, un principal par type ; origine « Transmise par le créancier », non vérifiés | `case_contacts` |
| Factures (1 à 50) : numéro\*, réf., émission\*, échéance\*, montant TTC\*, reste dû\*, PDF | Numéro unique, échéance après émission, reste dû entre 0 et le montant ; antivirus | `case_invoices`, `documents` |
| Gestionnaire, scénario | Gestionnaire actif ; scénario du mandat par défaut | `officer_id`, `scenario_id` |

**États.** Dossier déjà ouvert (un seul par créancier et débiteur : les factures s'y ajoutent) ; lecture seule du Directeur quand ce dossier ne lui est pas attribué, consultation notée ; dossier existant hors de portée d'un Gestionnaire (message neutre) ; même débiteur chez un autre créancier (Directeur et Responsable seulement) ; mandat non actif ; particulier ; Recherche d'entreprises en cours ou indisponible ; facture non échue ; erreurs de saisie ; chargement, vide, erreur, accès refusé.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Ouvrir le dossier | Créancier, débiteur et identifiant, factures, principal, indemnités, gestionnaire, « Pour le compte de » (attribution) | Principal, nombre de factures, aucun dossier ouvert |
| Ajouter les factures au dossier existant | Dossier, factures, principal et indemnités ajoutés | Version du dossier |

Aucun message ne part à l'ouverture : la première relance attend l'envoi du premier courrier (question 83). Le code d'accès est créé s'il manque, jamais affiché ici.

**Tables.** Lues : `creditors`, `mandates`, `debtors`, `cases`, `users`, `scenarios`. Écrites : `debtors`, `debtor_access_codes`, `cases`, `case_contacts`, `case_contact_events`, `case_invoices`, `uploads`, `documents`, `case_events`, `number_sequences`, `outbox`, `audit_log`.

## 3. Validation des reversements

**Accès.** Directeur, ou Responsable avec la délégation administrative (« Facturation et reversements »). Gestionnaire et Développeur : refus. Créancier : ses reversements validés, dans son espace. Aucune lecture seule du Directeur ici : il valide.

**Points d'entrée.** Tableau de bord › Priorités du jour › « Ouvrir » ; Notifications ; fiche créancier › Reversements ; Facturation › « Reversements » (bouton à ajouter, V4). Route proposée : `/facturation/reversements` (mêmes droits et même bandeau que Facturation).

**Déroulement.** Préparation automatique la veille (Paramètres › Reversements : fréquence, seuil) → validation → virements saisis à la banque → « Marquer comme versés » → relevé et facture envoyés (e-mail `remittance-invoice` du kit) et visibles dans l'espace créancier.

| Colonne | Contenu |
|---|---|
| Encaissé | Chèques encaissés et virements rapprochés de la période |
| Honoraires TTC | Commission du mandat et frais d'ouverture, HT en dessous (R1) |
| Reprises | Chèque impayé après reversement, solde négatif du lot précédent (question 96) |
| À verser | Encaissé − honoraires − reprises |
| Contrôle | Prêt, reprise, compte modifié, sous le seuil, compte manquant, retenu |

Aucun montant n'est modifiable à la main. Saisies : motif d'une retenue\*, date des virements\* (au plus aujourd'hui).

**États.** Lot à valider ; lot validé (lecture seule, virements à faire, IBAN affiché à la demande et noté) ; montants changés ; compte manquant ou non confirmé ; solde négatif ; frais refacturés échus ; délégation retirée ; chargement, vide, erreur.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Valider le lot | Période, créanciers, encaissé, honoraires, reprises, à verser, numéros de factures, « Pour le compte de » | Total et nombre de virements |
| Retenir un créancier (motif, ton danger) | Montant, lot suivant, « Pour le compte de » | Montant du créancier |
| Marquer comme versés | Total, référence, destinataires, date | Lot validé, total |

**Tables.** Lues : `payments`, `payment_allocations`, `cases`, `mandates`, `creditors`, `creditor_bank_accounts`, `settings`. Écrites : `remittance_batches`, `remittances`, `remittance_lines`, `billing_documents`, `billing_lines`, `number_sequences`, `documents`, `notifications`, `outbox`, `audit_log`.

## 4. Avoir

**Accès.** Comme toute la Facturation : Directeur, ou Responsable avec la délégation administrative. Gestionnaire et Développeur : refus. Aucune lecture seule du Directeur ici.

**Points d'entrée.** Facturation › « + Créer depuis un modèle » › type « Avoir » (ajouté en dernier) ; bouton « Avoir » sur une facture émise et onglet « Avoirs » après « Contrats » (à ajouter, V4) ; Reversements › « Préparer l'avoir ». Pas de nouvelle route.

| Champs (\* obligatoire) | Contrôles | Colonnes |
|---|---|---|
| Facture à corriger\* | Émise, pas déjà annulée | `billing_documents.corrected_id` |
| Étendue\* : partiel, total | Total : toutes les lignes, non modifiables | — |
| Montants à créditer (HT)\* | Par ligne : au plus ce qui reste facturé ; total supérieur à 0 ; TVA de la facture | `billing_lines`, `net_cents`, `vat_cents`, `gross_cents` |
| Motif\* | Imprimé ; référence du dossier, sans nom de débiteur | voir écart E6 |
| Suite\* | Facture réglée : prochain reversement ou virement ; non réglée : déduit de la facture | voir écart E2 |

**États.** Avoir partiel, avoir total, facture non réglée, brouillon (sans numéro, supprimable), liste « Avoirs » et statuts « Avoir partiel » et « Annulée par avoir », erreurs de saisie, aucune facture à corriger, facture corrigée entre-temps, valeur entre crochets (`FIRM_INCOMPLETE`), chargement, erreur, accès refusé.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Émettre l'avoir | Facture corrigée et date, client, motif, HT, TVA, TTC, suite, « Pour le compte de » | Reste facturé |

L'avoir cite la facture (numéro et date), reprend la TVA et devient immuable ; la facture d'origine n'est pas modifiée (`HANDOFF.md` : « une correction passe par un avoir »).

**Tables.** Lues : `billing_documents`, `billing_lines`, `creditors`, `remittances`, `settings`. Écrites : `billing_documents` (`CREDIT_NOTE`), `billing_lines`, `number_sequences`, `documents`, `remittance_lines` (suite), `outbox`, `audit_log`.

## Points à trancher

Réponses du cabinet notées ici ; `DECISIONS.md` et `QUESTIONS.md` ne sont pas modifiés tant que la PR 19 n'est pas fusionnée.

| Code | Question | Options (recommandation en premier) | Réponse |
|---|---|---|---|
| C1 | Convention signée exigée avant le premier dossier ? | Oui, mandat « À signer » sinon (convention écrite préalable, R124-3 CPCE) · simple alerte | en attente |
| C2 | Nouveau taux : à quoi s'applique-t-il ? | Dossiers ouverts à partir de la date d'effet · tous les encaissements à partir de cette date | en attente |
| C3 | IBAN d'un créancier : confirmation par téléphone exigée, IBAN complet affiché à la demande et noté ? | Oui · confirmation facultative | en attente |
| D1 | Qui ouvre un dossier à la main, et pour qui ? | Tous sauf Développeur ; Gestionnaire : ses créanciers, à lui-même · Directeur et Responsable seulement | en attente |
| R1 | Honoraires retenus | TTC (kit d'e-mails, schéma) · HT (maquette) | en attente |
| R2 | Période du lot | Jusqu'à la veille du reversement (un mois au plus, R124-6 CPCE) · mois civil précédent | en attente |
| R3 | Seuil de 100 € | Reporté seulement si la convention le prévoit · toujours reporté · supprimé | en attente |
| R4 | Frais refacturés échus (LRAR, procédure) | Jamais déduits (le contrat type ne prévoit que la commission) · déduits si le mandat le prévoit | en attente |
| R5 | Virements | Saisis à la banque, IBAN affiché · fichier SEPA à importer à la banque | en attente |
| R6 | Commission déjà facturée sur un chèque impayé après reversement | Avoir · ligne négative sur la facture suivante | en attente |
| V1 | Numérotation des avoirs | Série `AV-AAAA-NNNN` · même série que les factures | en attente |
| V3 | Envoi de l'avoir (aucun modèle dans le kit) | Espace créancier, et message du collaborateur avec le PDF · modèle à fournir par le cabinet | en attente |
| V4 | Boutons ajoutés : « Reversements » (Facturation), « Avoir » (ligne), onglet « Avoirs » ; « Modifier » remis sur la fiche | Oui · autre emplacement | en attente |

Options retenues par défaut, sauf avis contraire :

| Code | Point | Option par défaut |
|---|---|---|
| C4 | SIREN du créancier | Obligatoire |
| C5 | Interlocuteur principal | Reçoit relevés, factures et demandes d'accord |
| D2 | Facture non échue | Acceptée et signalée, sans intérêts ni indemnité avant l'échéance |
| D3 | PDF d'une facture | Facultatif, « facture sans PDF » signalée |
| R7 | Retenir un créancier | Possible avec motif ; passe dans le lot suivant |
| R8 | Facture de commission | Émise à la validation, envoyée au virement |
| V2 | Avoir sur une facture déjà réglée | Choix entre prochain reversement et virement |
| V5 | Motif | Texte libre, sans liste |

## Écarts relevés, pour la mission API

| N° | Écart |
|---|---|
| E1 | Fiche créancier et portail partenaires retiennent la commission HT (24 902 € − 1 992 €) ; le kit (`remittance-invoice`) et `remittances.vat_cents` retiennent le TTC (R1) |
| E2 | `remittance_lines` n'a ni nature pour un avoir restitué ni pour des frais d'ouverture, et dépend d'un paiement |
| E3 | `remittances` n'a pas d'état par créancier (prêt, reporté, retenu avec motif, versé) |
| E4 | `debtors.siren` a 9 chiffres ; les écrans et `debiteur.siret` affichent un SIRET : à garder sur le dossier |
| E5 | `creditor_bank_accounts` n'a pas la confirmation (par qui, quand, avec qui) ; `mandates` ne relie pas un avenant au mandat modifié |
| E6 | `billing_documents` n'a ni motif ni suite de l'avoir ; le contrat `billingType` n'a pas `CREDIT_NOTE` |
| E7 | Le kit n'a pas d'e-mail pour une facture seule ni pour un avoir, alors que « Émettre la facture » annonce un envoi par Resend |
| E8 | Paramètres › Reversements : tuile « Prochain reversement le 1er décembre », réglage « Mensuelle, le 15 » |
| E9 | Kit : facture `F2026-118` ; application : `FA-2026-0118` (exemple seulement) |

## Sources juridiques

À vérifier par le cabinet : Légifrance n'a pas pu être consulté par Claude Code, les articles du CPCE ont été lus en traduction ou en résumé.

- R124-3 CPCE (convention écrite, rémunération, reversement) : [traduction](https://french-business-law.com/rench-legislation-art/article-r124-3-of-the-french-code-of-civil-enforcement-procedures). Elle n'a pas à tenir en un seul acte : Cass. 2e civ., 5 février 2026, n° 23-22.049, d'après la [Gazette du Palais](https://www.labase-lextenso.fr/gazette-du-palais/2026-n11/un-peu-de-souplesse-pour-le-formalisme-en-matiere-de-recouvrement-amiable-GPL488v4).
- R124-6 CPCE (reversement dans le mois de l'encaissement effectif, sauf convention contraire) : [traduction](https://french-business-law.com/french-legislation-art/article-r124-6-of-the-french-code-of-civil-enforcement-procedures), [résumé de l'INC](https://www.inc-conso.fr/content/banque/recouvrement-amiable-de-creances-quels-sont-vos-droits-et-vos-recours).
- Avoir : référence explicite à la facture, [BOI-TVA-DECLA-30-20-20-20, § 180 à 260](https://bofip.impots.gouv.fr/bofip/142-PGP.html) ; numérotation continue et séries distinctes, [BOI-TVA-DECLA-30-20-20-10, § 70 à 100](https://bofip.impots.gouv.fr/bofip/140-PGP.html).
