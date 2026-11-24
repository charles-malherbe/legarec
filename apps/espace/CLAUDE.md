# apps/espace

espace.legarec.fr — portail interne des collaborateurs. Ambiance dense. Écrans : Main, Rapports, Notifications, Equipe, Facturation, Mandants, Mandant, Dossiers, Dossier, Echeanciers, Relances, Telephonie, Messagerie, Sms, Contentieux, Documents, Generer, Reglages, Modele, Compte, Aide, AideArticle, Connexion (portail espace), Erreur.

- Règles : `.claude/rules/front.md` (chargées automatiquement) ; composants uniquement via `packages/ui`.
- Rôles et délégations (`CLAUDE.md`) : lecture seule du Directeur sur les dossiers qui ne lui sont pas attribués ; bandeau « Pour le compte du Directeur » ; tableaux de bord par rôle.
- Paramètres techniques : boîtes e-mail OVH (Développeur et Directeur).
- Routes et captures de référence : `scripts/ecrans.json`, `maquette/captures/`.
- Données simulées (MSW) : `maquette/donnees-demo/<Ecran>.json`.
