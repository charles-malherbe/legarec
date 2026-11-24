# Dossier à valider par le juriste et le DPO

Préparé le 24/11/2026 à partir de l'application et du kit d'e-mails. Claude Code a relevé ces points mais ne donne pas d'avis juridique : chaque article cité est à vérifier. Répondre dans la colonne « Réponse », ou par numéro.

Contexte : cabinet de recouvrement amiable (Paris), agissant pour des créanciers professionnels auprès d'entreprises et de particuliers. Paiement par virement ou chèque seulement. Aucun titre exécutoire au stade amiable.

## 1. À regarder en premier : relances par e-mail du kit

Fichiers `kits/emails-handlebars/templates/reminder-1.hbs` à `reminder-3.hbs` et `partials/mentions_recouvrement.hbs`. Ils n'ont pas été modifiés. **Aucun envoi réel n'a lieu aujourd'hui ; ils ne devraient pas partir avant validation.**

| # | Constat | Texte concerné | Réponse |
|---|---|---|---|
| 1.1 | La relance 3 annonce une saisie au stade amiable. | « son exécution forcée sera confiée à un commissaire de justice : saisie sur vos comptes bancaires ou saisie de vos biens, les frais d'exécution étant à la charge du débiteur » | |
| 1.2 | Les relances 2 et 3 annoncent que le cabinet saisit lui-même le tribunal. En a-t-il le mandat et le droit ? | « nous déposerons sans autre avis une requête en injonction de payer » ; « Aucun nouveau délai ne sera accordé » | |
| 1.3 | L'indemnité de 40 € est annoncée dans la relance 1 sans distinguer les particuliers, alors que l'application ne la réclame jamais à un particulier. | « Une indemnité forfaitaire de 40 € […] est due par facture (article L441-10 du Code de commerce) » | |
| 1.4 | Aucune relance ne rappelle la référence et la date du premier courrier, règle posée pour l'application. | Relances 1 à 3 | |
| 1.5 | Le bloc de mentions reproduit l'article L111-8, mais ne donne ni l'adresse du cabinet, ni la mention de l'activité de recouvrement amiable, ni l'information RGPD attendues (article R124-4). | `mentions_recouvrement.hbs` | |
| 1.6 | Le code d'accès serait « communiqué […] à recouvrement@ », donc par e-mail, alors que la règle est : jamais par e-mail. | « Votre code de paiement vous est communiqué sur simple demande au [téléphone] ou à [e-mail] » | |
| 1.7 | Les relances demandent le SIREN pour accéder au dossier ; l'espace débiteur demande le SIRET (entreprise) ou la référence (particulier). | « en vous identifiant avec votre SIREN » | |
| 1.8 | Titres pouvant être lus comme une pression ou une démarche judiciaire engagée. | « DOSSIER EN VOIE DE CONTENTIEUX », « DERNIER AVIS AVANT PROCÉDURE JUDICIAIRE », signature « Le service contentieux » | |
| 1.9 | Frais de procédure annoncés à la charge du débiteur. | « Les frais de procédure pourront alors être mis à votre charge » | |

## 2. Textes à fournir

| # | Texte | Où il apparaît | Réponse |
|---|---|---|---|
| 2.1 | Mentions légales (SIREN, adresse, hébergeur, directeur de la publication) | Trois portails, pied de page | |
| 2.2 | Confidentialité (RGPD) : responsable, finalités, base légale, destinataires, durées, droits, DPO, CNIL | Trois portails, pied de page | |
| 2.3 | Cookies | Trois portails, pied de page | |
| 2.4 | Mentions des courriers et LRAR (R124-4, alinéas de L111-8) | Courriers, bloc imposé | |
| 2.5 | Mentions des factures et devis du cabinet | Facturation | |
| 2.6 | Information RGPD des débiteurs, dès le premier courrier | Courriers et e-mails | |

## 3. RGPD

| # | Question | État actuel | Réponse |
|---|---|---|---|
| 3.1 | Le cabinet est-il sous-traitant de chaque créancier, responsable du traitement, ou les deux ? | [STATUT RGPD À VALIDER] dans les contrats | |
| 3.2 | Durées de conservation : dossiers soldés, irrécouvrables, enregistrements d'appels, journal d'audit | [DURÉE À VALIDER] ; enregistrements annoncés à 6 mois | |
| 3.3 | Le « Score de risque » affiché avec sa raison relève-t-il du profilage (RGPD, AI Act) ? Aucune décision automatique n'en découle. | Conservé | |
| 3.4 | Code d'accès affiché en clair aux collaborateurs, sans trace de consultation | Décision du cabinet | |
| 3.5 | Assistant IA (appels, e-mails, synthèses) : information des débiteurs et des salariés, DPA, hébergement européen | Désactivé en production | |
| 3.6 | Suivi d'activité des gestionnaires et enregistrement des appels : information des salariés, consultation | Mention L1222-4 affichée dans Équipe | |

## 4. Règles de recouvrement appliquées par l'application

| # | Règle | Réponse |
|---|---|---|
| 4.1 | Plafonds par débiteur : 2 appels, 2 e-mails et 1 SMS par semaine, 2 courriers par mois | |
| 4.2 | Plages : appels du lundi au vendredi 9 h – 19 h, samedi 9 h – 12 h ; e-mails et SMS du lundi au samedi 9 h – 19 h | |
| 4.3 | Mention SMS « STOP : répondez STOP » (à confirmer aussi avec OVHcloud) | |
| 4.4 | Message vocal sans mention du montant ni de la dette | |
| 4.5 | Échéancier de plus de 6 mois : accord du Responsable, puis du créancier | |
| 4.6 | Paiement partiel imputé d'abord sur les intérêts | |
| 4.7 | Frais de LRAR à la charge du créancier, jamais ajoutés à la somme réclamée | |
| 4.8 | Alerte sur les termes proches d'un acte de commissaire de justice (sommation, commandement, saisie…) dans les modèles importés ; les e-mails du kit ne passent pas par ce contrôle | |
