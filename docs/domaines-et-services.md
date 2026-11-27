# Domaines et services

## Domaines (seuls ceux-ci existent)
| Adresse | Rôle |
|---|---|
| `legarec.fr` | Domaine principal : site public du cabinet (hors de cette application et hors de Caddy) et boîtes e-mail OVH (`@legarec.fr`, offre MX Plan) |
| `espace.legarec.fr` | Portail interne : collaborateurs (appels, SMS, e-mails, agenda, relances, historique des fichiers…) |
| `partenaires.legarec.fr` | Portail créanciers : avancement des dossiers, dépôt de créances, transmission des pièces, accord sur les échéanciers |
| `paiement.legarec.fr` | Espace débiteur : d'abord échanges avec les collaborateurs (messages, pièces), puis solde, échéancier, RIB et consignes pour les chèques ; liens des courriers et SMS |
| `api.legarec.fr` | API back-end (NestJS), seule porte d'accès aux données |
| `mail.legarec.fr` | Envoi des e-mails automatiques (Resend) ; pas de réception |
| `media.legarec.fr` | Fichiers publics (bucket legarec-media, sinon copie de `infra/media` servie par Caddy) : `e-mails/v1/`, `marque/`, `documents-publics/` |
| `n8n.legarec.fr` | Automatisations (accès restreint) |
| `status.legarec.fr` | Page d'état (Gatus) |
| `legarec.on3cx.fr` | Standard téléphonique 3CX (hébergé par 3CX) |

## Proxy inverse (Caddy)
Seul service exposé sur Internet (ports 80 et 443) : HTTPS automatique, en-têtes de sécurité, routage des sous-domaines ci-dessus (sauf legarec.fr et legarec.on3cx.fr). Redirections : http → https ; www.espace, www.partenaires, www.paiement → sans www ; mail.legarec.fr → legarec.fr ; racines de media.legarec.fr et api.legarec.fr → legarec.fr et status.legarec.fr. Référence : `kits/caddy/Caddyfile.exemple`.

## Connexion par portail
- `espace` : comptes des collaborateurs. `partenaires` : créanciers. `paiement` : identifiant et code d'accès, sans compte.
- Un compte authentifié sur le mauvais portail est redirigé vers le bon, avec un message. **Seulement après authentification**, pour ne pas révéler l'existence d'un compte. Cette redirection est faite par l'application, pas par Caddy.

## E-mails
| Type | Envoi | Expéditeur | Réponses |
|---|---|---|---|
| 25 e-mails automatiques (`kits/emails-handlebars`) | Resend | LEGAREC <ne-pas-repondre@mail.legarec.fr> | Non acceptées, sauf relances 1 à 3 : replyTo recouvrement@legarec.fr |
| Message rédigé par un collaborateur dans l'espace (`staff-message`) | SMTP OVH de sa boîte | Prénom NOM <sa boîte>@legarec.fr | Dans sa boîte OVH |
| Réponse depuis la messagerie (hors application) | OVH | Sa boîte professionnelle | Dans sa boîte OVH |

- `recouvrement@legarec.fr` : **réception seule** (réponses aux relances), synchronisée par IMAP. Personne n'écrit depuis cette boîte.
- Chaque collaborateur a sa boîte professionnelle (`initiales@legarec.fr` ou adresse de fonction comme `administratif@`, `support@`) et répond depuis elle.
- OVH MX Plan : SMTP `smtp.mail.ovh.net` 465 SSL/TLS ; IMAP `ssl0.ovh.net` 993 ; quota d'environ 200 e-mails par heure et par boîte. Un mot de passe par boîte, chiffré côté API.
- Gestion des boîtes (création, mot de passe, redirections, réponse automatique ; aucune suppression, question 28) depuis Paramètres techniques, par l'API OVHcloud limitée à `/email/domain/legarec.fr/*`.
- Suivi des ouvertures et des clics (question 84) : e-mails aux débiteurs et aux créanciers sur mail.legarec.fr ; e-mails de compte (invitation, mot de passe, codes) sur compte.legarec.fr, second domaine Resend sans suivi, à créer. Suivi coupé d'ici là. Envois par OVH : jamais suivis.
- Signature des messages des collaborateurs : nom, rôle, e-mail, numéro 3CX (standard par défaut) suivi du poste s'il existe, adresse, site. Jamais de numéro de portable.

## Autres services
- **SMS** : OVHcloud, à double sens ; compte dédié avec un numéro mobile virtuel (question 70) pour recevoir les réponses ; mention STOP (`{{> mention_sms}}`).
- **Téléphonie** : 3CX (`legarec.on3cx.fr`), par l'API Call Control (question 71) : appels, files, qualification (codes PROMESSE, ECHEANCIER, RAPPEL, LITIGE, DEJA_PAYE, ABSENT, NON_REPONSE, FAUX_NUMERO). Poste du collaborateur dans son profil ; renvoi vers le mobile réglé dans 3CX.
- **Lettres recommandées et courriers** : MySendingBox. Deux comptes : test et production, choisis par variable d'environnement. Jamais de bascule implicite vers la production.
- **Paiement** : chèque et virement sur le compte dédié uniquement (RIB, référence du dossier). Aucun paiement en ligne.
- **Fichiers** : OVHcloud Object Storage (région Paris, décision du 26/11/2026) : `legarec-media` (public), `legarec-documents` (privé, URL présignées), `legarec-sauvegardes` (versioning). Une clé d'accès par bucket.
- **Antivirus** : ClamAV, sur le serveur ; tout fichier reçu reste en quarantaine jusqu'au résultat (question 87).
- **Données d'entreprise** : API publique Recherche d'entreprises (forme juridique d'un débiteur), en tâche de fond, sans clé ; corrigeable à la main (question 80).
- **Clés de ces services** : où les créer, avec quels droits, où les saisir : `docs/api.md`, « Clés et secrets ».
