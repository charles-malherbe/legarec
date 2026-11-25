# Propositions pour les quatre écrans absents de la maquette

Question 69 de `DECISIONS.md`, lots L et S de `PLAN.md` (mission API). Espace collaborateurs seulement. Aucun code d'application : des pages statiques, montrées au cabinet et **validées le 25/11/2026**, avec ses réponses (voir « Points tranchés »).

| Écran | Page | Captures | Lot | Validation |
|---|---|---|---|---|
| 1. Créancier et mandat | [creancier-et-mandat.html](creancier-et-mandat.html) | [1440](captures/creancier-et-mandat-1440.png) · [1024](captures/creancier-et-mandat-1024.png) · [390](captures/creancier-et-mandat-390.png) · [états](captures/creancier-et-mandat-etats-1440.png) | L | validé le 25/11/2026 |
| 2. Débiteur et factures | [debiteur-et-factures.html](debiteur-et-factures.html) | [1440](captures/debiteur-et-factures-1440.png) · [1024](captures/debiteur-et-factures-1024.png) · [390](captures/debiteur-et-factures-390.png) · [états](captures/debiteur-et-factures-etats-1440.png) | L | validé le 25/11/2026 |
| 3. Validation des reversements | [validation-des-reversements.html](validation-des-reversements.html) | [1440](captures/validation-des-reversements-1440.png) · [1024](captures/validation-des-reversements-1024.png) · [390](captures/validation-des-reversements-390.png) · [états](captures/validation-des-reversements-etats-1440.png) | S | validé le 25/11/2026 |
| 4. Avoir | [avoir.html](avoir.html) | [1440](captures/avoir-1440.png) · [1024](captures/avoir-1024.png) · [390](captures/avoir-390.png) · [états](captures/avoir-etats-1440.png) | S | validé le 25/11/2026 |
| 5. Réauthentification (question 122) | [reauthentification.html](reauthentification.html) | [1440](captures/reauthentification-1440.png) · [1024](captures/reauthentification-1024.png) · [390](captures/reauthentification-390.png) | L | validé le 25/11/2026 |

Chaque page montre l'écran, puis une planche « Accès, états et confirmations ». Elle s'ouvre depuis une copie du dépôt : `propositions.css` importe `packages/tokens`, aucune couleur ni taille n'est en dur, aucun script ni ressource externe. Vérifié le 25/11/2026 à 390, 768, 1024 et 1440 px, en modes clair, sombre et malvoyant : aucun défilement horizontal de la page, aucune erreur axe.

## Règles communes

- Captures : vue du Responsable du recouvrement, délégation administrative active. Données fictives (IBAN d'exemple de la norme, SIREN inventés) ; valeurs entre crochets laissées telles quelles.
- Action qui engage : `Confirm` avec récapitulatif, `Idempotency-Key` et valeur attendue ; 409 si l'état a changé, rien n'est enregistré. Action réversible : `Toast` avec « Annuler ».
- Action faite par délégation : bandeau ou badge « Pour le compte du Directeur », double nom dans l'historique et dans le journal d'audit.
- États communs : chargement (squelette), vide, erreur avec « Réessayer », accès refusé (écran existant), saisie conservée à l'écran après un échec.
- Barre d'enregistrement collante en bas, comme dans Paramètres (fixe dans les captures). Dates : champs date du navigateur.
- Menu, libellés et ordre inchangés. Ajouts acceptés (V4) : « Reversements » et « Avoir » dans Facturation, onglet « Avoirs », « Modifier » remis sur la fiche créancier. S'y ajoutent le type « Avoir » (dernier choix) et, par V3, un bouton « Envoyer » sur un avoir.

## 1. Créancier et mandat

**Accès.** Directeur et Responsable : création et modification (droit propre, « Gérer les créanciers »). Compte de reversement : Directeur, ou Responsable avec la délégation administrative (table de classe ADMIN). Gestionnaire : lecture de la fiche des créanciers de ses dossiers, sans compte ni reversements. Développeur : refus. Aucune lecture seule du Directeur ici : il agit.

**Points d'entrée.** Créanciers › « + Nouveau créancier » (N) ; barre du haut › Créer › Créancier ; menu « Créancier actif » › « Ajouter ou gérer les créanciers » ; fiche créancier › « Convention de mandat » › « Modifier » (bouton de la maquette, remis : V4). Routes proposées : `/creanciers/nouveau`, `/creanciers/:id/modifier`.

| Champs (\* obligatoire) | Contrôles | Colonnes |
|---|---|---|
| SIREN\*, raison sociale\*, nom affiché\*, secteur, n° de TVA | 9 chiffres et clé (`isValidSiren`), SIREN unique ; TVA préremplie (`vatNumber`), même format que `firmIdentity` | `creditors` |
| Adresse\*, code postal\*, ville\* ; gestionnaire du compte | 5 chiffres ; collaborateur actif qui traite des dossiers | `creditors.adresse`, `manager_id` |
| Interlocuteurs : nom\*, fonction, e-mail\*, téléphone | Format (`checkCoordinate`), un seul principal, au moins un | `creditor_contacts` |
| Convention signée (PDF) | 10 Mo, type réel, antivirus. Facultative : alerte « Convention signée à déposer » sur la fiche et les nouveaux dossiers (C1) | `mandates.contract_document_id` |
| Date d'effet\*, fin | Fin après début ; jamais deux mandats actifs en même temps | `starts_on`, `ends_on` |
| Honoraires amiable\* et judiciaire\*, frais d'ouverture | 0 à 100 %, deux décimales ; montant positif ou nul ; défaut : Paramètres › Reversements | `amicable_rate_bp`, `litigation_rate_bp`, `opening_fee_cents` |
| Échéancier sans accord, remise autorisée, contentieux sur accord écrit | Mois en liste (3, 6, 12) ; 0 à 100 % | `plan_months_without_consent`, `discount_max_bp`, `litigation_needs_consent` |
| Report des reversements sous 100 € | Décoché par défaut : coché seulement si la convention le prévoit (R3) | à ajouter (écart E10) |
| Intérêts de retard, taux du contrat, indemnité de 40 € | Taux exigé si « Taux prévu au contrat » ; 40 € jamais pour un particulier | `interest_mode`, `contract_rate_bp`, `fixed_indemnity` |
| Scénario de relance, jour du rapport | Jour de 1 à 28 | `scenario_id`, `reporting_day` |
| Titulaire\*, IBAN\*, BIC\*, confirmé par téléphone | `isValidIban`, 8 ou 11 caractères ; IBAN masqué après enregistrement, affiché à la demande et noté ; sans confirmation, aucun reversement (C3) | `creditor_bank_accounts` |
| Accès à l'espace créancier | Les comptes s'invitent depuis Équipe (déjà développé) | `portal_enabled` |

**États.** Création ; modification (mandat actif en lecture, avenant daté, versions) ; convention à déposer (alerte) ; erreurs de saisie ; Responsable sans délégation (compte verrouillé) ; lecture seule du Gestionnaire ; fiche modifiée entre-temps ; chargement, vide, erreur, accès refusé.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Créer le créancier | Créancier et SIREN, dates, honoraires, ouverture, échéancier, convention (déposée ou non), compte masqué, « Pour le compte de » (compte) | SIREN absent de la base |
| Enregistrer l'avenant | Date d'effet, ancien → nouveau taux, dossiers concernés (ouverts à partir de cette date : C2) et inchangés, document | Version du mandat |
| Remplacer le compte (ton danger) | Ancien compte masqué, nouvel IBAN complet, BIC, date, confirmation téléphonique, « Pour le compte de » | Compte en vigueur |

Identité, coordonnées et gestionnaire du compte : réversibles, `Toast` avec « Annuler ».

**Tables.** Lues : `creditors`, `mandates`, `creditor_contacts`, `creditor_bank_accounts` (`iban_last4`), `users`, `scenarios`, `settings`, `cases` (comptage). Écrites : `creditors`, `creditor_contacts`, `mandates`, `creditor_bank_accounts`, `uploads`, `documents`, `audit_log`.

## 2. Débiteur et factures

**Accès** (D1). Directeur et Responsable seulement, pour tout créancier ; Gestionnaire et Développeur : refus. Attribution : Directeur, à lui-même ou à un collaborateur ; Responsable, à lui-même, ou à un autre par délégation administrative (`app.assign_cases()`).

**Points d'entrée.** Débiteurs › « + Nouveau débiteur » (N) ; Tableau de bord › « + Nouveau dossier » (N) ; fiche créancier › « + Ajouter un débiteur » (créancier prérempli) ; barre du haut › Créer › Débiteur. Masqués pour le Gestionnaire. Route proposée : `/debiteurs/nouveau`.

| Champs (\* obligatoire) | Contrôles | Colonnes |
|---|---|---|
| Créancier\*, réf. créancier | Mandat actif exigé ; convention manquante : simple alerte (C1) | `cases.creditor_id`, `mandate_id`, `external_reference` |
| Type\* : entreprise, entrepreneur individuel, particulier | Particulier : sans SIREN, jamais fusionné automatiquement | `debtors.kind` |
| SIRET ou SIREN\* | 14 ou 9 chiffres et clé ; un SIREN connu réutilise le débiteur sans rien dévoiler | `debtors.siren` (voir écart E4) |
| Raison sociale\* ou nom\*, case « Raison sociale confirmée » | Case exigée ; le nom enregistré n'est jamais écrasé | `debtors.name` |
| Forme juridique | Recherche d'entreprises en tâche de fond, corrigeable ; inconnue : pas de score | `legal_form_*` |
| Adresse\*, code postal\*, ville\*, interlocuteur, fonction | 5 chiffres | `cases` |
| Téléphones, e-mails | `checkCoordinate`, doublons, un principal par type ; origine « Transmise par le créancier », non vérifiés | `case_contacts` |
| Factures (1 à 50) : numéro\*, réf., émission\*, échéance\*, montant TTC\*, reste dû\*, PDF | Numéro unique, échéance après émission, reste dû supérieur à 0 et au plus le montant ; facture non échue acceptée et signalée (D2) ; PDF facultatif (D3), antivirus | `case_invoices`, `documents` |
| Gestionnaire, scénario | Gestionnaire actif ; scénario du mandat par défaut | `officer_id`, `scenario_id` |

**États.** Dossier déjà ouvert (un seul par créancier et débiteur : les factures s'y ajoutent) ; lecture seule du Directeur quand ce dossier ne lui est pas attribué, consultation notée ; même débiteur chez un autre créancier ; mandat non actif ; convention à déposer (alerte) ; particulier ; Recherche d'entreprises en cours ou indisponible ; facture non échue ; erreurs de saisie ; chargement, vide, erreur, accès refusé.

| Action qui engage | Récapitulatif du `Confirm` | Valeur attendue |
|---|---|---|
| Ouvrir le dossier | Créancier, débiteur et identifiant, factures, principal, indemnités, gestionnaire, « Pour le compte de » (attribution) | Principal, nombre de factures, aucun dossier ouvert |
| Ajouter les factures au dossier existant | Dossier, factures, principal et indemnités ajoutés | Version du dossier |

Aucun message ne part à l'ouverture : la première relance attend l'envoi du premier courrier (question 83). Le code d'accès est créé s'il manque, jamais affiché ici.

**Tables.** Lues : `creditors`, `mandates`, `debtors`, `cases`, `users`, `scenarios`. Écrites : `debtors`, `debtor_access_codes`, `cases`, `case_contacts`, `case_contact_events`, `case_invoices`, `uploads`, `documents`, `case_events`, `number_sequences`, `outbox`, `audit_log`.

## 3. Validation des reversements

**Accès.** Directeur, ou Responsable avec la délégation administrative (« Facturation et reversements »). Gestionnaire et Développeur : refus. Créancier : ses reversements validés, dans son espace. Aucune lecture seule du Directeur ici : il valide.

**Points d'entrée.** Tableau de bord › Priorités du jour › « Ouvrir » ; Notifications ; fiche créancier › Reversements ; Facturation › « Reversements » (nouveau bouton, V4). Route proposée : `/facturation/reversements` (mêmes droits et même bandeau que Facturation).

**Déroulement.** Préparation automatique la veille (Paramètres › Reversements : fréquence, seuil) → validation → virements saisis à la banque → « Marquer comme versés » → relevé et facture envoyés (e-mail `remittance-invoice` du kit) et visibles dans l'espace créancier.

| Colonne | Contenu |
|---|---|
| Encaissé | Chèques encaissés et virements rapprochés, du 15 du mois précédent au 14 (R2) |
| Honoraires TTC | Commission du mandat et frais d'ouverture, TVA comprise (R1), HT en dessous ; frais refacturés jamais déduits (R4) |
| Reprises | Chèque impayé après reversement, solde négatif du lot précédent (question 96) ; la commission déjà facturée passe par un avoir (R6) |
| À verser | Encaissé − honoraires − reprises ; sous 100 €, reporté seulement si le mandat le prévoit (R3) |
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

**Points d'entrée.** Facturation › « + Créer depuis un modèle » › type « Avoir » (ajouté en dernier) ; bouton « Avoir » sur une facture émise et onglet « Avoirs » après « Contrats » (nouveaux, V4) ; Reversements › « Préparer l'avoir ». Pas de nouvelle route.

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
| Envoyer l'avoir au créancier (V3) | Expéditeur (boîte OVH du collaborateur), destinataire, objet, pièce jointe | Avoir émis |

Numéro `AV-AAAA-NNNN`, série continue et distincte (V1). L'avoir cite la facture (numéro et date), reprend la TVA et devient immuable ; la facture d'origine n'est pas modifiée (`HANDOFF.md` : « une correction passe par un avoir »). Une facture seule s'envoie de la même façon (V3).

**Tables.** Lues : `billing_documents`, `billing_lines`, `creditors`, `remittances`, `settings`. Écrites : `billing_documents` (`CREDIT_NOTE`), `billing_lines`, `number_sequences`, `documents`, `remittance_lines` (suite), `exchanges` et `exchange_emails` (envoi), `outbox`, `audit_log`.

## Points tranchés

Réponses du cabinet dans la discussion, le 25/11/2026, reportées dans `DECISIONS.md` sous la question 69, avec les mêmes codes.

| Code | Question | Réponse du cabinet | Option non retenue |
|---|---|---|---|
| Écrans | Les quatre écrans conviennent-ils ? | Oui, validés tous les quatre | — |
| C1 | Convention signée exigée avant le premier dossier ? | **Non : simple alerte**. Le dossier s'ouvre ; la fiche signale la convention manquante. Choix fait en connaissance de l'article R124-3 CPCE (convention écrite préalable) | Obligatoire (recommandée) |
| C2 | Nouveau taux (avenant) | Dossiers ouverts à partir de la date d'effet ; les dossiers en cours gardent leur taux | Tous les encaissements |
| C3 | IBAN d'un créancier | Confirmation par téléphone obligatoire avant tout reversement ; IBAN complet affiché à la demande (Directeur, Responsable délégué) et noté au journal d'audit | Facultative |
| D1 | Qui ouvre un dossier à la main ? | **Directeur et Responsable seulement** ; le Gestionnaire reçoit ceux qu'on lui attribue | Tous sauf Développeur (recommandée) |
| D2 | Facture non échue | Acceptée et signalée, sans intérêts ni indemnité avant l'échéance | Refusée |
| R1 | Honoraires retenus | TTC ; les deux écrans en HT seront corrigés (E1) | HT |
| R2 | Période du lot | Jusqu'à la veille du reversement | Mois civil précédent |
| R3 | Seuil de 100 € | Report seulement si la convention le prévoit (case du mandat) | Toujours, ou supprimé |
| R4 | Frais refacturés échus (LRAR, procédure) | Jamais déduits du reversement | Si le mandat le prévoit |
| R5 | Virements | Saisis à la banque, puis « Marquer comme versés » | Fichier SEPA |
| R6 | Commission déjà facturée sur un chèque impayé après reversement | Avoir | Ligne négative |
| R7 | Retenir un créancier du lot | Oui, avec motif ; ses encaissements passent dans le lot suivant | Non |
| V1 | Numérotation des avoirs | Série `AV-AAAA-NNNN` | Série des factures |
| V3 | Envoi d'un avoir ou d'une facture seule (aucun modèle dans le kit) | PDF dans l'espace créancier, et message du collaborateur depuis sa boîte OVH, après confirmation | Modèle à fournir |
| V4 | Boutons ajoutés | Oui, les quatre | Autre emplacement |

Options par défaut, acceptées en bloc par le cabinet :

| Code | Point | Option retenue |
|---|---|---|
| C4 | SIREN du créancier | Obligatoire |
| C5 | Interlocuteur principal | Reçoit relevés, factures et demandes d'accord |
| D3 | PDF d'une facture | Facultatif, « facture sans PDF » signalée |
| R8 | Facture de commission | Émise à la validation, envoyée au virement |
| V2 | Avoir sur une facture déjà réglée | Choix entre prochain reversement et virement |
| V5 | Motif | Texte libre, sans liste |

## Écarts relevés, pour la mission API

| N° | Écart |
|---|---|
| E1 | Fiche créancier et portail partenaires retiennent la commission HT (24 902 € − 1 992 €) ; le kit (`remittance-invoice`) et `remittances.vat_cents` retiennent le TTC : à corriger (R1) |
| E2 | `remittance_lines` n'a ni nature pour un avoir restitué ni pour des frais d'ouverture, et dépend d'un paiement |
| E3 | `remittances` n'a pas d'état par créancier (prêt, reporté, retenu avec motif, versé) |
| E4 | `debtors.siren` a 9 chiffres ; les écrans et `debiteur.siret` affichent un SIRET : à garder sur le dossier |
| E5 | `creditor_bank_accounts` n'a pas la confirmation (par qui, quand, avec qui) ; `mandates` ne relie pas un avenant au mandat modifié |
| E6 | `billing_documents` n'a ni motif ni suite de l'avoir ; le contrat `billingType` n'a pas `CREDIT_NOTE` |
| E7 | Le kit n'a pas d'e-mail pour une facture seule ni pour un avoir ; « Émettre la facture » annonce un envoi par Resend : texte à ajuster (V3) |
| E8 | Paramètres › Reversements : tuile « Prochain reversement le 1er décembre », réglage « Mensuelle, le 15 » |
| E9 | Kit : facture `F2026-118` ; application : `FA-2026-0118` (exemple seulement) |
| E10 | `mandates` n'a pas la clause de report sous 100 € (R3) ; le seuil reste dans Paramètres › Reversements |
| E11 | `remittance_lines.kind` prévoit `COST`, inutile puisque les frais ne sont jamais déduits (R4) |
| E12 | Front : « + Nouveau débiteur », « + Nouveau dossier », « + Ajouter un débiteur » et Créer › Débiteur sont visibles du Gestionnaire, à masquer (D1) ; l'API refuse |

## Sources juridiques

À vérifier par le cabinet : Légifrance n'a pas pu être consulté par Claude Code, les articles du CPCE ont été lus en traduction ou en résumé.

- R124-3 CPCE (convention écrite, rémunération, reversement) : [traduction](https://french-business-law.com/rench-legislation-art/article-r124-3-of-the-french-code-of-civil-enforcement-procedures). Elle n'a pas à tenir en un seul acte : Cass. 2e civ., 5 février 2026, n° 23-22.049, d'après la [Gazette du Palais](https://www.labase-lextenso.fr/gazette-du-palais/2026-n11/un-peu-de-souplesse-pour-le-formalisme-en-matiere-de-recouvrement-amiable-GPL488v4).
- R124-6 CPCE (reversement dans le mois de l'encaissement effectif, sauf convention contraire) : [traduction](https://french-business-law.com/french-legislation-art/article-r124-6-of-the-french-code-of-civil-enforcement-procedures), [résumé de l'INC](https://www.inc-conso.fr/content/banque/recouvrement-amiable-de-creances-quels-sont-vos-droits-et-vos-recours).
- Avoir : référence explicite à la facture, [BOI-TVA-DECLA-30-20-20-20, § 180 à 260](https://bofip.impots.gouv.fr/bofip/142-PGP.html) ; numérotation continue et séries distinctes, [BOI-TVA-DECLA-30-20-20-10, § 70 à 100](https://bofip.impots.gouv.fr/bofip/140-PGP.html).
